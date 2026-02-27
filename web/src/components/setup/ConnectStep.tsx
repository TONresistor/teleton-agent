import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { setup } from '../../lib/api';
import type { StepProps } from '../../pages/Setup';

const Lottie = lazy(() => import('lottie-react'));

// Dynamic imports so Vite code-splits the heavy JSON + lottie-web
const runAnimation = () => import('../../assets/run.json').then((m) => m.default);
const codeAnimation = () => import('../../assets/login-telegram.json').then((m) => m.default);

function LottiePlayer({ loader, size }: { loader: () => Promise<object>; size: number }) {
  const [data, setData] = useState<object | null>(null);
  useEffect(() => { loader().then(setData); }, []);
  if (!data) return <div style={{ width: size, height: size, margin: '0 auto 16px' }} />;
  return (
    <Suspense fallback={<div style={{ width: size, height: size, margin: '0 auto 16px' }} />}>
      <Lottie animationData={data} loop style={{ width: size, height: size, margin: '0 auto 16px' }} />
    </Suspense>
  );
}

export function ConnectStep({ data, onChange }: StepProps) {
  const [phase, setPhase] = useState<'idle' | 'code_sent' | '2fa' | 'done'>('idle');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [passwordHint, setPasswordHint] = useState('');
  const [codeDelivery, setCodeDelivery] = useState<"app" | "sms" | "fragment">("sms");
  const [fragmentUrl, setFragmentUrl] = useState("");
  const [canResend, setCanResend] = useState(false);
  const [floodWait, setFloodWait] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Countdown for flood wait
  useEffect(() => {
    if (floodWait <= 0) return;
    timerRef.current = setInterval(() => {
      setFloodWait((t) => {
        if (t <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [floodWait > 0]);

  // Show resend after 30s
  useEffect(() => {
    if (phase !== 'code_sent') return;
    const t = setTimeout(() => setCanResend(true), 30000);
    return () => clearTimeout(t);
  }, [phase]);

  // If already connected from previous visit
  useEffect(() => {
    if (data.telegramUser) setPhase('done');
  }, []);

  const handleConnect = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await setup.sendCode(data.apiId, data.apiHash, data.phone);
      onChange({ ...data, authSessionId: result.authSessionId });
      setCodeDelivery(result.codeDelivery);
      if (result.fragmentUrl) setFragmentUrl(result.fragmentUrl);
      setPhase('code_sent');
      setCanResend(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('FLOOD')) {
        const seconds = parseInt(msg.match(/(\d+)/)?.[1] || '60');
        setFloodWait(seconds);
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleCode = async (value: string) => {
    setCode(value);
    if (value.length < 5) return;
    setLoading(true);
    setError('');
    try {
      const result = await setup.verifyCode(data.authSessionId, value);
      if (result.status === 'authenticated' && result.user) {
        onChange({ ...data, telegramUser: result.user, skipConnect: false });
        setPhase('done');
      } else if (result.status === '2fa_required') {
        setPasswordHint(result.passwordHint || '');
        setPhase('2fa');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handlePassword = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await setup.verifyPassword(data.authSessionId, password);
      if (result.status === 'authenticated' && result.user) {
        onChange({ ...data, telegramUser: result.user, skipConnect: false });
        setPhase('done');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await setup.resendCode(data.authSessionId);
      setCodeDelivery(result.codeDelivery);
      if (result.fragmentUrl) setFragmentUrl(result.fragmentUrl);
      setCode('');
      setCanResend(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="step-content">
      <h2 className="step-title">Connect your Agent to Telegram</h2>
      <p className="step-description">
        Authenticate with your Telegram account. This lets the agent send and receive messages as you.
      </p>

      {error && <div className="alert error">{error}</div>}

      {phase === 'idle' && (
        <div className="text-center" style={{ padding: '20px 0' }}>
          <LottiePlayer loader={runAnimation} size={200} />
          <button onClick={handleConnect} disabled={loading || floodWait > 0} type="button" className="btn-lg">
            {loading ? <><span className="spinner sm" /> Connecting...</> : floodWait > 0 ? `Wait ${floodWait}s` : 'Connect to Telegram'}
          </button>
          {/* Telegram connection is required for agent to function */}
        </div>
      )}

      {phase === 'code_sent' && (
        <div className="text-center" style={{ padding: '20px 0' }}>
          <LottiePlayer loader={codeAnimation} size={180} />

          {codeDelivery === 'fragment' ? (
            <>
              <div className="info-panel" style={{ textAlign: 'left', marginBottom: '16px' }}>
                <strong>Anonymous number detected (+888)</strong>
                <p className="text-muted" style={{ margin: '8px 0' }}>
                  Your number is an anonymous number purchased on Fragment. To receive the login code,
                  open Fragment.com, connect your TON wallet, and navigate to "My Assets" to find the code.
                </p>
                {fragmentUrl && (
                  <a
                    href={fragmentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-lg btn-ghost"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}
                  >
                    Open Fragment.com
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                )}
              </div>
              <div className="text-muted" style={{ marginBottom: '16px' }}>
                Enter the code shown on Fragment
              </div>
            </>
          ) : (
            <div className="text-muted" style={{ marginBottom: '16px' }}>
              Code sent via {codeDelivery === 'app' ? 'Telegram app' : 'SMS'}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
            <input
              className="code-input"
              type="text"
              inputMode="numeric"
              value={code}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 5);
                handleCode(v);
              }}
              placeholder="12345"
              maxLength={5}
              autoFocus
              disabled={loading}
            />
          </div>
          {loading && <div className="text-muted"><span className="spinner sm" /> Verifying...</div>}
          {canResend && !loading && (
            <button type="button" className="btn-ghost" onClick={handleResend}>
              Resend code
            </button>
          )}
        </div>
      )}

      {phase === '2fa' && (
        <div style={{ padding: '20px 0' }}>
          <div className="text-muted text-center" style={{ marginBottom: '12px' }}>
            Two-factor authentication required
          </div>
          {passwordHint && (
            <div className="info-panel text-center">
              Hint: {passwordHint}
            </div>
          )}
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePassword()}
              placeholder="Enter your 2FA password"
              className="w-full"
              autoFocus
            />
          </div>
          <button onClick={handlePassword} disabled={loading || !password} type="button">
            {loading ? <><span className="spinner sm" /> Verifying...</> : 'Submit'}
          </button>
        </div>
      )}

      {phase === 'done' && data.telegramUser && (
        <div className="alert success text-center" style={{ padding: '20px' }}>
          Connected as <strong>{data.telegramUser.firstName}</strong>
          {data.telegramUser.username && <> (@{data.telegramUser.username})</>}
        </div>
      )}
    </div>
  );
}
