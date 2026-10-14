import { useCallback, useEffect, useState, Fragment } from 'react';
import { api, ToolInfo, ModuleInfo, PluginManifest, MarketplacePlugin, PluginSecretsInfo, SecretDeclaration } from '../lib/api';
import { ToolRow, LEVEL_OPTIONS } from '../components/ToolRow';
import { PillTabs } from '../components/PillTabs';
import { Select } from '../components/Select';
import { SearchBar } from '../components/SearchBar';
import { Segmented } from '../components/Segmented';
import { List, ListRow } from '../components/List';
import { useToolManager } from '../hooks/useToolManager';
import { errMsg } from '../lib/utils';
import { SkeletonRows } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { useResource } from '../hooks/useResource';
import { RefreshButton } from '../components/RefreshButton';
import { Alert } from '../components/Alert';
import { toast } from '../lib/toast';
import { useConfirm } from '../components/ConfirmDialog';

type Tab = 'installed' | 'marketplace';

// Common access level across a plugin's tools, or '' when mixed.
const pluginCommonLevel = (tools: ToolInfo[]): string => {
  if (tools.length === 0) return '';
  const set = new Set(tools.map((t) => t.level));
  return set.size === 1 ? (set.values().next().value ?? '') : '';
};

interface PluginsData {
  manifests: PluginManifest[];
  pluginModules: ModuleInfo[];
}

export function Plugins() {
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>('installed');

  const { data: pluginsData, loading, error, reload, setError } = useResource<PluginsData>(
    () => Promise.all([api.getPlugins(), api.getTools()]).then(([pluginsRes, toolsRes]) => ({
      manifests: pluginsRes.data,
      pluginModules: toolsRes.data.filter((m) => m.isPlugin),
    })),
    [],
  );

  const manifests = pluginsData?.manifests ?? [];
  const pluginModules = pluginsData?.pluginModules ?? [];

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

  const { updating, updateLevel, bulkLevel } = useToolManager(reload);

  const loadMarketplace = useCallback((refresh = false) => {
    setMarketLoading(true);
    return api.getMarketplace(refresh)
      .then((res) => {
        setMarketplace(res.data);
        setMarketLoading(false);
      })
      .catch((err) => {
        setError(errMsg(err));
        setMarketLoading(false);
      });
  }, [setError]);

  useEffect(() => {
    loadMarketplace();
  }, [loadMarketplace]);

  const handleInstall = async (id: string) => {
    const plugin = marketplace.find(p => p.id === id);
    setOperating(id);
    try {
      await api.installPlugin(id);
      await Promise.all([loadMarketplace(), reload()]);
      toast.success('Plugin installed');
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
      setError(errMsg(err));
      toast.error(errMsg(err));
    } finally {
      setOperating(null);
    }
  };

  const handleUninstall = async (id: string) => {
    if (!(await confirm({ message: `Uninstall plugin "${id}"? This will remove its files.`, destructive: true, confirmLabel: 'Uninstall' }))) return;
    setOperating(id);
    try {
      await api.uninstallPlugin(id);
      await Promise.all([loadMarketplace(), reload()]);
      toast.success('Plugin uninstalled');
    } catch (err) {
      setError(errMsg(err));
      toast.error(errMsg(err));
    } finally {
      setOperating(null);
    }
  };

  const handleUpdate = async (id: string) => {
    setOperating(id);
    try {
      await api.updatePlugin(id);
      await Promise.all([loadMarketplace(), reload()]);
      toast.success('Plugin updated');
    } catch (err) {
      setError(errMsg(err));
      toast.error(errMsg(err));
    } finally {
      setOperating(null);
    }
  };

  const handleUpdateAll = async () => {
    const toUpdate = marketplace.filter((p) => p.status === 'updatable');
    const total = toUpdate.length;
    let succeeded = 0;
    let failed = 0;
    let lastError: string | null = null;
    for (const plugin of toUpdate) {
      setOperating(plugin.id);
      try {
        await api.updatePlugin(plugin.id);
        succeeded++;
      } catch (err) {
        failed++;
        lastError = errMsg(err);
      }
    }
    setOperating(null);
    await Promise.all([loadMarketplace(), reload()]);
    if (succeeded > 0) {
      toast.success(`Updated ${succeeded}/${total} plugins`);
    }
    if (failed > 0) {
      toast.error(`${failed} plugin${failed === 1 ? '' : 's'} failed to update`);
      setError(lastError);
    }
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
      setError(errMsg(err));
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
      toast.success('Secret saved');
    } catch (err) {
      setError(errMsg(err));
      toast.error(errMsg(err));
    }
  };

  const removeSecret = async (pluginId: string, key: string) => {
    if (!(await confirm({ message: `Remove secret "${key}"?`, destructive: true, confirmLabel: 'Remove' }))) return;
    try {
      await api.unsetPluginSecret(pluginId, key);
      const res = await api.getPluginSecrets(pluginId);
      setSecretsInfo(res.data);
      toast.success('Secret removed');
    } catch (err) {
      setError(errMsg(err));
      toast.error(errMsg(err));
    }
  };

  // Filters
  const filteredMarketplace = marketplace.filter((p) => {
    if (search) {
      const q = search.toLowerCase();
      if (!p.name.toLowerCase().includes(q) && !p.description.toLowerCase().includes(q)) return false;
    }
    if (tagFilter && !p.tags.includes(tagFilter)) return false;
    return true;
  });

  const allTags = Array.from(new Set(marketplace.flatMap((p) => p.tags))).sort();
  const updatableCount = marketplace.filter((p) => p.status === 'updatable').length;

  if (loading) {
    return (
      <div>
        <div className="header"><h1>Plugins</h1><p>Loading plugins…</p></div>
        <SkeletonRows />
      </div>
    );
  }

  const filteredInstalled = manifests.filter((plugin) => {
    if (search) {
      const q = search.toLowerCase();
      if (!plugin.name.toLowerCase().includes(q) && !(plugin.description ?? '').toLowerCase().includes(q)) return false;
    }
    if (tagFilter) {
      const entry = marketplace.find(p => p.name === plugin.name);
      if (!entry || !entry.tags.includes(tagFilter)) return false;
    }
    return true;
  });

  const filtering = !!search || !!tagFilter;

  return (
    <div>
      <div className="header">
        <h1>Plugins</h1>
        <p>Manage installed plugins and browse the marketplace</p>
      </div>

      {error && (
        <Alert type="error" message={error} onDismiss={() => setError(null)} style={{ marginBottom: '14px' }}>
          <button className="btn-sm" onClick={() => { setError(null); reload(); }}>Retry</button>
        </Alert>
      )}

      {/* Controls */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap' }}>
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          ariaLabel="Plugins view"
          options={[
            { value: 'installed', label: `Installed ${manifests.length}` },
            { value: 'marketplace', label: updatableCount > 0 ? `Marketplace · ${updatableCount}` : 'Marketplace' },
          ]}
        />
        <div style={{ flex: 1, minWidth: '180px' }}>
          <SearchBar value={search} onChange={setSearch} placeholder="Search plugins…" />
        </div>
        {allTags.length > 0 && (
          <Select
            value={tagFilter}
            options={['', ...allTags]}
            labels={['All tags', ...allTags]}
            onChange={setTagFilter}
            style={{ minWidth: '120px' }}
          />
        )}
        {updatableCount > 0 && (
          <button className="btn-sm" onClick={handleUpdateAll} disabled={!!operating || marketLoading} style={{ whiteSpace: 'nowrap' }}>
            {operating ? 'Updating…' : `Update all (${updatableCount})`}
          </button>
        )}
        {tab === 'marketplace' && (
          <RefreshButton onRefresh={() => loadMarketplace(true)} />
        )}
      </div>

      {/* ── Installed tab ── */}
      {tab === 'installed' && (
        manifests.length === 0 ? (
          <div className="card" style={{ padding: 0 }}>
            <EmptyState
              title="No plugins installed"
              description="Browse the marketplace to add capabilities to your agent."
              action={<button className="btn-sm" onClick={() => setTab('marketplace')}>Browse Marketplace</button>}
            />
          </div>
        ) : filteredInstalled.length === 0 ? (
          <div className="card" style={{ padding: 0 }}>
            <EmptyState
              title="No plugins found"
              description="No installed plugins match your filters."
              action={<button className="btn-ghost btn-sm" onClick={() => { setSearch(''); setTagFilter(''); }}>Clear filters</button>}
            />
          </div>
        ) : (
          <List>
            {filteredInstalled.map((plugin) => {
              const module = pluginModules.find((m) => m.name === plugin.name);
              const marketEntry = marketplace.find(p => p.name === plugin.name);
              const hasSecrets = marketEntry?.secrets && Object.keys(marketEntry.secrets).length > 0;
              const isExpanded = expandedPlugin === plugin.name;
              const hasTools = !!module && module.tools.length > 0;
              const commonLevel = pluginCommonLevel(module?.tools ?? []);
              const isBusy = updating === plugin.name || operating === (marketEntry?.id ?? plugin.name);
              const isUpdatable = marketEntry?.status === 'updatable';

              return (
                <Fragment key={plugin.name}>
                  <ListRow
                    leading={plugin.name.charAt(0).toUpperCase()}
                    title={
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                        {plugin.name}
                        {isUpdatable && <span className="badge" style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}>Update</span>}
                      </span>
                    }
                    subtitle={plugin.description || `v${plugin.version}`}
                    disclosure
                    expanded={isExpanded}
                    onClick={() => setExpandedPlugin(isExpanded ? null : plugin.name)}
                    trailing={hasTools ? (
                      <PillTabs
                        value={commonLevel}
                        options={LEVEL_OPTIONS}
                        onChange={(v) => bulkLevel(module!, v as ToolInfo['level'])}
                        disabled={isBusy}
                        ariaLabel={`Access level for all ${plugin.name} tools`}
                      />
                    ) : undefined}
                  />
                  {isExpanded && (
                    <div className="ios-sublist">
                      {hasTools && module!.tools.map((tool) => (
                        <ToolRow key={tool.name} tool={tool} updating={updating} onLevel={updateLevel} />
                      ))}

                      {/* Actions */}
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '12px 16px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 'var(--font-sm)', color: 'var(--text-secondary)' }}>v{plugin.version}</span>
                        {hasSecrets && marketEntry && (
                          <button className="btn-ghost btn-sm" onClick={() => toggleSecrets(marketEntry.id)}>
                            {expandedSecrets === marketEntry.id ? 'Hide secrets' : 'Manage secrets'}
                          </button>
                        )}
                        {isUpdatable && marketEntry && (
                          <button className="btn-sm" onClick={() => handleUpdate(marketEntry.id)} disabled={!!operating}>
                            {operating === marketEntry.id ? 'Updating…' : `Update to v${marketEntry.remoteVersion}`}
                          </button>
                        )}
                        <button
                          className="btn-danger btn-sm"
                          style={{ marginLeft: 'auto' }}
                          onClick={() => handleUninstall(marketEntry?.id ?? plugin.name)}
                          disabled={!!operating}
                        >
                          Uninstall
                        </button>
                      </div>

                      {/* Secrets editor */}
                      {hasSecrets && marketEntry && expandedSecrets === marketEntry.id && secretsInfo && (
                        <div style={{ display: 'grid', gap: '6px', padding: '0 16px 14px' }}>
                          {Object.entries(secretsInfo.declared).map(([key, decl]) => {
                            const isSet = secretsInfo.configured.includes(key);
                            return (
                              <div key={key} className="card" style={{ padding: '10px 12px', display: 'flex', gap: '8px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <span style={{ fontWeight: 600, fontSize: 'var(--font-sm)' }}>{key}</span>
                                  {decl.required && <span style={{ color: 'var(--text-secondary)', marginLeft: '4px', fontSize: 'var(--font-xs)' }}>required</span>}
                                  <span className={`badge ${isSet ? 'always' : 'warn'}`} style={{ marginLeft: '8px', fontSize: '10px' }}>
                                    {isSet ? 'Set' : 'Not set'}
                                  </span>
                                  {decl.description && <p style={{ fontSize: 'var(--font-sm)', color: 'var(--text-tertiary)', margin: '2px 0 0 0' }}>{decl.description}</p>}
                                  {decl.env && <code style={{ fontSize: 'var(--font-xs)', color: 'var(--text-tertiary)', opacity: 0.7 }}>Env: {decl.env}</code>}
                                </div>
                                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                  {editingSecret === key ? (
                                    <>
                                      <input type="password" value={secretInput} onChange={e => setSecretInput(e.target.value)} placeholder="Enter value…" aria-label={`Value for ${key}`} style={{ width: '200px' }} />
                                      <button className="btn-sm" onClick={() => saveSecret(marketEntry.id, key)}>Save</button>
                                      <button className="btn-ghost btn-sm" onClick={() => setEditingSecret(null)}>Cancel</button>
                                    </>
                                  ) : (
                                    <>
                                      <button className="btn-ghost btn-sm" onClick={() => { setEditingSecret(key); setSecretInput(''); }}>
                                        {isSet ? 'Change' : 'Set'}
                                      </button>
                                      {isSet && <button className="btn-danger btn-sm" onClick={() => removeSecret(marketEntry.id, key)}>Remove</button>}
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
                </Fragment>
              );
            })}
          </List>
        )
      )}

      {/* ── Marketplace tab ── */}
      {tab === 'marketplace' && (
        marketLoading && marketplace.length === 0 ? (
          <SkeletonRows />
        ) : filteredMarketplace.length === 0 ? (
          <div className="card" style={{ padding: 0 }}>
            <EmptyState
              title={filtering ? 'No plugins found' : 'Marketplace is empty'}
              description={filtering ? 'No marketplace plugins match your filters.' : 'Check back later for new plugins.'}
              action={filtering ? <button className="btn-ghost btn-sm" onClick={() => { setSearch(''); setTagFilter(''); }}>Clear filters</button> : undefined}
            />
          </div>
        ) : (
          <List>
            {[...filteredMarketplace]
              .sort((a, b) => ({ updatable: 0, installed: 1, available: 2 }[a.status] - { updatable: 0, installed: 1, available: 2 }[b.status]))
              .map((plugin) => {
                const isOp = operating === plugin.id;
                const busy = !!operating;
                const hasRequiredSecrets = plugin.secrets && Object.values(plugin.secrets).some(s => s.required);
                const isExpanded = expandedPlugin === `market-${plugin.id}`;

                return (
                  <Fragment key={plugin.id}>
                    <ListRow
                      leading={plugin.name.charAt(0).toUpperCase()}
                      title={
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                          {plugin.name}
                          {hasRequiredSecrets && plugin.status === 'available' && <span className="badge warn">API Key</span>}
                          {plugin.status === 'installed' && <span className="badge" style={{ background: 'var(--green-dim)', color: 'var(--green)' }}>Installed</span>}
                        </span>
                      }
                      subtitle={`${plugin.description}  ·  v${plugin.remoteVersion}`}
                      disclosure
                      expanded={isExpanded}
                      onClick={() => setExpandedPlugin(isExpanded ? null : `market-${plugin.id}`)}
                      trailing={
                        plugin.status === 'available' ? (
                          <button className="btn-sm" onClick={() => handleInstall(plugin.id)} disabled={busy}>
                            {isOp ? 'Installing…' : 'Install'}
                          </button>
                        ) : plugin.status === 'updatable' ? (
                          <button className="btn-sm" onClick={() => handleUpdate(plugin.id)} disabled={busy}>
                            {isOp ? 'Updating…' : 'Update'}
                          </button>
                        ) : (
                          <button className="btn-danger btn-sm" onClick={() => handleUninstall(plugin.id)} disabled={busy}>
                            {isOp ? 'Removing…' : 'Uninstall'}
                          </button>
                        )
                      }
                    />
                    {isExpanded && (
                      <div className="ios-sublist" style={{ padding: '10px 16px 14px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '4px 12px', fontSize: 'var(--font-sm)' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Author</span>
                          <span>{plugin.author}</span>
                          <span style={{ color: 'var(--text-secondary)' }}>Description</span>
                          <span style={{ color: 'var(--text-secondary)' }}>{plugin.description}</span>
                          {plugin.tags.length > 0 && (
                            <>
                              <span style={{ color: 'var(--text-secondary)' }}>Tags</span>
                              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                {plugin.tags.map((t) => (
                                  <span key={t} className="tag-pill">{t}</span>
                                ))}
                              </div>
                            </>
                          )}
                          {plugin.tools && plugin.tools.length > 0 && (
                            <>
                              <span style={{ color: 'var(--text-secondary)' }}>Tools</span>
                              <span style={{ color: 'var(--text-tertiary)' }}>{plugin.tools.map(t => t.name).join(', ')}</span>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </Fragment>
                );
              })}
          </List>
        )
      )}

      {/* ── Secrets wizard modal ── */}
      {secretsWizard && (
        <div className="modal-overlay" onClick={() => !savingSecrets && setSecretsWizard(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 style={{ marginBottom: '4px' }}>Configure {secretsWizard.pluginName}</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-sm)', marginBottom: '16px' }}>
              This plugin needs API keys to work. You can configure them now or later.
            </p>
            {Object.entries(secretsWizard.secrets).map(([key, decl]) => (
              <div key={key} style={{ marginBottom: '12px' }}>
                <label htmlFor={`secret-${key}`} style={{ display: 'block', fontSize: 'var(--font-sm)', fontWeight: 600, marginBottom: '4px' }}>
                  {key} {decl.required && <span style={{ color: 'var(--text-secondary)' }}>*</span>}
                </label>
                {decl.description && <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-tertiary)', margin: '0 0 4px 0' }}>{decl.description}</p>}
                {decl.env && <code style={{ display: 'block', fontSize: 'var(--font-xs)', color: 'var(--text-tertiary)', opacity: 0.7, marginBottom: '6px' }}>Env: {decl.env}</code>}
                <input
                  id={`secret-${key}`}
                  type="password"
                  placeholder={`Enter ${key}…`}
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
                    toast.success('Secrets saved');
                    setSecretsWizard(null);
                  } catch (err) {
                    setError(errMsg(err));
                    toast.error(errMsg(err));
                  } finally {
                    setSavingSecrets(false);
                  }
                }}
              >
                {savingSecrets ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
