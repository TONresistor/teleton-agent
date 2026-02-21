import { useState, useEffect, useCallback } from 'react';
import { setup, WalletStatus } from '../../lib/api';
import type { StepProps } from '../../pages/Setup';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);
  return (
    <button type="button" className="btn-ghost btn-sm" onClick={handleCopy} style={{ marginLeft: '8px' }}>
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export function WalletStep({ data, onChange }: StepProps) {
  const [walletStatus, setWalletStatus] = useState<WalletStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [mnemonicWords, setMnemonicWords] = useState<string[]>([]);

  useEffect(() => {
    setup.getWalletStatus()
      .then((s) => {
        setWalletStatus(s);
        if (s.exists && s.address) {
          onChange({ ...data, walletAddress: s.address, walletAction: 'keep' });
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  const handleAction = async () => {
    setActionLoading(true);
    setError('');
    try {
      if (data.walletAction === 'import') {
        const words = data.mnemonic.trim().split(/\s+/);
        if (words.length !== 24) {
          setError('Mnemonic must be exactly 24 words.');
          setActionLoading(false);
          return;
        }
        const result = await setup.importWallet(data.mnemonic.trim());
        onChange({ ...data, walletAddress: result.address });
        setMnemonicWords(words);
      } else {
        const result = await setup.generateWallet();
        onChange({ ...data, walletAddress: result.address });
        setMnemonicWords(result.mnemonic);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) return <div className="loading">Checking wallet...</div>;

  const showMnemonic = mnemonicWords.length > 0;
  const actionNeeded = data.walletAction !== 'keep' && !showMnemonic;

  return (
    <div className="step-content">
      <h2 className="step-title">TON Wallet</h2>
      <p className="step-description">
        Your agent needs a TON wallet to send and receive crypto. You can create a new one or import an existing wallet.
      </p>

      {error && <div className="alert error">{error}</div>}

      {walletStatus?.exists && walletStatus.address && !showMnemonic && (
        <div className="card">
          <div className="helper-text" style={{ marginTop: 0, marginBottom: '4px' }}>Current wallet</div>
          <div className="mono" style={{ fontSize: '13px', wordBreak: 'break-all' }}>
            {walletStatus.address}
          </div>
        </div>
      )}

      {!showMnemonic && (
        <div className="form-group">
          {(walletStatus?.exists ? ['keep', 'generate', 'import'] : ['generate', 'import']).map((action) => (
            <label key={action} className="label-inline" style={{ marginBottom: '8px' }}>
              <input
                type="radio"
                name="walletAction"
                value={action}
                checked={data.walletAction === action}
                onChange={() => {
                  onChange({ ...data, walletAction: action as 'keep' | 'generate' | 'import', mnemonic: '', mnemonicSaved: false });
                }}
              />
              <span>
                {action === 'keep' && 'Keep existing wallet'}
                {action === 'generate' && 'Generate new wallet'}
                {action === 'import' && 'Import from mnemonic'}
              </span>
            </label>
          ))}
        </div>
      )}

      {data.walletAction === 'import' && !showMnemonic && (
        <div className="form-group">
          <label>Recovery Phrase (24 words)</label>
          <textarea
            value={data.mnemonic}
            onChange={(e) => onChange({ ...data, mnemonic: e.target.value })}
            placeholder="word1 word2 word3 ... word24"
            className="w-full mono"
            style={{ minHeight: '80px' }}
          />
        </div>
      )}

      {actionNeeded && data.walletAction !== 'keep' && (
        <button onClick={handleAction} disabled={actionLoading || (data.walletAction === 'import' && data.mnemonic.trim().split(/\s+/).length !== 24)} type="button">
          {actionLoading ? <><span className="spinner sm" /> Working...</> : data.walletAction === 'generate' ? 'Generate Wallet' : 'Import Wallet'}
        </button>
      )}

      {showMnemonic && (
        <>
          {data.walletAddress && (
            <div className="card" style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Wallet Address</div>
              <div className="form-row" style={{ alignItems: 'center' }}>
                <span className="mono" style={{ fontWeight: 600, fontSize: '14px', wordBreak: 'break-all', color: 'var(--text)' }}>
                  {data.walletAddress}
                </span>
                <CopyButton text={data.walletAddress} />
              </div>
            </div>
          )}

          <div className="warning-card">
            <strong>WRITE DOWN THESE 24 WORDS</strong>
            <br />
            This is your only way to recover your wallet. Store them securely offline. Never share them.
          </div>

          <ol className="mnemonic-grid">
            {mnemonicWords.map((word, idx) => (
              <li key={idx} className="mnemonic-word">
                <span className="num">{idx + 1}.</span>
                {word}
              </li>
            ))}
          </ol>
          <div className="form-row" style={{ justifyContent: 'flex-end', marginBottom: '8px' }}>
            <CopyButton text={mnemonicWords.join(' ')} />
          </div>

          <div className="form-group" style={{ marginTop: '16px' }}>
            <label className="label-inline" style={{ color: 'var(--text)' }}>
              <input
                type="checkbox"
                checked={data.mnemonicSaved}
                onChange={(e) => onChange({ ...data, mnemonicSaved: e.target.checked })}
              />
              <span style={{ fontWeight: 500 }}>I have saved my recovery phrase</span>
            </label>
          </div>
        </>
      )}
    </div>
  );
}
