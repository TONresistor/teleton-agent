import { useAgentStatus } from '../hooks/useAgentStatus';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useConfigState } from '../hooks/useConfigState';
import { POLICY_OPTIONS } from '../components/TelegramSettingsPanel';
import { AllowLists } from '../components/AllowLists';
import { ExecSettingsPanel } from '../components/ExecSettingsPanel';
import { PillTabs } from '../components/PillTabs';
import { InfoTip } from '../components/InfoTip';
import { Select } from '../components/Select';
import { ModelSelect } from '../components/ModelSelect';
import { ProviderSwitchZone, PROVIDER_OPTIONS, PROVIDER_LABELS } from '../components/ProviderControl';
import { api, StatusData, ConversationChat } from '../lib/api';
import { errMsg, timeAgo } from '../lib/utils';
import { Skeleton, SkeletonRows } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { Alert } from '../components/Alert';
import { TokenActivity } from '../components/TokenActivity';
import { ChatAvatar } from '../components/ChatAvatar';
import { GramIcon } from '../components/GramIcon';

function CardHead({ title, desc, right }: { title: ReactNode; desc?: string; right?: ReactNode }) {
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
  const { state, error } = useAgentStatus();
  const label = error ? 'Unavailable' : ({ stopped: 'Stopped', starting: 'Starting...', running: 'Running', stopping: 'Stopping...' })[state];
  return (
    <span className="dash-status">
      <span className="dash-orb" aria-hidden="true" style={state !== 'running' || error ? { background: 'var(--text-tertiary)', animation: 'none' } : undefined} />
      {label}
    </span>
  );
}

function AgentActivity({ status, chats }: { status: StatusData; chats: ConversationChat[] | null }) {
  const { state, error } = useAgentStatus();
  const activity = status.agentActivity;
  const chat = chats?.find((item) => item.id === activity?.lastChatId);
  const chatName = chat?.title || chat?.username || activity?.lastChatName;
  const age = activity?.lastProcessedAt ? timeAgo(activity.lastProcessedAt / 1000) : null;
  const handledAt = age === 'now' ? 'just now' : age && /^\d+[mhd]$/.test(age) ? `${age} ago` : age ? `on ${age}` : null;
  const label = error
    ? 'Activity unavailable'
    : state === 'starting' ? 'Agent starting'
    : state === 'stopping' ? 'Agent stopping'
    : state === 'stopped' ? 'Agent stopped'
    : activity?.processing ? 'Processing a message'
    : 'Waiting for messages';

  return (
    <div className="dash-agent-activity">
      <span className="dash-agent-activity-state">{label}</span>
      <span className="dash-agent-activity-last">
        {handledAt ? `Last handled ${handledAt}` : 'No recent processing yet'}
        {chatName && handledAt ? ` · ${chatName}` : ''}
      </span>
    </div>
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
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const response = await api.getStatus();
        if (active) setLiveStatus(response.data);
      } catch {
        // Keep the last known status during a temporary request failure.
      } finally {
        if (active) pollTimer = setTimeout(poll, 1_000);
      }
    };
    void poll();
    api.getWallet().then((r) => { if (active) setBalance(r.data?.balance ?? null); }).catch(() => {});
    api.getConversations().then((r) => {
      if (!active) return;
      const chats = (r.data ?? []).slice().sort((a, b) => (b.last_message_at ?? 0) - (a.last_message_at ?? 0));
      setRecent(chats);
    }).catch(() => {});
    return () => { active = false; if (pollTimer) clearTimeout(pollTimer); };
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
  const provider = pendingProvider ?? getLocal('agent.provider');
  const modelLabel = modelOptions.find((m) => m.value === getLocal('agent.model'))?.name ?? getLocal('agent.model');
  const tokens = s.tokenUsage ? `${(s.tokenUsage.totalTokens / 1000).toFixed(1)}K` : '0';
  const cost = s.tokenUsage?.costIncomplete
    ? 'Cost incomplete'
    : `${s.tokenUsage ? `$${s.tokenUsage.totalCost.toFixed(3)}` : '$0.000'} spent`;
  const recentTop = (recent ?? []).slice(0, 7);

  return (
    <div className="dashboard-root">
      <div className="header"><h1>Dashboard</h1><p>System overview</p></div>

      {error && <Alert type="error" message={error} onDismiss={() => setError(null)} style={{ marginBottom: '14px' }} />}

      <div className="dash-grid">
        {/* ── Agent ── */}
        <div className="card dash-agent">
          <CardHead
            title={<>
              {s.agentIdentity?.firstName || 'Agent'}
              {s.agentIdentity?.username && <span className="dash-agent-handle">@{s.agentIdentity.username}</span>}
            </>}
            right={<StatusBadge />}
          />
          <div className="dash-agent-id">
            <span className="dash-agent-model-name">{modelLabel}</span>
          </div>
          <AgentActivity status={s} chats={recent} />
          <div className="dash-agent-selects">
            <div className="dash-hero-field">
              <span className="dash-hero-label">Provider</span>
              <Select value={provider} options={PROVIDER_OPTIONS} labels={PROVIDER_LABELS} onChange={handleProviderChange} />
            </div>
            <div className="dash-hero-field">
              <span className="dash-hero-label">Model</span>
              <ModelSelect
                provider={getLocal('agent.provider')}
                value={getLocal('agent.model')}
                models={modelOptions}
                onSave={(v) => saveConfig('agent.model', v)}
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
                <GramIcon className="dash-gram-glyph" />
                <span className="dash-gram-amt">{balance ?? '—'}</span>
                <span className="dash-gram-unit">GRAM</span>
              </button>
            }
          />
          <div className="dash-usage-hero">
            <span className="dash-usage-num">{tokens}</span>
            <span className="dash-usage-cost">{cost}</span>
          </div>
          <TokenActivity />
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
                    <ChatAvatar chatId={c.id} name={name} />
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
