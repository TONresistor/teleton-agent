import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface SelectProps {
  value: string;
  options: string[];
  labels?: string[];
  onChange: (value: string) => void;
  style?: React.CSSProperties;
}

export function Select({ value, options, labels, onChange, style }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(-1);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(Math.random().toString(36).slice(2));

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const clickedInside = ref.current?.contains(target) || menuRef.current?.contains(target);
      if (!clickedInside) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Calculate menu position when opening
  useEffect(() => {
    if (open && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    } else {
      setMenuPos(null);
    }
  }, [open]);

  // Reset focus index when opening
  useEffect(() => {
    if (open) {
      const idx = options.indexOf(value);
      setFocusIdx(idx >= 0 ? idx : 0);
    }
  }, [open, options, value]);

  // Scroll focused option into view
  useEffect(() => {
    if (!open || focusIdx < 0 || !menuRef.current) return;
    const el = menuRef.current.children[focusIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, focusIdx]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusIdx((i) => (i + 1) % options.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusIdx((i) => (i - 1 + options.length) % options.length);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (focusIdx >= 0 && focusIdx < options.length) {
          onChange(options[focusIdx]);
          setOpen(false);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        break;
      case 'Home':
        e.preventDefault();
        setFocusIdx(0);
        break;
      case 'End':
        e.preventDefault();
        setFocusIdx(options.length - 1);
        break;
    }
  }, [open, focusIdx, options, onChange]);

  const menuId = `select-menu-${idRef.current}`;

  return (
    <div ref={ref} className="custom-select" style={style}>
      <button
        type="button"
        className="custom-select-trigger"
        onClick={() => setOpen(!open)}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
      >
        <span>{labels ? labels[options.indexOf(value)] ?? value : value}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          className="custom-select-menu"
          role="listbox"
          aria-activedescendant={focusIdx >= 0 ? `${menuId}-opt-${focusIdx}` : undefined}
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: menuPos.width }}
        >
          {options.map((opt, idx) => (
            <div
              key={opt}
              id={`${menuId}-opt-${idx}`}
              role="option"
              aria-selected={opt === value}
              className={`custom-select-option${opt === value ? ' active' : ''}${idx === focusIdx ? ' focused' : ''}`}
              onClick={() => { onChange(opt); setOpen(false); }}
              onMouseEnter={() => setFocusIdx(idx)}
            >
              {labels ? labels[idx] ?? opt : opt}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
