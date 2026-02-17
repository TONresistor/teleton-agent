import { useEffect, useState } from 'react';
import { api, McpServerInfo } from '../lib/api';

export function Mcp() {
  const [servers, setServers] = useState<McpServerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [addPkg, setAddPkg] = useState('');
  const [addArgs, setAddArgs] = useState('');
  const [addName, setAddName] = useState('');
  const [envPairs, setEnvPairs] = useState<{ key: string; value: string; id: string }[]>([]);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadData = (initial = false) => {
    if (initial) setLoading(true);
    api.getMcpServers()
      .then((res) => {
        setServers(res.data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  };

  useEffect(() => {
    loadData(true);
  }, []);

  const toggleExpand = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleAdd = async () => {
    if (!addPkg.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const args = addArgs.trim() ? addArgs.trim().split(/\s+/) : undefined;
      const isUrl = addPkg.startsWith('http://') || addPkg.startsWith('https://');
      const env: Record<string, string> = {};
      for (const pair of envPairs) {
        if (pair.key.trim()) env[pair.key.trim()] = pair.value;
      }
      const res = await api.addMcpServer({
        ...(isUrl ? { url: addPkg.trim() } : { package: addPkg.trim() }),
        name: addName.trim() || undefined,
        args: isUrl ? undefined : args,
        env: Object.keys(env).length > 0 ? env : undefined,
      });
      setSuccess(res.data.message);
      setAddPkg('');
      setAddArgs('');
      setAddName('');
      setEnvPairs([]);
      setShowAdd(false);
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (name: string) => {
    if (!confirm(`Remove MCP server "${name}"?`)) return;
    setRemoving(name);
    setError(null);
    try {
      const res = await api.removeMcpServer(name);
      setSuccess(res.data.message);
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRemoving(null);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  const connectedCount = servers.filter((s) => s.connected).length;

  return (
    <div>
      <div className="header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1>MCP Servers</h1>
            <p>External tool servers connected via Model Context Protocol</p>
          </div>
          <button onClick={() => setShowAdd(!showAdd)} style={{ fontSize: '13px' }}>
            {showAdd ? 'Cancel' : '+ Add Server'}
          </button>
        </div>
      </div>

      {error && (
        <div className="alert error" style={{ marginBottom: '14px' }}>
          {error}
          <button onClick={() => setError(null)} style={{ marginLeft: '10px', padding: '2px 8px', fontSize: '12px' }}>
            Dismiss
          </button>
        </div>
      )}

      {success && (
        <div className="alert success" style={{ marginBottom: '14px' }}>
          {success}
          <button onClick={() => setSuccess(null)} style={{ marginLeft: '10px', padding: '2px 8px', fontSize: '12px' }}>
            Dismiss
          </button>
        </div>
      )}

      {showAdd && (
        <div className="card" style={{ marginBottom: '14px' }}>
          <h2 style={{ margin: '0 0 10px' }}>Add MCP Server</h2>
          <div style={{ display: 'grid', gap: '8px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                Package or URL *
              </label>
              <input
                type="text"
                value={addPkg}
                onChange={(e) => setAddPkg(e.target.value)}
                placeholder="@modelcontextprotocol/server-filesystem  or  http://localhost:3001/mcp"
                style={{ width: '100%', fontSize: '13px' }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Arguments (space-separated)
                </label>
                <input
                  type="text"
                  value={addArgs}
                  onChange={(e) => setAddArgs(e.target.value)}
                  placeholder="/tmp /home/user/docs"
                  style={{ width: '100%', fontSize: '13px' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Name (auto-derived if empty)
                </label>
                <input
                  type="text"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder="filesystem"
                  style={{ width: '100%', fontSize: '13px' }}
                />
              </div>
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Environment Variables
                </label>
                <button
                  type="button"
                  onClick={() => setEnvPairs([...envPairs, { key: '', value: '', id: crypto.randomUUID() }])}
                  style={{ fontSize: '11px', padding: '1px 6px', opacity: 0.7 }}
                >
                  + Add
                </button>
              </div>
              {envPairs.map((pair, i) => (
                <div key={pair.id} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: '6px', marginBottom: '4px' }}>
                  <input
                    type="text"
                    value={pair.key}
                    onChange={(e) => {
                      const next = [...envPairs];
                      next[i] = { ...next[i], key: e.target.value };
                      setEnvPairs(next);
                    }}
                    placeholder="BRAVE_API_KEY"
                    style={{ fontSize: '12px', fontFamily: 'monospace' }}
                  />
                  <input
                    type="password"
                    value={pair.value}
                    onChange={(e) => {
                      const next = [...envPairs];
                      next[i] = { ...next[i], value: e.target.value };
                      setEnvPairs(next);
                    }}
                    placeholder="sk-xxx..."
                    style={{ fontSize: '12px', fontFamily: 'monospace' }}
                  />
                  <button
                    type="button"
                    onClick={() => setEnvPairs(envPairs.filter((_, j) => j !== i))}
                    style={{ fontSize: '11px', padding: '2px 6px', opacity: 0.6 }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
              <button onClick={() => setShowAdd(false)} style={{ fontSize: '13px', opacity: 0.7 }}>
                Cancel
              </button>
              <button onClick={handleAdd} disabled={adding || !addPkg.trim()} style={{ fontSize: '13px' }}>
                {adding ? 'Adding...' : 'Add Server'}
              </button>
            </div>
          </div>
          <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '8px 0 0' }}>
            Changes are saved to config.yaml. Restart teleton to connect.
          </p>
        </div>
      )}

      {servers.length === 0 && !showAdd && (
        <div className="empty">
          <p>No MCP servers configured</p>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '8px' }}>
            Click "+ Add Server" above or use CLI: <code>teleton mcp add @modelcontextprotocol/server-filesystem /tmp</code>
          </p>
        </div>
      )}
      {servers.length > 0 && (
        <>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '14px' }}>
            {connectedCount}/{servers.length} connected · {servers.reduce((sum, s) => sum + s.toolCount, 0)} tools total
          </div>

          {servers.map((server) => (
            <div key={server.name} className="card" style={{ marginBottom: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h2 style={{ margin: 0 }}>{server.name}</h2>
                  <span style={{
                    fontSize: '11px',
                    padding: '1px 6px',
                    borderRadius: '3px',
                    background: 'var(--surface)',
                    color: 'var(--text-secondary)',
                  }}>
                    {server.type}
                  </span>
                  {server.scope !== 'always' && (
                    <span style={{
                      fontSize: '11px',
                      padding: '1px 6px',
                      borderRadius: '3px',
                      background: 'var(--surface)',
                      color: 'var(--text-secondary)',
                    }}>
                      {server.scope}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '12px',
                    color: server.connected ? 'var(--green)' : 'var(--red)',
                  }}>
                    <span style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: server.connected ? 'var(--green)' : 'var(--red)',
                    }} />
                    {server.connected ? 'Connected' : 'Disconnected'}
                  </span>
                  {!server.enabled && (
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>disabled</span>
                  )}
                  <button
                    onClick={() => handleRemove(server.name)}
                    disabled={removing === server.name}
                    style={{
                      fontSize: '11px',
                      padding: '2px 8px',
                      opacity: 0.6,
                      cursor: removing === server.name ? 'wait' : 'pointer',
                    }}
                  >
                    {removing === server.name ? '...' : 'Remove'}
                  </button>
                </div>
              </div>

              <div style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                {server.target}
              </div>

              {server.envKeys.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                  {server.envKeys.map((k) => (
                    <span
                      key={k}
                      style={{
                        fontSize: '11px',
                        padding: '1px 6px',
                        borderRadius: '3px',
                        background: 'var(--surface)',
                        color: 'var(--text-secondary)',
                        fontFamily: 'monospace',
                      }}
                    >
                      {k}=••••
                    </span>
                  ))}
                </div>
              )}

              {server.toolCount > 0 && (
                <div>
                  <button
                    onClick={() => toggleExpand(server.name)}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      fontSize: '12px',
                      color: 'var(--accent)',
                      cursor: 'pointer',
                    }}
                  >
                    {expanded.has(server.name) ? '▾' : '▸'} {server.toolCount} tools
                  </button>

                  {expanded.has(server.name) && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px' }}>
                      {server.tools.map((tool) => (
                        <span
                          key={tool}
                          style={{
                            fontSize: '11px',
                            padding: '2px 6px',
                            borderRadius: '3px',
                            background: 'var(--surface)',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          {tool}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

