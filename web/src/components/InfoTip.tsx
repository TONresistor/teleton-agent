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
      {show && (
        <span
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--surface)',
            border: '1px solid var(--separator)',
            color: 'var(--text-secondary)',
            fontSize: '12px',
            fontWeight: 'normal',
            maxWidth: '280px',
            padding: '8px 12px',
            borderRadius: '6px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            zIndex: 10,
            whiteSpace: 'normal',
            lineHeight: '1.4',
            pointerEvents: 'none',
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
              borderTop: '5px solid var(--separator)',
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
              borderTop: '4px solid var(--surface)',
            }}
          />
        </span>
      )}
    </span>
  );
}
