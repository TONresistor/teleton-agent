import { useRef, useState } from 'react';
import { api, type OperationData, type DeliveryData, type TurnData } from '../lib/api';
import { useResource } from '../hooks/useResource';
import { Alert } from '../components/Alert';
import { CodeBlock } from '../components/CodeBlock';
import { RefreshButton } from '../components/RefreshButton';
import { errMsg, formatDateTime } from '../lib/utils';

function ReviewForm({ kind, onResolve }: {
  kind: 'action' | 'delivery' | 'retry';
  onResolve: (outcome: string, note: string) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState(kind === 'action' ? 'succeeded' : kind === 'retry' ? 'retry' : 'delivered');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <form style={{ display: 'grid', gap: 8 }} onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setError(null);
    try { await onResolve(outcome, note); setNote(''); }
    catch (err) { setError(errMsg(err)); }
    finally { setBusy(false); }
  }}>
    <p>Check the remote state first. Record evidence of the outcome below.</p>
    {error && <Alert type="error" message={error} />}
    {kind !== 'retry' && <label>Confirmed outcome <select value={outcome} onChange={(event) => setOutcome(event.target.value)}>
      {kind === 'action' ? <><option value="succeeded">Succeeded</option><option value="failed">Failed</option></>
        : <><option value="delivered">Delivered</option><option value="not_delivered">Not delivered</option></>}
    </select></label>}
    <label>Evidence <textarea value={note} required maxLength={4000} onChange={(event) => setNote(event.target.value)} /></label>
    <button className="btn-ghost btn-sm" disabled={busy || !note.trim()}>{kind === 'retry' ? 'Retry remaining delivery' : 'Record resolution'}</button>
  </form>;
}

export function Operations() {
  const deliveryRequest = useRef(0);
  const [outcomeFilter, setOutcomeFilter] = useState('');
  const [turn, setTurn] = useState<TurnData | null>(null);
  const [status, setStatus] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<DeliveryData | null>(null);
  const { data, error, loading, reload, setError } = useResource(
    async () => {
      const [operations, deliveries, turns] = await Promise.all([api.operationsList(), api.deliveriesList(), api.turnsList()]);
      return { operations: operations.data ?? [], deliveries: deliveries.data ?? [], turns: turns.data ?? [] };
    }, [],
  );
  const turns = (data?.turns ?? []).filter((item) => !outcomeFilter || item.outcome.status === outcomeFilter);
  const operations = (data?.operations ?? []).filter((operation) => !status || operation.status === status);
  const deliveries = (data?.deliveries ?? []).filter((item) => !status || item.status === status);
  async function selectDelivery(item: DeliveryData) {
    const request = ++deliveryRequest.current;
    setOpenId(null); setDelivery(null); setTurn(null);
    try { const response = await api.deliveryGet(item.delivery_id); if (request === deliveryRequest.current) setDelivery(response.data ?? null); }
    catch (err) { if (request === deliveryRequest.current) setError(errMsg(err)); }
  }
  const selected: OperationData | undefined = data?.operations.find((operation) => operation.operation_id === openId);
  return <div>
    <div className="header"><h1>Operations</h1><p>Action receipts and response delivery. Unknown outcomes require review before another attempt.</p></div>
    {error && <Alert type="error" message={error} onDismiss={() => setError(null)} />}
    <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
      <label>Status <select value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="">All</option><option value="unknown">Unknown</option><option value="running">Running actions</option><option value="not_attempted">Not attempted</option>
        <option value="succeeded">Succeeded actions</option><option value="failed">Failed</option>
        <option value="prepared">Prepared deliveries</option><option value="sending">Sending deliveries</option><option value="partial">Partial deliveries</option><option value="delivered">Delivered</option>
      </select></label>
      <RefreshButton onRefresh={reload} />
    </div>
    {loading && <p>Loading operations…</p>}
    <h2>Turns</h2>
    <label>Turn outcome <select value={outcomeFilter} onChange={(event) => setOutcomeFilter(event.target.value)}>
      <option value="">All outcomes</option>{['completed', 'incomplete', 'blocked', 'failed', 'interrupted', 'unknown'].map((value) => <option key={value} value={value}>{value}</option>)}
    </select></label>
    {!loading && turns.length === 0 && <p>No matching turns.</p>}
    <div className="card" style={{ display: 'grid', gap: 8 }}>
      {turns.map((item) => <button key={item.turnId} className="btn-ghost" style={{ textAlign: 'left' }} onClick={() => { deliveryRequest.current += 1; setDelivery(null); setOpenId(null); setTurn(item); }}>
        Chat {item.chatId} · {item.outcome.status} · {item.outcome.reason}<br /><code>{item.turnId}</code> · {item.modelAttempts.length} model attempt(s)
      </button>)}
    </div>
    {turn && <div className="card" style={{ marginTop: 16 }}>
      <h2>Turn · {turn.outcome.status}</h2><p>{turn.outcome.reason} · delivery {turn.delivery.state}</p>
      <CodeBlock header="Outcome, delivery, and model attempts" maxHeight={400}>{JSON.stringify(turn, null, 2)}</CodeBlock>
    </div>}
    <h2>Actions</h2>
    {!loading && operations.length === 0 && <p>No matching actions.</p>}
    <div className="card" style={{ display: 'grid', gap: 8 }}>
      {operations.map((operation) => <button key={operation.operation_id} className="btn-ghost" style={{ textAlign: 'left' }}
        onClick={() => { deliveryRequest.current += 1; setOpenId(operation.operation_id); setDelivery(null); setTurn(null); }}>
        <strong>{operation.tool_name}</strong> · {operation.status} · {formatDateTime(new Date(operation.started_at).toISOString())}<br />
        <code>{operation.operation_id}</code>
      </button>)}
    </div>
    <h2>Response deliveries</h2>
    {!loading && deliveries.length === 0 && <p>No matching deliveries.</p>}
    <div className="card" style={{ display: 'grid', gap: 8 }}>
      {deliveries.map((item) => <button key={item.delivery_id} className="btn-ghost" style={{ textAlign: 'left' }} onClick={() => void selectDelivery(item)}>
        Chat {item.chat_id} · {item.status}<br /><code>{item.delivery_id}</code>
      </button>)}
    </div>
    {selected && <div className="card" style={{ marginTop: 16 }}>
      <h2>{selected.tool_name} · {selected.status}</h2>
      <CodeBlock header="Receipt and argument provenance" maxHeight={400}>{JSON.stringify(selected, null, 2)}</CodeBlock>
      {selected.status === 'unknown' && <ReviewForm key={selected.operation_id} kind="action" onResolve={async (outcome, note) => {
        await api.operationResolve(selected.operation_id, selected.revision, outcome as 'succeeded' | 'failed', note); reload();
      }} />}
    </div>}
    {delivery && <div className="card" style={{ marginTop: 16 }}>
      <h2>Delivery · {delivery.status}</h2>
      <CodeBlock header="Fragments and receipts" maxHeight={400}>{JSON.stringify(delivery, null, 2)}</CodeBlock>
      {['prepared', 'partial', 'failed'].includes(delivery.status) && delivery.target_kind === 'telegram' && <ReviewForm key={`retry:${delivery.delivery_id}`} kind="retry" onResolve={async (_outcome, note) => {
        await api.deliveryRetry(delivery.delivery_id, delivery.revision, note);
        setDelivery(null); reload();
      }} />}
      {delivery.status === 'unknown' && <ReviewForm key={delivery.delivery_id} kind="delivery" onResolve={async (outcome, note) => {
        await api.deliveryResolve(delivery.delivery_id, delivery.revision, outcome as 'delivered' | 'not_delivered', note);
        setDelivery(null); reload();
      }} />}
    </div>}
  </div>;
}
