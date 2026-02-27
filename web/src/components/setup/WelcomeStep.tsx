import { useState, useEffect } from 'react';
import { setup, SetupStatusResponse } from '../../lib/api';
import type { StepProps } from '../../pages/Setup';

export function WelcomeStep({ data, onChange }: StepProps) {
  const [status, setStatus] = useState<SetupStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [initDone, setInitDone] = useState(false);

  useEffect(() => {
    setup.getStatus()
      .then((s) => setStatus(s))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  const handleAccept = async (accepted: boolean) => {
    onChange({ ...data, riskAccepted: accepted });
    if (accepted && !initDone) {
      try {
        await setup.initWorkspace(data.agentName || undefined);
        setInitDone(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  };

  return (
    <div className="step-content">
      <h2 className="step-title">Welcome to Teleton Setup</h2>
      <p className="step-description">
        Configure your autonomous Telegram agent in a few steps.
      </p>

      <details className="guide-dropdown">
        <summary>Security Notice</summary>
        <div className="guide-content">
          This software is an autonomous AI agent that can:
          <ul style={{ margin: '8px 0 8px 20px' }}>
            <li>Send and receive Telegram messages on your behalf</li>
            <li>Execute cryptocurrency transactions using your wallet</li>
            <li>Access and store conversation data</li>
            <li>Make decisions and take actions autonomously</li>
          </ul>
          You are solely responsible for all actions taken by this agent.
          By proceeding, you acknowledge that you understand these risks
          and accept full responsibility for the agent's behavior.
          <br /><br />
          <strong>Never share your API keys, wallet mnemonics, or session files.</strong>
        </div>
      </details>

      <div className="form-group">
        <label>Agent Name</label>
        <input
          type="text"
          value={data.agentName}
          onChange={(e) => onChange({ ...data, agentName: e.target.value })}
          placeholder="Nova"
          className="w-full"
        />
        <div className="helper-text">
          Your agent's display name in conversations.
        </div>
      </div>

      {status?.configExists && (
        <div className="info-box">
          Existing configuration detected. It will be overwritten when setup completes.
        </div>
      )}

      {error && <div className="alert error">{error}</div>}

      <div className="form-group">
        <label className="label-inline">
          <input
            type="checkbox"
            checked={data.riskAccepted}
            onChange={(e) => handleAccept(e.target.checked)}
          />
          <span>I understand the risks and accept full responsibility</span>
        </label>
      </div>

      {loading && <div className="loading">Checking workspace...</div>}
    </div>
  );
}
