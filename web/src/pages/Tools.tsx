import { useEffect, useState } from 'react';
import { api, ToolInfo, ModuleInfo, ToolRagStatus } from '../lib/api';
import { ToolRow } from '../components/ToolRow';
import { Select } from '../components/Select';

function ModuleCard({
  module,
  updating,
  onToggle,
  onScope,
}: {
  module: ModuleInfo;
  updating: string | null;
  onToggle: (name: string, enabled: boolean) => void;
  onScope: (name: string, scope: ToolInfo['scope']) => void;
}) {
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
        <h2>{module.name}</h2>
        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{module.toolCount} tools</span>
      </div>
      <div style={{ display: 'grid', gap: '6px' }}>
        {module.tools.map((tool) => (
          <ToolRow key={tool.name} tool={tool} updating={updating} onToggle={onToggle} onScope={onScope} />
        ))}
      </div>
    </div>
  );
}

function ToolRagCard({ rag, onToggle, onTopK }: { rag: ToolRagStatus; onToggle: () => void; onTopK: (n: number) => void }) {
  return (
    <div className="card" style={{ marginBottom: '14px', opacity: rag.enabled ? 1 : 0.7 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div>
          <h2 style={{ margin: 0 }}>Tool RAG</h2>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
            Semantic tool selection — sends only the most relevant tools to the LLM per message.
          </p>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={rag.enabled} onChange={onToggle} />
          <span className="toggle-track" />
          <span className="toggle-thumb" />
        </label>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '13px', color: 'var(--text-secondary)' }}>
        <span>Indexed: {rag.indexed ? 'Yes' : 'No'}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          Top-K:
          <Select
            value={String(rag.topK)}
            options={['10', '15', '20', '25', '30', '40', '50']}
            onChange={(v) => onTopK(Number(v))}
            style={{ display: 'inline-block', minWidth: '70px' }}
          />
        </span>
        <span>Total: {rag.totalTools}</span>
      </div>
    </div>
  );
}

export function Tools() {
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [rag, setRag] = useState<ToolRagStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const loadTools = () => {
    setLoading(true);
    return Promise.all([api.getTools(), api.getToolRag()])
      .then(([toolsRes, ragRes]) => {
        setModules(toolsRes.data);
        setRag(ragRes.data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  };

  useEffect(() => {
    loadTools();
  }, []);

  const toggleEnabled = async (toolName: string, currentEnabled: boolean) => {
    setUpdating(toolName);
    try {
      await api.updateToolConfig(toolName, { enabled: !currentEnabled });
      await loadTools();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdating(null);
    }
  };

  const updateScope = async (toolName: string, newScope: ToolInfo['scope']) => {
    setUpdating(toolName);
    try {
      await api.updateToolConfig(toolName, { scope: newScope });
      await loadTools();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdating(null);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  const builtIn = modules.filter((m) => !m.isPlugin);
  const builtInCount = builtIn.reduce((sum, m) => sum + m.toolCount, 0);

  return (
    <div>
      <div className="header">
        <h1>Tools</h1>
        <p>Configure built-in tool availability and policies ({builtInCount} tools)</p>
      </div>

      {rag && (
        <ToolRagCard
          rag={rag}
          onToggle={async () => {
            try {
              const res = await api.updateToolRag({ enabled: !rag.enabled });
              setRag(res.data);
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            }
          }}
          onTopK={async (n) => {
            try {
              const res = await api.updateToolRag({ topK: n });
              setRag(res.data);
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            }
          }}
        />
      )}

      {error && (
        <div className="alert error" style={{ marginBottom: '14px' }}>
          {error}
          <button onClick={() => setError(null)} style={{ marginLeft: '10px', padding: '2px 8px', fontSize: '12px' }}>
            Dismiss
          </button>
          <button onClick={() => { setError(null); loadTools(); }} style={{ marginLeft: '6px', padding: '2px 8px', fontSize: '12px' }}>
            Retry
          </button>
        </div>
      )}

      {builtIn.map((module) => (
        <ModuleCard
          key={module.name}
          module={module}
          updating={updating}
          onToggle={toggleEnabled}
          onScope={updateScope}
        />
      ))}
    </div>
  );
}
