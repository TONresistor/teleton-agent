import { useEffect, useState, useCallback } from 'react';
import { api, StatusData, MemoryStats, ToolRagStatus } from '../lib/api';

export interface ProviderMeta {
  needsKey: boolean;
  keyHint: string;
  keyPrefix: string | null;
  consoleUrl: string;
  displayName: string;
}

export function useConfigState() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [toolRag, setToolRag] = useState<ToolRagStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<Array<{ value: string; name: string }>>([]);

  // Provider switch gating state
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);
  const [pendingMeta, setPendingMeta] = useState<ProviderMeta | null>(null);
  const [pendingApiKey, setPendingApiKey] = useState('');
  const [pendingValidating, setPendingValidating] = useState(false);
  const [pendingError, setPendingError] = useState<string | null>(null);

  // Local input state — decoupled from server values to avoid sending empty/partial values
  const [localInputs, setLocalInputs] = useState<Record<string, string>>({});

  const loadData = useCallback(() => {
    Promise.all([api.getStatus(), api.getMemoryStats(), api.getConfigKeys(), api.getToolRag()])
      .then(([statusRes, statsRes, configRes, ragRes]) => {
        setStatus(statusRes.data);
        setStats(statsRes.data);
        setToolRag(ragRes.data);
        // Sync local inputs from server values
        const inputs: Record<string, string> = {};
        for (const c of configRes.data) {
          if (c.value != null) inputs[c.key] = c.value;
        }
        setLocalInputs(inputs);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const getLocal = (key: string): string => localInputs[key] ?? '';

  const showSuccess = (msg: string) => {
    setSaveSuccess(msg);
    setTimeout(() => setSaveSuccess(null), 2000);
  };

  const saveConfig = async (key: string, value: string) => {
    if (!value.trim()) return; // never send empty values
    try {
      setError(null);
      await api.setConfigKey(key, value.trim());
      await loadData();
      showSuccess(`Saved ${key.split('.').pop()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const saveToolRag = async (update: { enabled?: boolean; topK?: number; alwaysInclude?: string[]; skipUnlimitedProviders?: boolean }) => {
    try {
      const res = await api.updateToolRag(update);
      setToolRag(res.data);
      showSuccess('Tool RAG updated');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const setLocal = (key: string, value: string) => {
    setLocalInputs((prev) => ({ ...prev, [key]: value }));
  };

  // Load model options when provider changes
  const currentProvider = getLocal('agent.provider');
  useEffect(() => {
    if (!currentProvider) return;
    api.getModelsForProvider(currentProvider).then((res) => {
      const models = res.data.map((m) => ({ value: m.value, name: m.name }));
      setModelOptions(models);
      // Auto-select first model if current model isn't in the new list
      const currentModel = localInputs['agent.model'] ?? '';
      if (models.length > 0 && !models.some((m) => m.value === currentModel)) {
        saveConfig('agent.model', models[0].value);
      }
    }).catch(() => setModelOptions([]));
  }, [currentProvider]);

  // Handle provider change — gate on API key
  const handleProviderChange = async (newProvider: string) => {
    if (newProvider === currentProvider) return;
    try {
      const res = await api.getProviderMeta(newProvider);
      const meta = res.data;
      if (!meta.needsKey) {
        // No key needed — save directly
        await saveConfig('agent.provider', newProvider);
        setPendingProvider(null);
        setPendingMeta(null);
      } else {
        // Show the gated transition zone
        setPendingProvider(newProvider);
        setPendingMeta(meta);
        setPendingApiKey('');
        setPendingError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleProviderConfirm = async () => {
    if (!pendingProvider || !pendingMeta) return;
    if (pendingMeta.needsKey && !pendingApiKey.trim()) {
      setPendingError('API key is required');
      return;
    }
    setPendingValidating(true);
    setPendingError(null);
    try {
      // Validate API key format
      const valRes = await api.validateApiKey(pendingProvider, pendingApiKey);
      if (!valRes.data.valid) {
        setPendingError(valRes.data.error || 'Invalid API key');
        setPendingValidating(false);
        return;
      }
      // Save provider + API key
      await api.setConfigKey('agent.api_key', pendingApiKey.trim());
      await saveConfig('agent.provider', pendingProvider);
      setPendingProvider(null);
      setPendingMeta(null);
      setPendingApiKey('');
      showSuccess(`Switched to ${pendingMeta.displayName}`);
    } catch (err) {
      setPendingError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingValidating(false);
    }
  };

  const handleProviderCancel = () => {
    setPendingProvider(null);
    setPendingMeta(null);
    setPendingApiKey('');
    setPendingError(null);
  };

  return {
    loading, error, setError, saveSuccess, status, stats, toolRag,
    localInputs, getLocal, setLocal, saveConfig, saveToolRag, showSuccess,
    modelOptions, pendingProvider, pendingMeta, pendingApiKey, setPendingApiKey,
    pendingValidating, pendingError, setPendingError,
    handleProviderChange, handleProviderConfirm, handleProviderCancel, loadData,
  };
}
