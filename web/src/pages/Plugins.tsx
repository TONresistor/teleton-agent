import { useEffect, useState } from 'react';
import { api, ToolInfo, ModuleInfo, PluginManifest } from '../lib/api';
import { ToolRow } from '../components/ToolRow';

export function Plugins() {
  const [manifests, setManifests] = useState<PluginManifest[]>([]);
  const [pluginModules, setPluginModules] = useState<ModuleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const loadData = () => {
    setLoading(true);
    return Promise.all([api.getPlugins(), api.getTools()])
      .then(([pluginsRes, toolsRes]) => {
        setManifests(pluginsRes.data);
        setPluginModules(toolsRes.data.filter((m) => m.isPlugin));
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadData();
  }, []);

  const toggleEnabled = async (toolName: string, currentEnabled: boolean) => {
    setUpdating(toolName);
    try {
      await api.updateToolConfig(toolName, { enabled: !currentEnabled });
      await loadData();
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
      await loadData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUpdating(null);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="header">
        <h1>Plugins</h1>
        <p>External plugins and their tools</p>
      </div>

      {error && (
        <div className="alert error" style={{ marginBottom: '14px' }}>
          {error}
          <button onClick={() => setError(null)} style={{ marginLeft: '10px', padding: '2px 8px', fontSize: '12px' }}>
            Dismiss
          </button>
          <button onClick={() => { setError(null); loadData(); }} style={{ marginLeft: '6px', padding: '2px 8px', fontSize: '12px' }}>
            Retry
          </button>
        </div>
      )}

      {manifests.length === 0 ? (
        <div className="empty">No plugins loaded</div>
      ) : manifests.map((plugin) => {
        const module = pluginModules.find((m) => m.name === plugin.name);
        return (
          <div key={plugin.name} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <h2>{plugin.name}</h2>
              {module && (
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {module.toolCount} tools
                </span>
              )}
            </div>
            <div className="plugin-meta">
              v{plugin.version} {plugin.author && <span>by {plugin.author}</span>}
              {plugin.sdkVersion && <span> · SDK {plugin.sdkVersion}</span>}
            </div>
            {plugin.description && (
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '14px' }}>
                {plugin.description}
              </p>
            )}

            {module && module.tools.length > 0 && (
              <div style={{ display: 'grid', gap: '6px' }}>
                {module.tools.map((tool) => (
                  <ToolRow key={tool.name} tool={tool} updating={updating} onToggle={toggleEnabled} onScope={updateScope} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
