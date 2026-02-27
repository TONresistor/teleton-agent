import React, { useEffect, useState } from 'react';
import { api, ToolInfo, ModuleInfo, PluginManifest, MarketplacePlugin, PluginSecretsInfo, SecretDeclaration } from '../lib/api';
import { ToolRow } from '../components/ToolRow';
import { Select } from '../components/Select';

type Tab = 'installed' | 'marketplace';

export function Plugins() {
  const [tab, setTab] = useState<Tab>('installed');
  const [manifests, setManifests] = useState<PluginManifest[]>([]);
  const [pluginModules, setPluginModules] = useState<ModuleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  // Marketplace state
  const [marketplace, setMarketplace] = useState<MarketplacePlugin[]>([]);
  const [marketLoading, setMarketLoading] = useState(false);
  const [operating, setOperating] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('');

  // Secrets wizard state (post-install modal)
  const [secretsWizard, setSecretsWizard] = useState<{ pluginId: string; pluginName: string; secrets: Record<string, SecretDeclaration> } | null>(null);
  const [secretValues, setSecretValues] = useState<Record<string, string>>({});
  const [savingSecrets, setSavingSecrets] = useState(false);

  // Installed tab accordion
  const [expandedPlugin, setExpandedPlugin] = useState<string | null>(null);

  // Inline secrets state (installed tab)
  const [expandedSecrets, setExpandedSecrets] = useState<string | null>(null);
  const [secretsInfo, setSecretsInfo] = useState<PluginSecretsInfo | null>(null);
  const [editingSecret, setEditingSecret] = useState<string | null>(null);
  const [secretInput, setSecretInput] = useState('');

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

  const loadMarketplace = (refresh = false) => {
    setMarketLoading(true);
    return api.getMarketplace(refresh)
      .then((res) => {
        setMarketplace(res.data);
        setMarketLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setMarketLoading(false);
      });
  };

  useEffect(() => {
    loadData();
    loadMarketplace();
  }, []);

  const toggleEnabled = async (toolName: string, currentEnabled: boolean) => {
    setUpdating(toolName);
    try {
      await api.updateToolConfig(toolName, { enabled: !currentEnabled });
      await loadData();
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
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdating(null);
    }
  };

  const bulkToggle = async (module: ModuleInfo, enabled: boolean) => {
    setUpdating(module.name);
    try {
      for (const tool of module.tools) {
        if (tool.enabled !== enabled) {
          await api.updateToolConfig(tool.name, { enabled });
        }
      }
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdating(null);
    }
  };

  const bulkScope = async (module: ModuleInfo, scope: ToolInfo['scope']) => {
    setUpdating(module.name);
    try {
      for (const tool of module.tools) {
        if (tool.scope !== scope) {
          await api.updateToolConfig(tool.name, { scope });
        }
      }
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdating(null);
    }
  };

  const handleInstall = async (id: string) => {
    const plugin = marketplace.find(p => p.id === id);
    setOperating(id);
    try {
      await api.installPlugin(id);
      await Promise.all([loadMarketplace(), loadData()]);
      if (plugin?.secrets && Object.keys(plugin.secrets).length > 0) {
        try {
          const existing = await api.getPluginSecrets(id);
          const requiredKeys = Object.entries(plugin.secrets)
            .filter(([, d]) => d.required)
            .map(([k]) => k);
          const allRequiredSet = requiredKeys.every(k => existing.data.configured.includes(k));
          if (allRequiredSet && requiredKeys.length > 0) return;
        } catch { /* show wizard as fallback */ }
        setSecretsWizard({ pluginId: id, pluginName: plugin.name, secrets: plugin.secrets });
        setSecretValues({});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOperating(null);
    }
  };

  const handleUninstall = async (id: string) => {
    if (!confirm(`Uninstall plugin "${id}"? This will remove its files.`)) return;
    setOperating(id);
    try {
      await api.uninstallPlugin(id);
      await Promise.all([loadMarketplace(), loadData()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOperating(null);
    }
  };

  const handleUpdate = async (id: string) => {
    setOperating(id);
    try {
      await api.updatePlugin(id);
      await Promise.all([loadMarketplace(), loadData()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOperating(null);
    }
  };

  const handleUpdateAll = async () => {
    const toUpdate = marketplace.filter((p) => p.status === 'updatable');
    for (const plugin of toUpdate) {
      setOperating(plugin.id);
      try {
        await api.updatePlugin(plugin.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        break;
      }
    }
    setOperating(null);
    await Promise.all([loadMarketplace(), loadData()]);
  };

  // Inline secrets helpers
  const toggleSecrets = async (pluginId: string) => {
    if (expandedSecrets === pluginId) {
      setExpandedSecrets(null);
      setEditingSecret(null);
      return;
    }
    try {
      const res = await api.getPluginSecrets(pluginId);
      setSecretsInfo(res.data);
      setExpandedSecrets(pluginId);
      setEditingSecret(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const saveSecret = async (pluginId: string, key: string) => {
    if (!secretInput.trim()) return;
    try {
      await api.setPluginSecret(pluginId, key, secretInput.trim());
      setEditingSecret(null);
      setSecretInput('');
      const res = await api.getPluginSecrets(pluginId);
      setSecretsInfo(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const removeSecret = async (pluginId: string, key: string) => {
    try {
      await api.unsetPluginSecret(pluginId, key);
      const res = await api.getPluginSecrets(pluginId);
      setSecretsInfo(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Filter marketplace plugins
  const filteredMarketplace = marketplace.filter((p) => {
    if (search) {
      const q = search.toLowerCase();
      if (!p.name.toLowerCase().includes(q) && !p.description.toLowerCase().includes(q)) {
        return false;
      }
    }
    if (tagFilter && !p.tags.includes(tagFilter)) {
      return false;
    }
    return true;
  });

  const allTags = Array.from(new Set(marketplace.flatMap((p) => p.tags))).sort();
  const updatableCount = marketplace.filter((p) => p.status === 'updatable').length;

  if (loading) return <div className="loading">Loading...</div>;

  // Filter installed plugins
  const filteredInstalled = manifests.filter((plugin) => {
    if (search) {
      const q = search.toLowerCase();
      if (!plugin.name.toLowerCase().includes(q) && !(plugin.description ?? '').toLowerCase().includes(q)) {
        return false;
      }
    }
    if (tagFilter) {
      const entry = marketplace.find(p => p.name === plugin.name);
      if (!entry || !entry.tags.includes(tagFilter)) return false;
    }
    return true;
  });

  const installedToolCount = pluginModules.reduce((sum, m) => sum + m.toolCount, 0);
  const installedEnabledCount = pluginModules.reduce((sum, m) => sum + m.tools.filter(t => t.enabled).length, 0);

  return (
    <div>
      <div className="header">
        <h1>Plugins</h1>
        <p>Manage installed plugins and browse the marketplace</p>
      </div>

      {error && (
        <div className="alert error" style={{ marginBottom: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{error}</span>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button className="btn-ghost btn-sm" onClick={() => setError(null)}>Dismiss</button>
            <button className="btn-sm" onClick={() => { setError(null); loadData(); }}>Retry</button>
          </div>
        </div>
      )}

      {/* Stats bar */}
      <div className="card" style={{ padding: '10px 14px', marginBottom: '14px', display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap', overflow: 'visible', position: 'relative', zIndex: 2 }}>
        <div className="tabs" style={{ marginBottom: 0, flexShrink: 0 }}>
          <button
            className={`tab ${tab === 'installed' ? 'active' : ''}`}
            onClick={() => setTab('installed')}
          >
            Installed
            <span className="tab-count">{manifests.length}</span>
          </button>
          <button
            className={`tab ${tab === 'marketplace' ? 'active' : ''}`}
            onClick={() => setTab('marketplace')}
          >
            Marketplace
            {updatableCount > 0 && (
              <span className="tab-count" style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--text-secondary)' }}>
                {updatableCount}
              </span>
            )}
          </button>
        </div>

        {tab === 'installed' && manifests.length > 0 && (
          <>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              <span style={{ color: 'var(--green)', fontWeight: 600 }}>{installedEnabledCount}</span> enabled
            </span>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              <span style={{ color: 'var(--text)', fontWeight: 600 }}>{installedToolCount}</span> tools
            </span>
          </>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              placeholder="Search plugins..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setSearch(''); }}
              style={{
                padding: '4px 24px 4px 12px',
                fontSize: '13px',
                border: '1px solid var(--separator)',
                borderRadius: '14px',
                backgroundColor: 'transparent',
                color: 'var(--text)',
                width: '180px',
                outline: 'none',
              }}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                style={{
                  position: 'absolute',
                  right: '4px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  padding: '0 2px',
                  fontSize: '14px',
                  lineHeight: 1,
                }}
              >
                &#x2715;
              </button>
            )}
          </div>
          {allTags.length > 0 && (
            <Select
              value={tagFilter}
              options={['', ...allTags]}
              labels={['All tags', ...allTags]}
              onChange={(v) => setTagFilter(v)}
              style={{ minWidth: '120px' }}
            />
          )}
          {tab === 'installed' && updatableCount > 0 && (
            <button
              className="btn-sm"
              onClick={handleUpdateAll}
              disabled={!!operating || marketLoading}
              style={{ whiteSpace: 'nowrap' }}
            >
              {operating ? 'Updating...' : `Update All (${updatableCount})`}
            </button>
          )}
          {tab === 'marketplace' && (
            <>
              {updatableCount > 0 ? (
                <button
                  className="btn-sm"
                  onClick={handleUpdateAll}
                  disabled={!!operating || marketLoading}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {operating ? 'Updating...' : `Update All (${updatableCount})`}
                </button>
              ) : marketplace.length > 0 ? (
                <span style={{ fontSize: '12px', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>All up to date</span>
              ) : null}
              <button
                className="btn-ghost"
                onClick={() => loadMarketplace(true)}
                disabled={marketLoading}
                style={{ whiteSpace: 'nowrap' }}
              >
                {marketLoading ? 'Refreshing...' : 'Refresh'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Installed tab ── */}
      {tab === 'installed' && (
        <div className="card" style={{ padding: 0 }}>
          {manifests.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center' }}>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '12px' }}>No plugins installed yet</p>
              <button className="btn-sm" onClick={() => setTab('marketplace')}>
                Browse Marketplace
              </button>
            </div>
          ) : filteredInstalled.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
              No installed plugins match your search
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--separator)', color: 'var(--text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>
                  <th style={{ textAlign: 'left', padding: '8px 14px' }}>Plugin</th>
                  <th style={{ textAlign: 'center', padding: '8px 10px', width: 60 }}>Tools</th>
                  <th style={{ textAlign: 'center', padding: '8px 10px', width: 60 }}>Version</th>
                  <th style={{ textAlign: 'right', padding: '8px 14px', width: 200 }}>Controls</th>
                </tr>
              </thead>
              <tbody>
                {filteredInstalled.map((plugin) => {
                  const module = pluginModules.find((m) => m.name === plugin.name);
                  const marketEntry = marketplace.find(p => p.name === plugin.name);
                  const hasSecrets = marketEntry?.secrets && Object.keys(marketEntry.secrets).length > 0;
                  const isExpanded = expandedPlugin === plugin.name;
                  const someEnabled = module ? module.tools.some((t) => t.enabled) : false;
                  const noneEnabled = module ? module.tools.every((t) => !t.enabled) : true;
                  const scopes = module ? new Set(module.tools.map((t) => t.scope)) : new Set<string>();
                  const mixedScope = scopes.size > 1;
                  const commonScope = mixedScope ? '' : (scopes.values().next().value ?? 'always');
                  const isBusy = updating === plugin.name;
                  const isUpdatable = marketEntry?.status === 'updatable';

                  return (
                    <React.Fragment key={plugin.name}>
                      <tr
                        onClick={() => setExpandedPlugin(isExpanded ? null : plugin.name)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedPlugin(isExpanded ? null : plugin.name); } }}
                        tabIndex={0}
                        role="button"
                        style={{
                          cursor: 'pointer',
                          borderBottom: isExpanded ? 'none' : '1px solid var(--separator)',
                          backgroundColor: isExpanded ? 'rgba(255,255,255,0.03)' : undefined,
                        }}
                        className="file-row"
                      >
                        <td style={{ padding: '10px 14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ display: 'inline-block', width: '14px', fontSize: '10px', color: 'var(--text-secondary)' }}>
                              {isExpanded ? '\u25BC' : '\u25B6'}
                            </span>
                            <span style={{ fontWeight: 600 }}>{plugin.name}</span>
                            {noneEnabled && module && module.tools.length > 0 && (
                              <span className="badge warn">Disabled</span>
                            )}
                          </div>
                          {plugin.description && (
                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px', paddingLeft: '22px' }}>
                              {plugin.description}
                            </div>
                          )}
                        </td>
                        <td style={{ textAlign: 'center', padding: '8px 10px' }}>
                          {module ? <span className="badge count">{module.toolCount}</span> : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                        </td>
                        <td style={{ textAlign: 'center', padding: '8px 10px' }} onClick={(e) => e.stopPropagation()}>
                          {isUpdatable && marketEntry ? (
                            <button
                              className="btn-sm"
                              onClick={() => handleUpdate(marketEntry.id)}
                              disabled={!!operating}
                              style={{ fontSize: '11px', padding: '3px 8px' }}
                            >
                              {operating === marketEntry.id ? '...' : `v${marketEntry.remoteVersion}`}
                            </button>
                          ) : (
                            <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>v{plugin.version}</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', padding: '8px 14px', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                            {module && module.tools.length > 0 && (
                              <>
                                <Select
                                  value={commonScope}
                                  options={['', 'always', 'dm-only', 'group-only', 'admin-only']}
                                  labels={[mixedScope ? 'Mixed' : 'Scope', 'All', 'DM only', 'Group only', 'Admin only']}
                                  onChange={(v) => v && bulkScope(module, v as ToolInfo['scope'])}
                                  style={{ minWidth: '100px' }}
                                />
                                <label className="toggle">
                                  <input
                                    type="checkbox"
                                    checked={someEnabled}
                                    onChange={() => bulkToggle(module, !someEnabled)}
                                    disabled={isBusy}
                                  />
                                  <span className="toggle-track" />
                                  <span className="toggle-thumb" />
                                </label>
                              </>
                            )}
                            <button
                              onClick={() => handleUninstall(marketEntry?.id ?? plugin.name)}
                              title="Uninstall"
                              disabled={!!operating}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: 'var(--red)', opacity: 0.35, transition: 'opacity 0.15s', display: 'flex', alignItems: 'center' }}
                              onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.35'; }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                <line x1="10" y1="11" x2="10" y2="17" />
                                <line x1="14" y1="11" x2="14" y2="17" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr style={{ backgroundColor: 'rgba(255,255,255,0.03)', borderBottom: '1px solid var(--separator)' }}>
                          <td colSpan={4} style={{ padding: '0 14px 14px 14px' }}>
                            {/* Tool rows */}
                            {module && module.tools.length > 0 && (
                              <div style={{ display: 'grid', gap: '6px', paddingTop: '6px' }}>
                                {module.tools.map((tool) => (
                                  <ToolRow key={tool.name} tool={tool} updating={updating} onToggle={toggleEnabled} onScope={updateScope} />
                                ))}
                              </div>
                            )}

                            {/* Actions row */}
                            <div style={{ display: 'flex', gap: '6px', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--separator)' }}>
                              {hasSecrets && marketEntry && (
                                <button
                                  className="btn-ghost btn-sm"
                                  onClick={() => toggleSecrets(marketEntry.id)}
                                >
                                  {expandedSecrets === marketEntry.id ? 'Hide Secrets' : 'Manage Secrets'}
                                </button>
                              )}
                              {isUpdatable && marketEntry && (
                                <button
                                  className="btn-sm"
                                  onClick={() => handleUpdate(marketEntry.id)}
                                  disabled={!!operating}
                                >
                                  {operating === marketEntry.id ? 'Updating...' : `Update to v${marketEntry.remoteVersion}`}
                                </button>
                              )}
                              {marketEntry && (
                                <button
                                  className="btn-danger btn-sm"
                                  onClick={() => handleUninstall(marketEntry.id)}
                                  disabled={!!operating}
                                  style={{ marginLeft: 'auto' }}
                                >
                                  Uninstall
                                </button>
                              )}
                            </div>

                            {/* Secrets section */}
                            {hasSecrets && marketEntry && expandedSecrets === marketEntry.id && secretsInfo && (
                              <div style={{ marginTop: '8px', display: 'grid', gap: '6px' }}>
                                {Object.entries(secretsInfo.declared).map(([key, decl]) => {
                                  const isSet = secretsInfo.configured.includes(key);
                                  return (
                                    <div key={key} className="tool-row" style={{ padding: '8px 12px', flexWrap: 'wrap' }}>
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <span style={{ fontWeight: 600, fontSize: '13px' }}>{key}</span>
                                        {decl.required && <span style={{ color: 'var(--text-secondary)', marginLeft: '4px', fontSize: '11px' }}>required</span>}
                                        <span className={`badge ${isSet ? 'always' : 'warn'}`} style={{ marginLeft: '8px', fontSize: '10px' }}>
                                          {isSet ? 'Set' : 'Not set'}
                                        </span>
                                        <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', margin: '2px 0 0 0' }}>{decl.description}</p>
                                        {decl.env && (
                                          <code style={{ fontSize: '11px', color: 'var(--text-tertiary)', opacity: 0.7 }}>
                                            Env: {decl.env}
                                          </code>
                                        )}
                                      </div>
                                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                        {editingSecret === key ? (
                                          <>
                                            <input type="password" value={secretInput} onChange={e => setSecretInput(e.target.value)} placeholder="Enter value..." style={{ width: '200px' }} />
                                            <button className="btn-sm" onClick={() => saveSecret(marketEntry.id, key)}>Save</button>
                                            <button className="btn-ghost btn-sm" onClick={() => setEditingSecret(null)}>Cancel</button>
                                          </>
                                        ) : (
                                          <>
                                            <button className="btn-ghost btn-sm" onClick={() => { setEditingSecret(key); setSecretInput(''); }}>
                                              {isSet ? 'Change' : 'Set'}
                                            </button>
                                            {isSet && (
                                              <button className="btn-danger btn-sm" onClick={() => removeSecret(marketEntry.id, key)}>Remove</button>
                                            )}
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Secrets wizard modal ── */}
      {secretsWizard && (
        <div className="modal-overlay" onClick={() => !savingSecrets && setSecretsWizard(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 style={{ marginBottom: '4px' }}>Configure {secretsWizard.pluginName}</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>
              This plugin needs API keys to work. You can configure them now or later.
            </p>
            {Object.entries(secretsWizard.secrets).map(([key, decl]) => (
              <div key={key} style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
                  {key} {decl.required && <span style={{ color: 'var(--text-secondary)' }}>*</span>}
                </label>
                <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', margin: '0 0 4px 0' }}>{decl.description}</p>
                {decl.env && (
                  <code style={{ display: 'block', fontSize: '11px', color: 'var(--text-tertiary)', opacity: 0.7, marginBottom: '6px' }}>
                    Env: {decl.env}
                  </code>
                )}
                <input
                  type="password"
                  placeholder={`Enter ${key}...`}
                  value={secretValues[key] || ''}
                  onChange={e => setSecretValues(prev => ({ ...prev, [key]: e.target.value }))}
                  style={{ width: '100%' }}
                />
              </div>
            ))}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button className="btn-ghost" onClick={() => setSecretsWizard(null)}>Skip</button>
              <button
                className="btn-sm"
                disabled={savingSecrets}
                onClick={async () => {
                  setSavingSecrets(true);
                  try {
                    for (const [key, value] of Object.entries(secretValues)) {
                      if (value.trim()) {
                        await api.setPluginSecret(secretsWizard.pluginId, key, value.trim());
                      }
                    }
                    setSecretsWizard(null);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  } finally {
                    setSavingSecrets(false);
                  }
                }}
              >
                {savingSecrets ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Marketplace tab ── */}
      {tab === 'marketplace' && (
        <div className="card" style={{ padding: 0 }}>
          {marketLoading && marketplace.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center' }}>Loading marketplace...</div>
          ) : filteredMarketplace.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
              {search || tagFilter ? 'No plugins match your search' : 'Marketplace is empty'}
            </div>
          ) : (() => {
            const sorted = [...filteredMarketplace].sort((a, b) => {
              const order = { updatable: 0, installed: 1, available: 2 };
              return order[a.status] - order[b.status];
            });
            return (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--separator)', color: 'var(--text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>
                    <th style={{ textAlign: 'left', padding: '8px 14px' }}>Plugin</th>
                    <th style={{ textAlign: 'center', padding: '8px 10px', width: 60 }}>Tools</th>
                    <th style={{ textAlign: 'center', padding: '8px 10px', width: 60 }}>Version</th>
                    <th style={{ textAlign: 'right', padding: '8px 14px', width: 140 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((plugin) => {
                    const isOp = operating === plugin.id;
                    const busy = !!operating;
                    const hasRequiredSecrets = plugin.secrets && Object.values(plugin.secrets).some(s => s.required);
                    const isExpanded = expandedPlugin === `market-${plugin.id}`;

                    return (
                      <React.Fragment key={plugin.id}>
                        <tr
                          onClick={() => setExpandedPlugin(isExpanded ? null : `market-${plugin.id}`)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedPlugin(isExpanded ? null : `market-${plugin.id}`); } }}
                          tabIndex={0}
                          role="button"
                          style={{
                            cursor: 'pointer',
                            borderBottom: isExpanded ? 'none' : '1px solid var(--separator)',
                            backgroundColor: isExpanded ? 'rgba(255,255,255,0.03)' : undefined,
                          }}
                          className="file-row"
                        >
                          <td style={{ padding: '10px 14px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ display: 'inline-block', width: '14px', fontSize: '10px', color: 'var(--text-secondary)' }}>
                                {isExpanded ? '\u25BC' : '\u25B6'}
                              </span>
                              <span style={{ fontWeight: 600 }}>{plugin.name}</span>
                              {hasRequiredSecrets && plugin.status === 'available' && (
                                <span className="badge warn">API Key</span>
                              )}
                            </div>
                          </td>
                          <td style={{ textAlign: 'center', padding: '8px 10px' }}>
                            <span className="badge count">{plugin.toolCount}</span>
                          </td>
                          <td style={{ textAlign: 'center', padding: '8px 10px', color: 'var(--text-secondary)', fontSize: '12px' }}>
                            v{plugin.remoteVersion}
                          </td>
                          <td style={{ textAlign: 'right', padding: '8px 14px', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                            {plugin.status === 'available' && (
                              <button className="btn-sm" onClick={() => handleInstall(plugin.id)} disabled={busy}>
                                {isOp ? 'Installing...' : 'Install'}
                              </button>
                            )}
                            {plugin.status === 'installed' && (
                              <button className="btn-danger btn-sm" onClick={() => handleUninstall(plugin.id)} disabled={busy}>
                                {isOp ? 'Removing...' : 'Uninstall'}
                              </button>
                            )}
                            {plugin.status === 'updatable' && (
                              <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                                <button className="btn-sm" onClick={() => handleUpdate(plugin.id)} disabled={busy}>
                                  {isOp ? 'Updating...' : 'Update'}
                                </button>
                                <button className="btn-danger btn-sm" onClick={() => handleUninstall(plugin.id)} disabled={busy}>
                                  Uninstall
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr style={{ backgroundColor: 'rgba(255,255,255,0.03)', borderBottom: '1px solid var(--separator)' }}>
                            <td colSpan={4} style={{ padding: '0 14px 14px 14px' }}>
                              <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '4px 12px', fontSize: '12px', padding: '8px 0' }}>
                                <span style={{ color: 'var(--text-secondary)' }}>Author</span>
                                <span>{plugin.author}</span>
                                <span style={{ color: 'var(--text-secondary)' }}>Description</span>
                                <span style={{ color: 'var(--text-secondary)' }}>{plugin.description}</span>
                                {plugin.tags.length > 0 && (
                                  <>
                                    <span style={{ color: 'var(--text-secondary)' }}>Tags</span>
                                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                      {plugin.tags.map((t) => (
                                        <span key={t} style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: 'var(--surface)', color: 'var(--text-tertiary)' }}>
                                          {t}
                                        </span>
                                      ))}
                                    </div>
                                  </>
                                )}
                                {plugin.tools && plugin.tools.length > 0 && (
                                  <>
                                    <span style={{ color: 'var(--text-secondary)' }}>Tools</span>
                                    <span style={{ color: 'var(--text-tertiary)' }}>
                                      {plugin.tools.map(t => t.name).join(', ')}
                                    </span>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            );
          })()}
        </div>
      )}
    </div>
  );
}

