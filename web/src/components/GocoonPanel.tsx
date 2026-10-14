import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { api } from '../lib/api';
import { errMsg } from '../lib/utils';
import { toast } from '../lib/toast';
import { RefreshButton } from './RefreshButton';

interface Wallet {
  fundAddress: string;
  ownerAddress: string;
  balanceTon: string;
  balanceNano: string;
  funded: boolean;
  recommendedFundingTon: string;
}
interface GocoonStatus {
  installed: boolean;
  version: string | null;
  wallet: Wallet | null;
  runner: boolean;
}
type WEvent = { stage: string; status: string; message: string };

// 1 TON: above this free balance the wallet is treated as provisioned, since the
// stake (~15 TON) drops the free balance below gocoon's "funded" threshold.
const PROVISIONED_NANO = 1_000_000_000n;

// Client-side sanity check only; the server resolves the destination authoritatively.
const RAW_TON = /^(?:EQ|UQ|kQ|0Q)[A-Za-z0-9_-]{46}$/;
const TON_DOMAIN = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+ton$/i;
const looksLikeTONDest = (s: string): boolean => {
  const t = s.trim();
  return RAW_TON.test(t) || TON_DOMAIN.test(t);
};

function GemIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3h12l4 6-10 13L2 9Z" />
      <path d="M11 3 8 9l4 13 4-13-3-6" />
      <path d="M2 9h20" />
    </svg>
  );
}
function CopyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="8" y="8" width="14" height="14" rx="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}
function ExternalIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

const successBadge: CSSProperties = {
  color: 'var(--success)',
  borderColor: 'color-mix(in srgb, var(--success) 32%, transparent)',
};

export function GocoonPanel() {
  const [status, setStatus] = useState<GocoonStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [topupAmount, setTopupAmount] = useState('');
  const [withdrawDest, setWithdrawDest] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [resetText, setResetText] = useState('');
  const [withdrawRunning, setWithdrawRunning] = useState(false);
  const [events, setEvents] = useState<WEvent[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const r = await api.gocoonStatus();
      if (r.success) setStatus(r.data);
    } catch {
      /* keep last known status */
    }
  }, []);

  const startWithdrawPoll = useCallback((): void => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const s = await api.gocoonWithdrawStatus();
      if (!s.success) return;
      setEvents(s.data.events.map((e) => ({ stage: e.stage, status: e.status, message: e.message })));
      if (s.data.done) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        setWithdrawRunning(false);
        setConfirmText('');
        if (s.data.error) toast.error(s.data.error);
        else toast.success('Withdraw complete');
        void refresh();
      }
    }, 1500);
  }, [refresh]);

  useEffect(() => {
    void refresh();
    // Resume an in-flight withdraw after navigation / reload (the job lives server-side).
    void (async () => {
      try {
        const s = await api.gocoonWithdrawStatus();
        if (!s.success) return;
        if (s.data.events.length > 0)
          setEvents(s.data.events.map((e) => ({ stage: e.stage, status: e.status, message: e.message })));
        if (s.data.running) {
          setWithdrawRunning(true);
          startWithdrawPoll();
        }
      } catch {
        /* no in-flight withdraw */
      }
    })();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refresh, startWithdrawPoll]);

  const w = status?.wallet ?? null;
  const running = !!status?.runner;
  const balNano = w ? BigInt(w.balanceNano || '0') : 0n;
  const hasFunds = !!w && (w.funded || balNano > PROVISIONED_NANO);
  const awaitingDeposit = !!status?.installed && !!w && !running && !hasFunds;
  const destValid = looksLikeTONDest(withdrawDest);

  // While waiting for the first deposit, poll so the balance is auto-detected.
  useEffect(() => {
    if (!awaitingDeposit) return;
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [awaitingDeposit, refresh]);

  const run = async (label: string, fn: () => Promise<void>): Promise<void> => {
    setBusy(label);
    try {
      await fn();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(null);
    }
  };

  const onInstall = (): Promise<void> =>
    run('install', async () => {
      const r = await api.gocoonInstall();
      toast.success(`Installed gocoon ${r.data.version}`);
      await refresh();
    });

  const onSetup = (): Promise<void> =>
    run('setup', async () => {
      await api.gocoonInit();
      await refresh();
    });

  const onTopup = (): Promise<void> =>
    run('topup', async () => {
      if (!topupAmount.trim()) return;
      await api.gocoonTopup(topupAmount.trim());
      toast.success(`Topped up ${topupAmount} TON`);
      setTopupAmount('');
      await refresh();
    });

  const onWithdraw = (): Promise<void> =>
    run('withdraw', async () => {
      const dest = withdrawDest.trim();
      if (!dest || !looksLikeTONDest(dest)) return;
      await api.gocoonWithdrawStart(dest);
      setEvents([]);
      setWithdrawRunning(true);
      startWithdrawPoll();
    });

  const onStopRunner = (): Promise<void> =>
    run('stopRunner', async () => {
      await api.gocoonRunnerStop();
      await refresh();
    });

  const onReset = (): Promise<void> =>
    run('reset', async () => {
      await api.gocoonReset();
      setResetText('');
      toast.success('Wallet reset, create a fresh one below');
      await refresh();
    });

  const copy = (s: string): void => {
    void navigator.clipboard?.writeText(s).then(() => toast.success('Address copied')).catch(() => {});
  };

  if (!status) {
    return (
      <div className="wallet-hero">
        <div className="wallet-hero-empty">Loading gocoon...</div>
      </div>
    );
  }

  const heroBadge: { text: string; cls?: string; style?: CSSProperties } = running
    ? { text: 'Running', style: successBadge }
    : hasFunds
      ? { text: 'Ready', style: successBadge }
      : { text: 'Awaiting funds', cls: 'warn' };

  return (
    <>
      <div className="wallet-hero">
        <GemIcon className="wallet-diamond" />
        {!status.installed ? (
          <div className="wallet-hero-empty">gocoon is not installed yet</div>
        ) : !w ? (
          <div className="wallet-hero-empty">No funding wallet yet, create one below</div>
        ) : (
          <>
            <div className="wallet-hero-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>COCOON Wallet</span>
              <span className={`badge${heroBadge.cls ? ' ' + heroBadge.cls : ''}`} style={heroBadge.style}>
                {heroBadge.text}
              </span>
            </div>
            <div className="wallet-balance">
              <span className="wallet-balance-amount">{w.balanceTon}</span>
              <span className="wallet-balance-unit">TON</span>
            </div>
            <div className="wallet-address">
              <code>{w.fundAddress}</code>
              <button className="wallet-addr-btn" onClick={() => copy(w.fundAddress)} aria-label="Copy address">
                <CopyIcon />
              </button>
              <a className="wallet-addr-btn" href={`https://tonviewer.com/${w.fundAddress}`} target="_blank" rel="noopener noreferrer" aria-label="View on TonViewer">
                <ExternalIcon />
              </a>
            </div>
          </>
        )}
      </div>

      <Steps installed={status.installed} hasWallet={!!w} funded={hasFunds} running={running} />

      <div className="card config-card" style={{ marginBottom: 'var(--space-lg)' }}>
        <div className="config-card-body">
          {!status.installed && (
            <Action
              title="Install gocoon"
              hint="One-time download of the gocoon runner for your platform."
              right={
                <button className="btn-sm" disabled={!!busy} onClick={onInstall}>
                  {busy === 'install' ? 'Installing...' : 'Install gocoon'}
                </button>
              }
            />
          )}
          {status.installed && !w && (
            <Action
              title="Create funding wallet"
              hint="Generates your COCOON wallet. The address is fixed and reused afterwards."
              right={
                <button className="btn-sm" disabled={!!busy} onClick={onSetup}>
                  {busy === 'setup' ? 'Creating...' : 'Create funding wallet'}
                </button>
              }
            />
          )}
          {awaitingDeposit && (
            <Action
              title={`Send ${w?.recommendedFundingTon ?? '20'} TON to the address above`}
              hint="Mainnet. Detected automatically."
              right={
                <span className="helper-text" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span className="spinner sm" /> Waiting for funds
                </span>
              }
            />
          )}
          {!running && hasFunds && (
            <Action
              title="Ready to run"
              hint="Set the provider to Gocoon and start the agent. The runner and payment channel start automatically."
              right={<span className="badge" style={successBadge}>Funded</span>}
            />
          )}
          {running && (
            <Action
              title="Running"
              hint="The agent is serving on gocoon. The payment channel is staked and active."
              right={<span className="badge always">live</span>}
            />
          )}

          <div className="gocoon-meta">
            <span>
              <span className={`status-dot ${running ? 'connected' : 'disconnected'}`} /> Runner{' '}
              {running ? 'running' : 'stopped'}
            </span>
            {status.installed && status.version && <span className="helper-text">gocoon {status.version}</span>}
            <span style={{ marginLeft: 'auto' }}>
              <RefreshButton onRefresh={() => void refresh()} />
            </span>
          </div>
        </div>
      </div>

      {w && (
        <div className="card config-card">
          <div className="config-card-head">
            <span className="config-card-title">Manage</span>
          </div>
          <div className="config-card-body" style={{ display: 'grid', gap: 'var(--space-lg)' }}>
            {hasFunds && (
              <div className="form-group">
                <label>Top up channel</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="w-full"
                    type="number"
                    placeholder="TON (e.g. 5)"
                    value={topupAmount}
                    disabled={!running}
                    onChange={(e) => setTopupAmount(e.target.value)}
                  />
                  <button
                    className="btn-sm"
                    disabled={!!busy || !running || !topupAmount.trim()}
                    onClick={onTopup}
                  >
                    {busy === 'topup' ? 'Topping up...' : 'Top up'}
                  </button>
                </div>
                <div className="helper-text">
                  {running
                    ? 'Adds stake to the channel.'
                    : 'Start the agent first — top up needs the runner active.'}
                </div>
              </div>
            )}

            <div className="form-group">
              <label>Withdraw everything</label>
              {withdrawRunning ? (
                <div className="helper-text" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span className="spinner sm" /> Withdraw in progress (~3 min): closing channel and draining wallets.
                </div>
              ) : (
                <>
                  {running && (
                    <div
                      className="info-panel"
                      style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
                    >
                      <span className="helper-text" style={{ color: 'var(--warning)' }}>
                        The agent is running. Stop it before withdrawing.
                      </span>
                      <button className="btn-sm" disabled={!!busy} onClick={onStopRunner}>
                        {busy === 'stopRunner' ? 'Stopping...' : 'Stop agent'}
                      </button>
                    </div>
                  )}
                  <input
                    className="w-full"
                    type="text"
                    placeholder="TON address or .ton domain"
                    value={withdrawDest}
                    disabled={running}
                    onChange={(e) => setWithdrawDest(e.target.value)}
                  />
                  {withdrawDest.trim() && !destValid && (
                    <div className="helper-text" style={{ color: 'var(--error)', marginTop: 4 }}>
                      Doesn't look like a TON address or .ton domain.
                    </div>
                  )}
                  <input
                    className="w-full"
                    type="text"
                    placeholder='Type "withdraw" to confirm'
                    value={confirmText}
                    disabled={running}
                    onChange={(e) => setConfirmText(e.target.value)}
                    style={{ marginTop: 8 }}
                  />
                  <button
                    className="btn-sm"
                    style={{ marginTop: 8 }}
                    disabled={!!busy || running || !destValid || confirmText !== 'withdraw'}
                    onClick={onWithdraw}
                  >
                    Withdraw
                  </button>
                  <div className="helper-text" style={{ marginTop: 6 }}>
                    Closes the channel and drains the COCOON + agent wallets to the address above. Irreversible.
                  </div>
                </>
              )}
              {events.length > 0 && (
                <div className="info-panel" style={{ marginTop: 8 }}>
                  {events.map((e, i) => (
                    <div key={i} className="helper-text">
                      {e.status === 'ok' ? '[ok]' : e.status === 'error' ? '[x]' : '[..]'} [{e.stage}] {e.message}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {!hasFunds && !running && (
              <div className="form-group">
                <label>Reset wallet</label>
                <input
                  className="w-full"
                  type="text"
                  placeholder='Type "reset" to confirm'
                  value={resetText}
                  onChange={(e) => setResetText(e.target.value)}
                />
                <button
                  className="btn-sm"
                  style={{ marginTop: 8 }}
                  disabled={!!busy || resetText !== 'reset'}
                  onClick={onReset}
                >
                  {busy === 'reset' ? 'Resetting...' : 'Reset wallet'}
                </button>
                <div className="helper-text" style={{ marginTop: 6 }}>
                  Deletes the local COCOON wallet + config so a fresh one is created on the next setup. Withdraw everything first. Irreversible.
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Steps({ installed, hasWallet, funded, running }: {
  installed: boolean;
  hasWallet: boolean;
  funded: boolean;
  running: boolean;
}) {
  const steps = [
    { label: 'Install', done: installed },
    { label: 'Wallet', done: hasWallet },
    { label: 'Fund', done: funded },
    { label: 'Run', done: running },
  ];
  const current = steps.findIndex((s) => !s.done);
  return (
    <div className="gocoon-steps">
      {steps.map((s, i) => {
        const state = s.done ? 'done' : i === current ? 'current' : 'pending';
        return (
          <div key={s.label} className="gocoon-step">
            <span className={`gocoon-step-dot ${state}`}>{s.done ? '✓' : i + 1}</span>
            <span className={`gocoon-step-label ${state}`}>{s.label}</span>
            {i < steps.length - 1 && <span className={`gocoon-step-line ${s.done ? 'done' : ''}`} />}
          </div>
        );
      })}
    </div>
  );
}

function Action({ title, hint, right }: { title: string; hint: string; right: ReactNode }) {
  return (
    <div className="gocoon-action">
      <div style={{ minWidth: 0 }}>
        <div className="config-card-title">{title}</div>
        <div className="helper-text" style={{ marginTop: 2 }}>{hint}</div>
      </div>
      <div style={{ flexShrink: 0 }}>{right}</div>
    </div>
  );
}
