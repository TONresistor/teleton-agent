import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { setup, SetupConfig } from '../../lib/api';
import { errMsg } from '../../lib/utils';

// ── Step metadata ───────────────────────────────────────────────────

const ALL_STEPS = [
  { id: 'welcome',  label: 'Welcome' },
  { id: 'provider', label: 'Provider' },
  { id: 'config',   label: 'Config' },
  { id: 'wallet',   label: 'Wallet' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'connect',  label: 'Connect' },
];

const BOT_EXCLUDED_STEPS = new Set(['telegram', 'connect']);

export function getSteps(telegramMode: 'user' | 'bot') {
  if (telegramMode === 'bot') return ALL_STEPS.filter((s) => !BOT_EXCLUDED_STEPS.has(s.id));
  return ALL_STEPS;
}

// ── Shared types ────────────────────────────────────────────────────

export interface WizardData {
  riskAccepted: boolean;
  agentName: string;
  provider: string;
  apiKey: string;
  gocoonPort: number;
  localUrl: string;
  apiId: number;
  apiHash: string;
  phone: string;
  userId: number;
  mode: 'quick' | 'advanced';
  telegramMode: 'user' | 'bot';
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
  walletAction: 'keep' | 'generate' | 'import';
  mnemonic: string;
  walletAddress: string;
  mnemonicSaved: boolean;
  authSessionId: string;
  telegramUser: { id: number; firstName: string; username: string } | null;
  authMode: 'qr' | 'phone';
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
  gocoonPort: 10000,
  localUrl: 'http://localhost:11434/v1',
  apiId: 0,
  apiHash: '',
  phone: '',
  userId: 0,
  mode: 'quick',
  telegramMode: 'user',
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
  walletAction: 'generate',
  mnemonic: '',
  walletAddress: '',
  mnemonicSaved: false,
  authSessionId: '',
  telegramUser: null,
  authMode: 'qr',
  skipConnect: false,
  webuiEnabled: false,
  execMode: 'off',
};

// ── Validation ──────────────────────────────────────────────────────

function validateStep(step: number, data: WizardData): boolean {
  switch (step) {
    case 0:
      return data.riskAccepted;
    case 1:
      if (!data.provider) return false;
      if (data.provider === 'gocoon') {
        return data.gocoonPort >= 1 && data.gocoonPort <= 65535;
      }
      if (data.provider === 'local') {
        try { new URL(data.localUrl); return true; }
        catch { return false; }
      }
      if (data.provider === 'codex' || data.provider === 'grok-build') return true;
      return data.apiKey.length > 0;
    case 2: {
      // Config
      if (data.provider !== 'gocoon' && data.provider !== 'local') {
        const modelValue = data.model === '__custom__' ? data.customModel : data.model;
        if (!modelValue) return false;
      }
      if (data.telegramMode === 'bot' && !data.botToken) return false;
      return data.userId > 0 && data.maxIterations >= 1 && data.maxIterations <= 50;
    }
    case 3:
      // Wallet: if generated/imported, must confirm mnemonic saved
      if (data.walletAction === 'keep') return true;
      if (!data.walletAddress) return false;
      return data.mnemonicSaved;
    case 4:
      // Telegram — phone required only for phone auth mode
      if (data.apiId <= 0 || data.apiHash.length < 10) return false;
      if (data.authMode === 'phone') return data.phone.startsWith('+');
      return true;
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

  const steps = getSteps(data.telegramMode);
  const canAdvance = validateStep(step, data);

  const next = useCallback(() => {
    if (canAdvance) setStep((s) => Math.min(s + 1, steps.length - 1));
  }, [canAdvance, steps.length]);

  const prev = useCallback(() => {
    setStep((s) => Math.max(s - 1, 0));
  }, []);

  const buildConfig = useCallback((): SetupConfig => {
    const resolvedModel =
      data.model === '__custom__'
        ? data.customModel
        : data.model || undefined;

    return {
      agent: {
        provider: data.provider,
        ...(data.provider !== 'gocoon' && data.provider !== 'local' && data.apiKey ? { api_key: data.apiKey } : {}),
        ...(data.provider === 'local' ? { base_url: data.localUrl } : {}),
        ...(resolvedModel ? { model: resolvedModel } : {}),
        max_agentic_iterations: data.maxIterations,
      },
      telegram: {
        ...(data.telegramMode === 'bot' ? { mode: 'bot' as const } : {}),
        api_id: data.apiId,
        api_hash: data.apiHash,
        phone: data.phone,
        admin_ids: [data.userId],
        owner_id: data.userId,
        dm_policy: data.telegramMode === 'bot' ? 'admin-only' : data.dmPolicy,
        group_policy: data.groupPolicy,
        require_mention: data.telegramMode === 'bot' ? true : data.requireMention,
        ...(data.botToken ? { bot_token: data.botToken } : {}),
        ...(data.botUsername ? { bot_username: data.botUsername } : {}),
      },
      ...(data.provider === 'gocoon' ? { gocoon: { port: data.gocoonPort } } : {}),
      ...(data.tonapiKey ? { tonapi_key: data.tonapiKey } : {}),
      ...(data.toncenterKey ? { toncenter_api_key: data.toncenterKey } : {}),
      ...(data.tavilyKey ? { tavily_api_key: data.tavilyKey } : {}),
      webui: { enabled: true },
    };
  }, [data]);

  // Final save: writes config.yaml and marks the wizard complete (→ SetupComplete).
  const handleSave = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await setup.saveConfig(buildConfig());
      setSaved(true);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }, [buildConfig]);

  // Silent persist: writes config.yaml WITHOUT marking the wizard complete.
  // Used before the Telegram auth flow so the backend has a config to merge into.
  const persistConfig = useCallback(async () => {
    try {
      await setup.saveConfig(buildConfig());
      return true;
    } catch (err) {
      setError(errMsg(err));
      return false;
    }
  }, [buildConfig]);

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
      setLaunchError(errMsg(err));
    } finally {
      setLaunching(false);
    }
  }, []);

  // Persist config.yaml as soon as the user reaches the Connect step (user mode),
  // BEFORE the Telegram auth flow runs. The auth flow (saveSession on the backend)
  // does a read-modify-write of config.yaml to merge the Telegram credentials, so
  // the file must already exist by the time the user submits their login code / 2FA
  // password — otherwise readRawConfig throws "Config file not found". All required
  // data (api_id/api_hash/phone) is already collected in the preceding Telegram step.
  // This is silent: it does NOT mark the wizard complete (the Connect UI must stay).
  const persistRef = useRef(persistConfig);
  persistRef.current = persistConfig;
  const preSavedRef = useRef(false);
  useEffect(() => {
    const onConnectStep = step === steps.length - 1 && data.telegramMode === 'user';
    if (!onConnectStep) {
      // Reset so a return visit (after editing earlier steps) re-persists.
      preSavedRef.current = false;
      return;
    }
    // Fire once per visit; the guard prevents an error from spinning a retry loop.
    if (!preSavedRef.current && !saved) {
      preSavedRef.current = true;
      void persistRef.current();
    }
  }, [step, steps.length, data.telegramMode, saved]);

  // Auto-save when Telegram connects on the last step (user mode only).
  // Marks the wizard complete (→ SetupComplete). config.yaml already exists at this
  // point (persisted on entering Connect + merged with credentials by the backend).
  // In bot mode, the last step is Wallet — save is triggered by the Finish button.
  const saveRef = useRef(handleSave);
  saveRef.current = handleSave;
  useEffect(() => {
    if (step === steps.length - 1 && data.telegramUser && data.telegramMode === 'user' && !saved && !loading) {
      saveRef.current();
    }
  }, [step, steps.length, data.telegramUser, data.telegramMode, saved, loading]);

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
