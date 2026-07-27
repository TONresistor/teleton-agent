import { ProviderMeta } from '../hooks/useConfigState';
import { Select } from './Select';
import { EditableField } from './EditableField';
import { InfoTip } from './InfoTip';
import { ProviderSwitchZone, PROVIDER_OPTIONS, PROVIDER_LABELS } from './ProviderControl';

interface AgentSettingsPanelProps {
  getLocal: (key: string) => string;
  getServer?: (key: string) => string;
  setLocal: (key: string, value: string) => void;
  saveConfig: (key: string, value: string) => Promise<void>;
  cancelLocal?: (key: string) => void;
  modelOptions: Array<{ value: string; name: string }>;
  pendingProvider: string | null;
  pendingMeta: ProviderMeta | null;
  pendingApiKey: string;
  setPendingApiKey: (v: string) => void;
  pendingValidating: boolean;
  pendingError: string | null;
  setPendingError: (v: string | null) => void;
  handleProviderChange: (provider: string) => Promise<void>;
  handleProviderConfirm: () => Promise<void>;
  handleProviderCancel: () => void;
  /** Hide temperature/tokens/iterations (Dashboard mode) */
  compact?: boolean;
  /** Hide the Provider select + switch zone (rendered elsewhere, e.g. Dashboard hero) */
  hideProvider?: boolean;
}

export function AgentSettingsPanel({
  getLocal, getServer = () => '', setLocal, saveConfig, cancelLocal = () => {},
  modelOptions,
  pendingProvider, pendingMeta, pendingApiKey, setPendingApiKey,
  pendingValidating, pendingError, setPendingError,
  handleProviderChange, handleProviderConfirm, handleProviderCancel,
  compact = false,
  hideProvider = false,
}: AgentSettingsPanelProps) {
  return (
    <>
      <div style={{ display: 'grid', gap: '16px' }}>
        {!hideProvider && (
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Provider <InfoTip text="LLM provider" /></label>
            <Select
              value={pendingProvider ?? getLocal('agent.provider')}
              options={PROVIDER_OPTIONS}
              labels={PROVIDER_LABELS}
              onChange={handleProviderChange}
            />
          </div>
        )}

        {!hideProvider && pendingProvider && pendingMeta && (
          <ProviderSwitchZone
            pendingMeta={pendingMeta}
            pendingApiKey={pendingApiKey}
            setPendingApiKey={setPendingApiKey}
            pendingValidating={pendingValidating}
            pendingError={pendingError}
            setPendingError={setPendingError}
            onConfirm={handleProviderConfirm}
            onCancel={handleProviderCancel}
          />
        )}

        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>Model <InfoTip text="Main LLM model ID" /></label>
          <Select
            value={getLocal('agent.model')}
            options={modelOptions.map((m) => m.value)}
            labels={modelOptions.map((m) => m.name)}
            onChange={(v) => saveConfig('agent.model', v)}
          />
        </div>
        {!compact && (
          <div style={{ display: 'grid', gap: '12px' }}>
            <EditableField
              label="Temperature"
              description="Response creativity (0.0 = deterministic, 1.0 = max)"
              configKey="agent.temperature"
              type="number"
              value={getLocal('agent.temperature')}
              serverValue={getServer('agent.temperature')}
              onChange={(v) => setLocal('agent.temperature', v)}
              onSave={(v) => saveConfig('agent.temperature', v)}
              onCancel={() => cancelLocal('agent.temperature')}
              min={0}
              max={1}
              step={0.1}
              inline
            />
            <EditableField
              label="Max Tokens"
              description="Maximum response length in tokens"
              configKey="agent.max_tokens"
              type="number"
              value={getLocal('agent.max_tokens')}
              serverValue={getServer('agent.max_tokens')}
              onChange={(v) => setLocal('agent.max_tokens', v)}
              onSave={(v) => saveConfig('agent.max_tokens', v)}
              onCancel={() => cancelLocal('agent.max_tokens')}
              min={100}
              step={100}
              inline
            />
            <EditableField
              label="Max Iterations"
              description="Max tool-call loop iterations per message"
              configKey="agent.max_agentic_iterations"
              type="number"
              value={getLocal('agent.max_agentic_iterations')}
              serverValue={getServer('agent.max_agentic_iterations')}
              onChange={(v) => setLocal('agent.max_agentic_iterations', v)}
              onSave={(v) => saveConfig('agent.max_agentic_iterations', v)}
              onCancel={() => cancelLocal('agent.max_agentic_iterations')}
              min={1}
              max={50}
              inline
            />
            <EditableField
              label="Turn Time Budget"
              description="Maximum turn duration in milliseconds"
              configKey="agent.max_turn_duration_ms"
              type="number"
              value={getLocal('agent.max_turn_duration_ms')}
              serverValue={getServer('agent.max_turn_duration_ms')}
              onChange={(v) => setLocal('agent.max_turn_duration_ms', v)}
              onSave={(v) => saveConfig('agent.max_turn_duration_ms', v)}
              onCancel={() => cancelLocal('agent.max_turn_duration_ms')}
              min={10000}
              max={900000}
              step={10000}
              inline
            />
          </div>
        )}
      </div>
    </>
  );
}
