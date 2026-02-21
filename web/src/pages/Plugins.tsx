import { useEffect, useState } from 'react';
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

  // Bulk: toggle all tools in a module
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

  // Bulk: set scope for all tools in a module
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
        // Check if secrets already exist (reinstall case)
        try {
          const existing = await api.getPluginSecrets(id);
          const requiredKeys = Object.entries(plugin.secrets)
            .filter(([, d]) => d.required)
            .map(([k]) => k);
          const allRequiredSet = requiredKeys.every(k => existing.data.configured.includes(k));
          if (allRequiredSet && requiredKeys.length > 0) {
            // All required secrets already configured — skip wizard
            return;
          }
        } catch { /* ignore — show wizard as fallback */ }
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

  return (
    <div>
      <div className="header">
        <h1>Plugins</h1>
        <p>Manage installed plugins and browse the community marketplace</p>
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

      {/* ── Toolbar: tabs + search + actions ── */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
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

        <div style={{ position: 'relative', flex: 1, minWidth: '120px' }}>
          <input
            type="text"
            placeholder="Search plugins..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%', paddingLeft: '34px' }}
          />
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }}
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
        </div>
        {allTags.length > 0 && (
          <Select
            value={tagFilter}
            options={['', ...allTags]}
            labels={['All tags', ...allTags]}
            onChange={(v) => setTagFilter(v)}
            style={{ minWidth: '140px' }}
          />
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

      {/* ── Installed tab ── */}
      {tab === 'installed' && (() => {
        const filtered = manifests.filter((plugin) => {
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
        return (
        <>
          {manifests.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '12px' }}>No plugins installed yet</p>
              <button className="btn-sm" onClick={() => setTab('marketplace')}>
                Browse Marketplace
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '20px', color: 'var(--text-secondary)' }}>
              No installed plugins match your search
            </div>
          ) : filtered.map((plugin) => {
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

            return (
              <div key={plugin.name} className="card" style={{ padding: 0 }}>
                {/* ── Clickable header ── */}
                <div
                  onClick={() => setExpandedPlugin(isExpanded ? null : plugin.name)}
                  className="accordion-header"
                >
                  <span className="accordion-chevron">
                    {isExpanded ? '\u25BC' : '\u25B6'}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <h2 style={{ margin: 0 }}>{plugin.name}</h2>
                      {module && (
                        <span className="badge count">{module.toolCount} tools</span>
                      )}
                      <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                        v{plugin.version}
                      </span>
                      {noneEnabled && module && module.tools.length > 0 && (
                        <span className="badge warn">Disabled</span>
                      )}
                    </div>
                    {plugin.description && (
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0' }}>{plugin.description}</p>
                    )}
                  </div>

                  {/* ── Bulk controls (always visible in header) ── */}
                  {module && module.tools.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                      <Select
                        value={commonScope}
                        options={['', 'always', 'dm-only', 'group-only', 'admin-only']}
                        labels={[mixedScope ? 'Mixed' : 'Scope', 'All', 'DM only', 'Group only', 'Admin only']}
                        onChange={(v) => v && bulkScope(module, v as ToolInfo['scope'])}
                        style={{ minWidth: '110px' }}
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
                    </div>
                  )}
                </div>

                {/* ── Expanded content ── */}
                {isExpanded && (
                  <div style={{ borderTop: '1px solid var(--separator)', padding: '10px 16px 16px' }}>
                    {module && module.tools.length > 0 && (
                      <div style={{ display: 'grid', gap: '6px' }}>
                        {module.tools.map((tool) => (
                          <ToolRow key={tool.name} tool={tool} updating={updating} onToggle={toggleEnabled} onScope={updateScope} />
                        ))}
                      </div>
                    )}

                    {hasSecrets && marketEntry && (
                      <div style={{ marginTop: '10px', borderTop: '1px solid var(--separator)', paddingTop: '10px' }}>
                        <button
                          className="btn-ghost btn-sm"
                          onClick={() => toggleSecrets(marketEntry.id)}
                        >
                          {expandedSecrets === marketEntry.id ? 'Hide Secrets' : 'Manage Secrets'}
                        </button>

                        {expandedSecrets === marketEntry.id && secretsInfo && (
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
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </>
        );
      })()}

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
        <>
          {/* Results */}
          {marketLoading && marketplace.length === 0 ? (
            <div className="loading">Loading marketplace...</div>
          ) : filteredMarketplace.length === 0 ? (
            <div className="empty">
              {search || tagFilter ? 'No plugins match your search' : 'Marketplace is empty'}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '10px' }}>
              {filteredMarketplace.map((plugin) => (
                <MarketplaceCard
                  key={plugin.id}
                  plugin={plugin}
                  operating={operating}
                  onInstall={handleInstall}
                  onUninstall={handleUninstall}
                  onUpdate={handleUpdate}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Marketplace plugin card ──────────────────────────────────────────

function MarketplaceCard({
  plugin,
  operating,
  onInstall,
  onUninstall,
  onUpdate,
}: {
  plugin: MarketplacePlugin;
  operating: string | null;
  onInstall: (id: string) => void;
  onUninstall: (id: string) => void;
  onUpdate: (id: string) => void;
}) {
  const isOp = operating === plugin.id;
  const busy = !!operating;
  const hasRequiredSecrets = plugin.secrets && Object.values(plugin.secrets).some(s => s.required);

  return (
    <div className="card" style={{ marginBottom: '0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}>
        {/* Left: info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>{plugin.name}</h2>
            {plugin.status === 'installed' && (
              <span className="badge always" style={{ fontSize: '10px' }}>Installed</span>
            )}
            {plugin.status === 'updatable' && (
              <span className="badge warn" style={{ fontSize: '10px' }}>Update available</span>
            )}
            {hasRequiredSecrets && plugin.status === 'available' && (
              <span className="badge warn" style={{ fontSize: '10px' }}>Requires API Key</span>
            )}
          </div>

          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 8px 0', lineHeight: '1.5' }}>
            {plugin.description}
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {plugin.tags.map((t) => (
              <span key={t} className="badge" style={{ background: 'var(--surface)', color: 'var(--text-tertiary)' }}>
                {t}
              </span>
            ))}
            <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
              by {plugin.author} · v{plugin.remoteVersion} · {plugin.toolCount} tools
            </span>
          </div>
        </div>

        {/* Right: actions */}
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' }}>
          {plugin.status === 'available' && (
            <button className="btn-sm" onClick={() => onInstall(plugin.id)} disabled={busy}>
              {isOp ? 'Installing...' : 'Install'}
            </button>
          )}
          {plugin.status === 'installed' && (
            <button className="btn-danger btn-sm" onClick={() => onUninstall(plugin.id)} disabled={busy}>
              {isOp ? 'Removing...' : 'Uninstall'}
            </button>
          )}
          {plugin.status === 'updatable' && (
            <>
              <button className="btn-sm" onClick={() => onUpdate(plugin.id)} disabled={busy}>
                {isOp ? 'Updating...' : `Update to v${plugin.remoteVersion}`}
              </button>
              <button className="btn-danger btn-sm" onClick={() => onUninstall(plugin.id)} disabled={busy}>
                Uninstall
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
