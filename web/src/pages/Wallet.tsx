import { useMemo, useState, Fragment } from 'react';
import { api, WalletInfo, WalletTransaction } from '../lib/api';
import { formatDateTime } from '../lib/utils';
import { useResource } from '../hooks/useResource';
import { RefreshButton } from '../components/RefreshButton';
import { Segmented } from '../components/Segmented';
import { List, ListRow } from '../components/List';
import { Alert } from '../components/Alert';
import { Skeleton, SkeletonRows } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { toast } from '../lib/toast';
import { GramIcon } from '../components/GramIcon';

type Dir = 'in' | 'out' | 'other';
type Filter = 'all' | 'in' | 'out';

function truncate(addr: string, head = 6, tail = 6): string {
  if (addr.length <= head + tail + 2) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

function getDirection(type: string): Dir {
  if (type.includes('received') || type === 'gas_refund') return 'in';
  if (type.includes('sent')) return 'out';
  return 'other';
}

function relativeTime(seconds: number): string {
  if (seconds < 60) return 'just now';
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

// ── Direction glyphs ───────────────────────────────────────────────────────

function DirIcon({ dir }: { dir: Dir }) {
  if (dir === 'other') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <circle cx="7" cy="7" r="2.4" fill="currentColor" />
      </svg>
    );
  }
  // in = arrow down-left into wallet, out = arrow up-right
  const path = dir === 'in' ? 'M10 4 4 10 M4 5.2 4 10 9 10' : 'M4 10 10 4 M5.2 4 10 4 10 9';
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d={path} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Transaction detail ─────────────────────────────────────────────────────

function DetailRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="tx-kv">
      <span className="tx-kv-label">{label}</span>
      <span className={`tx-kv-value${mono ? ' mono' : ''}`}>{value}</span>
    </div>
  );
}

// ── Wallet page ────────────────────────────────────────────────────────────

export function Wallet() {
  const { data: wallet, loading, error, reload: reloadWallet, setError } =
    useResource<WalletInfo | null>(
      () => api.getWallet().then((r) => r.data ?? null),
      [],
    );
  const { data: transactions, loading: txLoading, reload: reloadTx } =
    useResource<WalletTransaction[]>(
      () => api.getWalletTransactions().then((r) => r.data ?? []),
      [],
    );

  const [filter, setFilter] = useState<Filter>('all');
  const [expandedTx, setExpandedTx] = useState<string | null>(null);

  const refresh = () => {
    reloadWallet();
    reloadTx();
  };

  const copyAddress = async () => {
    if (!wallet?.address) return;
    try {
      await navigator.clipboard.writeText(wallet.address);
      toast.success('Address copied');
    } catch {
      toast.error('Copy failed');
    }
  };

  const all = transactions ?? [];
  const filtered = useMemo(
    () => (filter === 'all' ? all : all.filter((tx) => getDirection(tx.type) === filter)),
    [all, filter],
  );

  return (
    <div>
      <div className="header">
        <h1>Wallet</h1>
        <p>TON blockchain wallet</p>
      </div>

      {error && <Alert type="error" message={error} onDismiss={() => setError(null)} style={{ marginBottom: '14px' }} />}

      {/* ── Balance hero ── */}
      <div className="wallet-hero">
        <GramIcon className="wallet-gram-icon" />
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <Skeleton width={90} height={12} />
            <Skeleton width={200} height={40} />
            <Skeleton width={260} height={30} />
          </div>
        ) : !wallet?.address ? (
          <div className="wallet-hero-empty">No wallet configured</div>
        ) : (
          <>
            <div className="wallet-hero-label">Total Balance</div>
            <div className="wallet-balance">
              <span className="wallet-balance-amount">{wallet.balance}</span>
              <span className="wallet-balance-unit">GRAM</span>
            </div>
            <div className="wallet-address">
              <code>{wallet.address}</code>
              <button className="wallet-addr-btn" onClick={copyAddress} aria-label="Copy address">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="8" y="8" width="14" height="14" rx="2" />
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                </svg>
              </button>
              <a
                className="wallet-addr-btn"
                href={`https://tonviewer.com/${wallet.address}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="View on TonViewer"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h6v6" />
                  <path d="M10 14 21 3" />
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                </svg>
              </a>
            </div>
          </>
        )}
      </div>

      {/* ── Transactions ── */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '14px' }}>
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          ariaLabel="Filter transactions"
          options={[
            { value: 'all', label: 'All' },
            { value: 'in', label: 'In' },
            { value: 'out', label: 'Out' },
          ]}
        />
        <div style={{ flex: 1 }} />
        <RefreshButton onRefresh={refresh} />
      </div>

      {txLoading ? (
        <SkeletonRows />
      ) : filtered.length === 0 ? (
        <div className="card" style={{ padding: 0 }}>
          <EmptyState
            title={all.length === 0 ? 'No transactions yet' : 'No matching transactions'}
            description={
              all.length === 0
                ? 'Wallet activity will show up here once transactions occur.'
                : 'Try a different filter.'
            }
          />
        </div>
      ) : (
        <List>
          {filtered.map((tx) => {
            const dir = getDirection(tx.type);
            const counterparty = tx.from || tx.to || tx.jettonWallet || '—';
            const isExpanded = expandedTx === tx.hash;
            const sign = dir === 'in' ? '+' : dir === 'out' ? '−' : '';
            return (
              <Fragment key={tx.hash}>
                <ListRow
                  className={`tx-${dir}`}
                  leading={<DirIcon dir={dir} />}
                  title={tx.type.replace(/_/g, ' ')}
                  subtitle={`${truncate(counterparty)} · ${relativeTime(tx.secondsAgo)}`}
                  trailing={
                    <span className={`tx-amount tx-amount-${dir}`}>
                      {tx.amount ? `${sign}${tx.amount}` : '—'}
                    </span>
                  }
                  disclosure
                  expanded={isExpanded}
                  onClick={() => setExpandedTx(isExpanded ? null : tx.hash)}
                />
                {isExpanded && (
                  <div className="ios-sublist tx-detail">
                    <DetailRow label="Hash" value={truncate(tx.hash, 10, 10)} mono />
                    {tx.from && <DetailRow label="From" value={truncate(tx.from, 10, 10)} mono />}
                    {tx.to && <DetailRow label="To" value={truncate(tx.to, 10, 10)} mono />}
                    {tx.comment && <DetailRow label="Comment" value={tx.comment} />}
                    <DetailRow label="Date" value={formatDateTime(tx.date)} />
                    <DetailRow
                      label="Explorer"
                      value={
                        <a href={tx.explorer} target="_blank" rel="noopener noreferrer">
                          View on TonViewer ↗
                        </a>
                      }
                    />
                  </div>
                )}
              </Fragment>
            );
          })}
        </List>
      )}
    </div>
  );
}
