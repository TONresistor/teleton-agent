import { useEffect, useState } from 'react';
import { api, ToolInfo, ModuleInfo } from '../lib/api';
import { ToolRow } from '../components/ToolRow';

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

export function Tools() {
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const loadTools = () => {
    setLoading(true);
    return api
      .getTools()
      .then((res) => {
        setModules(res.data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
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
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUpdating(null);
    }
  };

  const updateScope = async (toolName: string, newScope: ToolInfo['scope']) => {
    setUpdating(toolName);
    try {
      await api.updateToolConfig(toolName, { scope: newScope });
      await loadTools();
    } catch (err: any) {
      setError(err.message);
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
