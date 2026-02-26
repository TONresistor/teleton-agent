import { useState } from 'react';

interface InfoTipProps {
  text: string;
}

export function InfoTip({ text }: InfoTipProps) {
  const [show, setShow] = useState(false);

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', marginLeft: '6px' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span aria-label="Info" style={{ cursor: 'help', display: 'inline-flex', color: show ? 'var(--text)' : 'var(--text-secondary)', transition: 'color 0.15s' }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
          <text x="7" y="10.5" textAnchor="middle" fill="currentColor" fontSize="9" fontWeight="600" fontFamily="sans-serif">i</text>
        </svg>
      </span>
      <span
        style={{
          position: 'absolute',
          bottom: 'calc(100% + 6px)',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(30, 30, 30, 0.75)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          color: 'var(--text-secondary)',
          fontSize: '12px',
          fontWeight: 'normal',
          maxWidth: '360px',
          padding: '10px 14px',
          borderRadius: '6px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
          zIndex: 10,
          whiteSpace: 'normal',
          lineHeight: '1.4',
          pointerEvents: 'none',
          opacity: show ? 1 : 0,
          visibility: show ? 'visible' as const : 'hidden' as const,
          transition: 'opacity 150ms ease, visibility 150ms ease',
        }}
      >
        {text}
        {/* Arrow pointing down */}
        <span
          style={{
            position: 'absolute',
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 0,
            height: 0,
            borderLeft: '5px solid transparent',
            borderRight: '5px solid transparent',
            borderTop: '5px solid rgba(255, 255, 255, 0.1)',
          }}
        />
        <span
          style={{
            position: 'absolute',
            top: 'calc(100% - 1px)',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 0,
            height: 0,
            borderLeft: '4px solid transparent',
            borderRight: '4px solid transparent',
            borderTop: '4px solid rgba(30, 30, 30, 0.75)',
          }}
        />
      </span>
    </span>
  );
}
