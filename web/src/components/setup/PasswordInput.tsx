import { useState } from 'react';

interface PasswordInputProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
}

const EyeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeOffIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

export function PasswordInput({ value, onChange, placeholder, className, style }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="password-wrapper" style={style}>
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={className}
        style={{ flex: 1, paddingRight: '32px' }}
      />
      {value && (
        <button
          type="button"
          className="eye-toggle"
          onClick={() => setVisible(!visible)}
          aria-label={visible ? 'Hide' : 'Show'}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      )}
    </div>
  );
}
