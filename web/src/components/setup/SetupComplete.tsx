import { useState, useEffect, lazy, Suspense } from 'react';
import { useSetup } from './SetupContext';

const Lottie = lazy(() => import('lottie-react'));
const completeAnimation = () => import('../../assets/complete.json').then((m) => m.default);

function LottiePlayer() {
  const [data, setData] = useState<object | null>(null);
  useEffect(() => { completeAnimation().then(setData); }, []);
  const size = 200;
  if (!data) return <div style={{ width: size, height: size, margin: '0 auto 24px' }} />;
  return (
    <Suspense fallback={<div style={{ width: size, height: size, margin: '0 auto 24px' }} />}>
      <Lottie animationData={data} loop style={{ width: size, height: size, margin: '0 auto 24px' }} />
    </Suspense>
  );
}

export function SetupComplete() {
  const { launching, launchError, handleLaunch } = useSetup();

  return (
    <div className="step-content text-center" style={{ paddingTop: '40px' }}>
      <LottiePlayer />

      <h2 style={{ fontSize: '20px', fontWeight: 600, letterSpacing: '-0.3px', marginBottom: '8px' }}>
        Your Agent is ready
      </h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '32px' }}>
        Configuration saved. Start your agent to begin.
      </p>

      <button
        onClick={handleLaunch}
        disabled={launching}
        className="btn-lg"
        style={{ minWidth: '200px' }}
      >
        {launching ? <><span className="spinner sm" /> Starting...</> : 'Start Agent'}
      </button>

      {launching && (
        <p className="helper-text" style={{ marginTop: '16px' }}>
          Booting your agent... this may take a few seconds.
        </p>
      )}

      {launchError && (
        <div style={{ marginTop: '20px' }}>
          <div className="alert error">{launchError}</div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '8px' }}>
            Start manually:
          </p>
          <code className="code-block" style={{ marginTop: '8px' }}>
            teleton start
          </code>
        </div>
      )}
    </div>
  );
}
