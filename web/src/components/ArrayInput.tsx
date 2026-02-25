import { useState, useRef, useEffect, useCallback } from 'react';

interface ArrayInputProps {
  value: string[];
  onChange: (values: string[]) => void;
  validate?: (item: string) => string | null;
  placeholder?: string;
  disabled?: boolean;
}

export function ArrayInput({ value, onChange, validate, placeholder, disabled }: ArrayInputProps) {
  const [draft, setDraft] = useState(value);
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [focusedChip, setFocusedChip] = useState(-1);
  const [hoverRemove, setHoverRemove] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const chipRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Reset draft when props.value changes
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const isDirty = JSON.stringify(draft) !== JSON.stringify(value);

  const addItem = useCallback((raw: string) => {
    const item = raw.trim();
    if (!item) return;
    if (validate) {
      const err = validate(item);
      if (err) { setError(err); return; }
    }
    if (draft.includes(item)) {
      setError('Duplicate item');
      return;
    }
    setError(null);
    setDraft(prev => [...prev, item]);
    setInputValue('');
  }, [draft, validate]);

  const removeItem = useCallback((index: number) => {
    setDraft(prev => prev.filter((_, i) => i !== index));
    // Focus adjacent chip or input
    if (draft.length <= 1) {
      inputRef.current?.focus();
      setFocusedChip(-1);
    } else if (index >= draft.length - 1) {
      // Removed last chip, focus the new last
      const newIdx = index - 1;
      setFocusedChip(newIdx);
      setTimeout(() => chipRefs.current[newIdx]?.focus(), 0);
    } else {
      // Focus the chip that takes this position
      setFocusedChip(index);
      setTimeout(() => chipRefs.current[index]?.focus(), 0);
    }
  }, [draft.length]);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;

    if (e.key === 'Enter') {
      e.preventDefault();
      addItem(inputValue);
    } else if (e.key === 'Backspace' && inputValue === '' && draft.length > 0) {
      const lastIdx = draft.length - 1;
      setFocusedChip(lastIdx);
      chipRefs.current[lastIdx]?.focus();
    }
  }, [inputValue, addItem, draft.length]);

  const handleChipKeyDown = useCallback((e: React.KeyboardEvent, index: number) => {
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        if (index > 0) {
          setFocusedChip(index - 1);
          chipRefs.current[index - 1]?.focus();
        }
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (index < draft.length - 1) {
          setFocusedChip(index + 1);
          chipRefs.current[index + 1]?.focus();
        } else {
          setFocusedChip(-1);
          inputRef.current?.focus();
        }
        break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        removeItem(index);
        break;
      case 'Escape':
        e.preventDefault();
        setFocusedChip(-1);
        inputRef.current?.focus();
        break;
      case 'Home':
        e.preventDefault();
        setFocusedChip(0);
        chipRefs.current[0]?.focus();
        break;
      case 'End':
        e.preventDefault();
        if (draft.length > 0) {
          const last = draft.length - 1;
          setFocusedChip(last);
          chipRefs.current[last]?.focus();
        }
        break;
    }
  }, [draft.length, removeItem]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text');
    const items = text.split(/[,;\n\t]+/).map(s => s.trim()).filter(Boolean);
    if (items.length <= 1) return; // Let normal paste handle single values

    e.preventDefault();
    const toAdd: string[] = [];
    for (const item of items) {
      if (draft.includes(item) || toAdd.includes(item)) continue;
      if (validate) {
        const err = validate(item);
        if (err) continue; // Skip invalid items silently on paste
      }
      toAdd.push(item);
    }
    if (toAdd.length > 0) {
      setDraft(prev => [...prev, ...toAdd]);
      setError(null);
    }
  }, [draft, validate]);

  const handleSave = () => { onChange(draft); };
  const handleCancel = () => { setDraft(value); setError(null); };

  return (
    <div>
      <div
        role="listbox"
        aria-orientation="horizontal"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--space-xs)',
          background: 'var(--surface)',
          border: '1px solid var(--glass-border)',
          borderRadius: 'var(--radius-sm)',
          minHeight: '38px',
          padding: 'var(--space-sm)',
          alignItems: 'center',
          opacity: disabled ? 0.5 : 1,
        }}
        onClick={() => { if (!disabled) inputRef.current?.focus(); }}
      >
        {draft.map((item, idx) => (
          <div
            key={`${item}-${idx}`}
            ref={el => { chipRefs.current[idx] = el; }}
            role="option"
            aria-selected="true"
            tabIndex={focusedChip === idx ? 0 : -1}
            onKeyDown={e => handleChipKeyDown(e, idx)}
            onFocus={() => setFocusedChip(idx)}
            onBlur={() => { if (focusedChip === idx) setFocusedChip(-1); }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-xs)',
              padding: '2px var(--space-sm)',
              background: 'var(--accent-dim)',
              color: 'var(--text)',
              borderRadius: 'calc(var(--radius-sm) - 2px)',
              fontSize: 'var(--font-sm)',
              outline: focusedChip === idx ? '2px solid var(--accent)' : 'none',
              outlineOffset: focusedChip === idx ? '1px' : undefined,
            }}
          >
            <span>{item}</span>
            <button
              type="button"
              aria-label={`Remove ${item}`}
              disabled={disabled}
              onClick={e => { e.stopPropagation(); removeItem(idx); }}
              onMouseEnter={() => setHoverRemove(idx)}
              onMouseLeave={() => setHoverRemove(-1)}
              style={{
                background: 'none',
                border: 'none',
                color: hoverRemove === idx ? 'var(--red)' : 'var(--text-secondary)',
                cursor: disabled ? 'not-allowed' : 'pointer',
                padding: '0 2px',
                fontSize: 'var(--font-xs)',
                lineHeight: '1',
              }}
            >
              &times;
            </button>
          </div>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={e => { setInputValue(e.target.value); setError(null); }}
          onKeyDown={handleInputKeyDown}
          onPaste={handlePaste}
          placeholder={draft.length === 0 ? placeholder : undefined}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          style={{
            flex: 1,
            minWidth: '120px',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--text)',
            fontSize: 'var(--font-sm)',
            padding: 0,
          }}
        />
        <button
          type="button"
          disabled={disabled || !inputValue.trim()}
          onClick={() => addItem(inputValue)}
          style={{
            padding: '2px 8px',
            fontSize: 'var(--font-xs)',
            borderRadius: 'calc(var(--radius-sm) - 2px)',
            minHeight: 'auto',
          }}
        >
          Add
        </button>
      </div>
      {error && (
        <div style={{ fontSize: '12px', color: 'var(--red)', marginTop: '4px' }}>
          {error}
        </div>
      )}
      {isDirty && (
        <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
          <button type="button" onClick={handleSave} disabled={disabled}>
            Save
          </button>
          <button type="button" className="btn-ghost" onClick={handleCancel} disabled={disabled}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
