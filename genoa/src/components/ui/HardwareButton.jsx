import React from 'react';

const VARIANT = {
  primary:   'hw-btn hw-btn--primary',
  secondary: 'hw-btn',
  cyan:      'hw-btn hw-btn--cyan',
  danger:    'hw-btn hw-btn--danger',
  ghost:     'hw-btn hw-btn--ghost'
};

export default function HardwareButton({ variant = 'secondary', children, onClick, disabled, type = 'button', title, className = '' }) {
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`${VARIANT[variant] || VARIANT.secondary} ${className}`}
    >
      {children}
    </button>
  );
}
