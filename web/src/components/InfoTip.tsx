import { useState, useEffect, useRef, useId, useCallback } from 'react';

interface InfoTipProps {
  text: string;
}

const TOOLTIP_BG = 'rgba(24, 24, 27, 0.95)';
const HIDE_GRACE_MS = 75;

export function InfoTip({ text }: InfoTipProps) {
  const [visible, setVisible] = useState(false);
  const tooltipId = useId();
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    if (graceTimer.current) clearTimeout(graceTimer.current);
    setVisible(true);
  }, []);

  const hide = useCallback(() => {
    graceTimer.current = setTimeout(() => setVisible(false), HIDE_GRACE_MS);
  }, []);

  // Escape key dismissal (WCAG 1.4.13)
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setVisible(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible]);

  // Cleanup grace timer
  useEffect(() => {
    return () => { if (graceTimer.current) clearTimeout(graceTimer.current); };
  }, []);

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', marginLeft: '6px' }}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {/* Trigger icon */}
      <span
        tabIndex={0}
        role="button"
        aria-describedby={visible ? tooltipId : undefined}
        aria-label="Info"
        style={{
          cursor: 'help',
          display: 'inline-flex',
          color: visible ? 'var(--text)' : 'var(--text-secondary)',
          transition: 'color 0.15s',
          outline: 'none',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
          <text x="7" y="10.5" textAnchor="middle" fill="currentColor" fontSize="9" fontWeight="600" fontFamily="sans-serif">i</text>
        </svg>
      </span>

      {/* Tooltip */}
      <span
        id={tooltipId}
        role="tooltip"
        onMouseEnter={show}
        onMouseLeave={hide}
        style={{
          position: 'absolute',
          bottom: 'calc(100% + 8px)',
          left: '50%',
          transform: visible ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(4px)',
          width: 'max-content',
          maxWidth: '250px',
          minWidth: '64px',
          padding: '6px 12px',
          background: TOOLTIP_BG,
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid var(--glass-border)',
          borderRadius: '6px',
          boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)',
          color: '#ffffff',
          fontSize: 'var(--font-sm)',
          fontWeight: 400,
          lineHeight: '1.4',
          textAlign: 'center',
          overflowWrap: 'break-word',
          whiteSpace: 'normal',
          zIndex: 50,
          opacity: visible ? 1 : 0,
          visibility: visible ? 'visible' as const : 'hidden' as const,
          transition: 'opacity 200ms cubic-bezier(0.16,1,0.3,1), transform 200ms cubic-bezier(0.16,1,0.3,1), visibility 200ms',
          pointerEvents: visible ? 'auto' as const : 'none' as const,
        }}
      >
        {text}
        {/* Arrow — rotated square */}
        <span
          style={{
            position: 'absolute',
            bottom: '-4px',
            left: '50%',
            transform: 'translateX(-50%) rotate(45deg)',
            width: '8px',
            height: '8px',
            background: TOOLTIP_BG,
            borderRight: '1px solid var(--glass-border)',
            borderBottom: '1px solid var(--glass-border)',
          }}
        />
      </span>
    </span>
  );
}
