import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { setup, SetupConfig } from '../../lib/api';

// ── Step metadata ───────────────────────────────────────────────────

export const STEPS = [
  { id: 'welcome',  label: 'Welcome' },
  { id: 'provider', label: 'Provider' },
  { id: 'config',   label: 'Config' },
  { id: 'wallet',   label: 'Wallet' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'connect',  label: 'Connect' },
];

// ── Shared types ────────────────────────────────────────────────────

export interface WizardData {
  riskAccepted: boolean;
  agentName: string;
  provider: string;
  apiKey: string;
  cocoonPort: number;
  localUrl: string;
  apiId: number;
  apiHash: string;
  phone: string;
  userId: number;
  mode: 'quick' | 'advanced';
  model: string;
  customModel: string;
  dmPolicy: string;
  groupPolicy: string;
  requireMention: boolean;
  maxIterations: number;
  botToken: string;
  botUsername: string;
  tonapiKey: string;
  toncenterKey: string;
  tavilyKey: string;
  customizeThresholds: boolean;
  buyMaxFloor: number;
  sellMinFloor: number;
  walletAction: 'keep' | 'generate' | 'import';
  mnemonic: string;
  walletAddress: string;
  mnemonicSaved: boolean;
  authSessionId: string;
  telegramUser: { id: number; firstName: string; username: string } | null;
  skipConnect: boolean;
  webuiEnabled: boolean;
  execMode: 'off' | 'yolo';
}

export interface StepProps {
  data: WizardData;
  onChange: (data: WizardData) => void;
}

const DEFAULTS: WizardData = {
  riskAccepted: false,
  agentName: 'Nova',
  provider: '',
  apiKey: '',
  cocoonPort: 11435,
  localUrl: 'http://localhost:11434/v1',
  apiId: 0,
  apiHash: '',
  phone: '',
  userId: 0,
  mode: 'quick',
  model: '',
  customModel: '',
  dmPolicy: 'admin-only',
  groupPolicy: 'admin-only',
  requireMention: true,
  maxIterations: 5,
  botToken: '',
  botUsername: '',
  tonapiKey: '',
  toncenterKey: '',
  tavilyKey: '',
  customizeThresholds: false,
  buyMaxFloor: 95,
  sellMinFloor: 105,
  walletAction: 'generate',
  mnemonic: '',
  walletAddress: '',
  mnemonicSaved: false,
  authSessionId: '',
  telegramUser: null,
  skipConnect: false,
  webuiEnabled: false,
  execMode: 'off',
};

// ── Validation ──────────────────────────────────────────────────────

export function validateStep(step: number, data: WizardData): boolean {
  switch (step) {
    case 0:
      return data.riskAccepted;
    case 1:
      if (!data.provider) return false;
      if (data.provider === 'cocoon') {
        return data.cocoonPort >= 1 && data.cocoonPort <= 65535;
      }
      if (data.provider === 'local') {
        try { new URL(data.localUrl); return true; }
        catch { return false; }
      }
      if (data.provider === 'claude-code') {
        return true; // credentials auto-detected or fallback handled by ProviderStep
      }
      return data.apiKey.length > 0;
    case 2: {
      // Config
      if (data.provider !== 'cocoon' && data.provider !== 'local') {
        const modelValue = data.model === '__custom__' ? data.customModel : data.model;
        if (!modelValue) return false;
      }
      return data.userId > 0 && data.maxIterations >= 1 && data.maxIterations <= 50;
    }
    case 3:
      // Wallet: if generated/imported, must confirm mnemonic saved
      if (data.walletAction === 'keep') return true;
      if (!data.walletAddress) return false;
      return data.mnemonicSaved;
    case 4:
      // Telegram
      return (
        data.apiId > 0 &&
        data.apiHash.length >= 10 &&
        data.phone.startsWith('+')
      );
    case 5:
      return data.telegramUser !== null || data.skipConnect;
    default:
      return false;
  }
}

// ── Context ─────────────────────────────────────────────────────────

interface SetupContextValue {
  step: number;
  data: WizardData;
  loading: boolean;
  error: string;
  saved: boolean;
  launching: boolean;
  launchError: string;
  canAdvance: boolean;
  setData: (data: WizardData) => void;
  next: () => void;
  prev: () => void;
  handleSave: () => Promise<void>;
  handleLaunch: () => Promise<void>;
}

const SetupContext = createContext<SetupContextValue | null>(null);

export function useSetup(): SetupContextValue {
  const ctx = useContext(SetupContext);
  if (!ctx) throw new Error('useSetup must be used inside SetupProvider');
  return ctx;
}

// ── Provider ────────────────────────────────────────────────────────

export function SetupProvider({ children }: { children: ReactNode }) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>(DEFAULTS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState('');

  const canAdvance = validateStep(step, data);

  const next = useCallback(() => {
    if (canAdvance) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }, [canAdvance]);

  const prev = useCallback(() => {
    setStep((s) => Math.max(s - 1, 0));
  }, []);

  const handleSave = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const resolvedModel =
        data.model === '__custom__'
          ? data.customModel
          : data.model || undefined;

      const config: SetupConfig = {
        agent: {
          provider: data.provider,
          ...(data.provider !== 'cocoon' && data.provider !== 'local' && data.apiKey ? { api_key: data.apiKey } : {}),
          ...(data.provider === 'local' ? { base_url: data.localUrl } : {}),
          ...(resolvedModel ? { model: resolvedModel } : {}),
          max_agentic_iterations: data.maxIterations,
        },
        telegram: {
          api_id: data.apiId,
          api_hash: data.apiHash,
          phone: data.phone,
          admin_ids: [data.userId],
          owner_id: data.userId,
          dm_policy: data.dmPolicy,
          group_policy: data.groupPolicy,
          require_mention: data.requireMention,
          ...(data.botToken ? { bot_token: data.botToken } : {}),
          ...(data.botUsername ? { bot_username: data.botUsername } : {}),
        },
        ...(data.provider === 'cocoon' ? { cocoon: { port: data.cocoonPort } } : {}),
        deals: {
          enabled: !!data.botToken,
          ...(data.customizeThresholds
            ? { buy_max_floor_percent: data.buyMaxFloor, sell_min_floor_percent: data.sellMinFloor }
            : {}),
        },
        ...(data.tonapiKey ? { tonapi_key: data.tonapiKey } : {}),
        ...(data.toncenterKey ? { toncenter_api_key: data.toncenterKey } : {}),
        ...(data.tavilyKey ? { tavily_api_key: data.tavilyKey } : {}),
        webui: { enabled: true },
      };

      await setup.saveConfig(config);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [data]);

  const handleLaunch = useCallback(async () => {
    setLaunching(true);
    setLaunchError('');
    try {
      const { token } = await setup.launch();
      // Poll until the agent WebUI is up
      await setup.pollHealth(30000);
      // Redirect to the dashboard with token-based auth
      window.location.href = `/auth/exchange?token=${encodeURIComponent(token)}`;
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : String(err));
    } finally {
      setLaunching(false);
    }
  }, []);

  // Auto-save when Telegram connects on the last step
  const saveRef = useRef(handleSave);
  saveRef.current = handleSave;
  useEffect(() => {
    if (step === STEPS.length - 1 && data.telegramUser && !saved && !loading) {
      saveRef.current();
    }
  }, [step, data.telegramUser, saved, loading]);

  return (
    <SetupContext.Provider
      value={{
        step,
        data,
        loading,
        error,
        saved,
        launching,
        launchError,
        canAdvance,
        setData,
        next,
        prev,
        handleSave,
        handleLaunch,
      }}
    >
      {children}
    </SetupContext.Provider>
  );
}
