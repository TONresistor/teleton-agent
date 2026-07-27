import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useConfigState } from '../hooks/useConfigState';
import { POLICY_OPTIONS } from '../components/TelegramSettingsPanel';
import { AllowLists } from '../components/AllowLists';
import { ExecSettingsPanel } from '../components/ExecSettingsPanel';
import { PillTabs } from '../components/PillTabs';
import { InfoTip } from '../components/InfoTip';
import { Select } from '../components/Select';
import { ProviderSwitchZone, PROVIDER_OPTIONS, PROVIDER_LABELS } from '../components/ProviderControl';
import { api, StatusData, ConversationChat } from '../lib/api';
import { errMsg, timeAgo } from '../lib/utils';
import { Skeleton, SkeletonRows } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { Alert } from '../components/Alert';

const PLATFORM_LABEL: Record<string, string> = { darwin: 'macOS', linux: 'Linux', win32: 'Windows' };

function fmtUptime(sec: number): string {
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

function providerLabel(provider: string): string {
  const i = PROVIDER_OPTIONS.indexOf(provider);
  return i >= 0 ? PROVIDER_LABELS[i] : provider;
}

function CardHead({ title, desc, right }: { title: string; desc?: string; right?: ReactNode }) {
  return (
    <div className="dash-head">
      <div className="dash-head-text">
        <span className="dash-head-title">{title}</span>
        {desc && <span className="dash-head-desc">{desc}</span>}
      </div>
      {right && <div className="dash-head-right">{right}</div>}
    </div>
  );
}

function StatusBadge() {
  return (
    <span className="dash-status">
      <span className="dash-orb" aria-hidden="true" />
      Running
    </span>
  );
}

function GramGlyph() {
  return (
    <svg className="dash-gram-glyph" viewBox="0 0 56 56" fill="none" aria-hidden="true">
      <path d="M14 16h28a2 2 0 0 1 1.7 3L29.6 41.4a2 2 0 0 1-3.3 0L12.3 19a2 2 0 0 1 1.7-3Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M28 17v24M14.5 18.5 28 24l13.5-5.5" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function Metric({ label, value, to }: { label: string; value: string | number; to?: string }) {
  const navigate = useNavigate();
  const clickable = !!to;
  return (
    <button
      type="button"
      className={`dash-metric${clickable ? ' clickable' : ''}`}
      disabled={!clickable}
      onClick={clickable ? () => navigate(to) : undefined}
    >
      <span className="dash-metric-v">{value}</span>
      <span className="dash-metric-k">{label}</span>
    </button>
  );
}

export function Dashboard() {
  const {
    loading, error, setError, status, stats,
    getLocal, saveConfig,
    modelOptions, pendingProvider, pendingMeta,
    pendingApiKey, setPendingApiKey,
    pendingValidating, pendingError, setPendingError,
    handleProviderChange, handleProviderConfirm, handleProviderCancel,
    loadData,
  } = useConfigState();
  const navigate = useNavigate();

  const handleArraySave = async (key: string, values: string[]) => {
    try {
      await api.setConfigKey(key, values);
      await loadData();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  // Live metrics (tokens, uptime) + wallet balance + recent chats.
  const [liveStatus, setLiveStatus] = useState<StatusData | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [recent, setRecent] = useState<ConversationChat[] | null>(null);
  useEffect(() => {
    let active = true;
    const poll = () => api.getStatus().then((r) => { if (active) setLiveStatus(r.data); }).catch(() => {});
    const id = setInterval(poll, 10_000);
    api.getWallet().then((r) => { if (active) setBalance(r.data?.balance ?? null); }).catch(() => {});
    api.getConversations().then((r) => {
      if (!active) return;
      const chats = (r.data ?? []).slice().sort((a, b) => (b.last_message_at ?? 0) - (a.last_message_at ?? 0));
      setRecent(chats);
    }).catch(() => {});
    return () => { active = false; clearInterval(id); };
  }, []);

  if (loading) {
    return (
      <div className="dashboard-root">
        <div className="header"><h1>Dashboard</h1><p>System overview</p></div>
        <div className="dash-grid">
          <div className="card"><Skeleton width={120} height={24} /><Skeleton width="100%" height={48} style={{ marginTop: 14 }} /></div>
          <div className="card"><Skeleton width={90} height={40} /><Skeleton width="100%" height={48} style={{ marginTop: 14 }} /></div>
        </div>
        <div className="card"><SkeletonRows rows={4} /></div>
      </div>
    );
  }
  if (!status || !stats) return <div className="alert error">Failed to load dashboard data</div>;

  const s = liveStatus ?? status;
  const platform = s.platform ? (PLATFORM_LABEL[s.platform] ?? s.platform) : null;
  const provider = pendingProvider ?? getLocal('agent.provider');
  const modelLabel = modelOptions.find((m) => m.value === getLocal('agent.model'))?.name ?? getLocal('agent.model');
  const tokens = s.tokenUsage ? `${(s.tokenUsage.totalTokens / 1000).toFixed(1)}K` : '0';
  const cost = s.tokenUsage ? `$${s.tokenUsage.totalCost.toFixed(3)}` : '$0.000';
  const recentTop = (recent ?? []).slice(0, 7);

  return (
    <div className="dashboard-root">
      <div className="header"><h1>Dashboard</h1><p>System overview</p></div>

      {error && <Alert type="error" message={error} onDismiss={() => setError(null)} style={{ marginBottom: '14px' }} />}

      <div className="dash-grid">
        {/* ── Agent ── */}
        <div className="card dash-agent">
          <CardHead title="Agent" right={<StatusBadge />} />
          <div className="dash-agent-id">
            <span className="dash-agent-model-name">{modelLabel}</span>
            <span className="dash-agent-provider">
              {[providerLabel(provider), `up ${fmtUptime(s.uptime)}`, platform].filter(Boolean).join(' · ')}
            </span>
          </div>
          <div className="dash-agent-selects">
            <div className="dash-hero-field">
              <span className="dash-hero-label">Provider</span>
              <Select value={provider} options={PROVIDER_OPTIONS} labels={PROVIDER_LABELS} onChange={handleProviderChange} />
            </div>
            <div className="dash-hero-field">
              <span className="dash-hero-label">Model</span>
              <Select
                value={getLocal('agent.model')}
                options={modelOptions.map((m) => m.value)}
                labels={modelOptions.map((m) => m.name)}
                onChange={(v) => saveConfig('agent.model', v)}
              />
            </div>
          </div>
        </div>

        {/* ── Usage ── */}
        <div className="card dash-usage">
          <CardHead
            title="Token usage"
            right={
              <button type="button" className="dash-gram" onClick={() => navigate('/wallet')}>
                <GramGlyph />
                <span className="dash-gram-amt">{balance ?? '—'}</span>
                <span className="dash-gram-unit">GRAM</span>
              </button>
            }
          />
          <div className="dash-usage-hero">
            <span className="dash-usage-num">{tokens}</span>
            <span className="dash-usage-cost">{cost} spent</span>
          </div>
          <div className="dash-metrics">
            <Metric label="Sessions" value={s.sessionCount} />
            <Metric label="Tools" value={s.toolCount} to="/tools" />
            <Metric label="Knowledge" value={stats.knowledge} to="/memory" />
          </div>
        </div>
      </div>

      {pendingProvider && pendingMeta && (
        <div className="card" style={{ marginBottom: '12px' }}>
          <ProviderSwitchZone
            pendingMeta={pendingMeta}
            pendingApiKey={pendingApiKey}
            setPendingApiKey={setPendingApiKey}
            pendingValidating={pendingValidating}
            pendingError={pendingError}
            setPendingError={setPendingError}
            onConfirm={handleProviderConfirm}
            onCancel={handleProviderCancel}
          />
        </div>
      )}

      {/* ── Recent activity ── */}
      <div className="card dash-activity">
        <CardHead
          title="Recent activity"
          right={<span className="dash-activity-sub">{stats.messages.toLocaleString()} messages</span>}
        />
        {recent === null ? (
          <SkeletonRows rows={4} />
        ) : recentTop.length === 0 ? (
          <EmptyState title="No conversations yet" description="Chat activity appears here once the agent starts talking." />
        ) : (
          <>
            <div className="dash-activity-list">
              {recentTop.map((c) => {
                const name = c.title || c.username || c.id;
                return (
                  <button type="button" key={c.id} className="dash-activity-row" onClick={() => navigate('/conversations')}>
                    <span className="dash-activity-ava">{name.charAt(0).toUpperCase()}</span>
                    <span className="dash-activity-body">
                      <span className="dash-activity-name">{name}</span>
                      <span className="dash-activity-snip">{c.last_message || `${c.type} · ${c.message_count} msgs`}</span>
                    </span>
                    <span className="dash-activity-time">{timeAgo(c.last_message_at)}</span>
                  </button>
                );
              })}
            </div>
            {recent.length > recentTop.length && (
              <button type="button" className="dash-activity-all" onClick={() => navigate('/conversations')}>
                View all {recent.length} conversations →
              </button>
            )}
          </>
        )}
      </div>

      {/* ── Settings ── */}
      <div className="dashboard-settings">
        <div className="card dash-settings">
          <CardHead title="Access policy" desc="Who can talk to the agent" />
          <div className="dash-policy">
            <div className="dash-policy-row">
              <label className="dash-policy-label">DM Policy <InfoTip text="Who can DM the agent — All, Allow List, Admins only, or Off." /></label>
              <PillTabs value={getLocal('telegram.dm_policy')} options={POLICY_OPTIONS} onChange={(v) => saveConfig('telegram.dm_policy', v)} ariaLabel="DM policy" />
            </div>
            <div className="dash-policy-row">
              <label className="dash-policy-label">Group Policy <InfoTip text="Which groups the agent responds in — All, Allow List, Admins only, or Off." /></label>
              <PillTabs value={getLocal('telegram.group_policy')} options={POLICY_OPTIONS} onChange={(v) => saveConfig('telegram.group_policy', v)} ariaLabel="Group policy" />
            </div>
          </div>
        </div>
        <div className="card dash-card-fill dash-settings">
          <CardHead title="Allow lists" desc="Trusted Telegram IDs" />
          <AllowLists getLocal={getLocal} onSave={handleArraySave} />
        </div>
        {s.platform === 'linux' && (
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <ExecSettingsPanel getLocal={getLocal} saveConfig={saveConfig} />
          </div>
        )}
      </div>
    </div>
  );
}
