// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Button.tsx
 * @brief   The shared text button (with an optional leading icon) — one recipe
 *          behind dialog actions, toolbar commands, and empty-state CTAs.
 *          Variants: soft (default), primary (accent fill), danger (error fill).
 *          Styled by the `.btn-soft` recipe in theme/app.css. Forwards a ref so a
 *          dialog can autofocus its confirm action.
 */
import { forwardRef, type ReactNode, type MouseEvent } from 'react';

export const Button = forwardRef<
  HTMLButtonElement,
  {
    children: ReactNode;
    onClick?: (e: MouseEvent) => void;
    variant?: 'soft' | 'primary' | 'danger';
    disabled?: boolean;
    title?: string;
    type?: 'button' | 'submit';
    className?: string;
  }
>(function Button({ children, onClick, variant = 'soft', disabled, title, type = 'button', className }, ref) {
  const mod = variant === 'primary' ? ' is-primary' : variant === 'danger' ? ' is-danger' : '';
  return (
    <button
      ref={ref}
      type={type}
      className={`btn-soft${mod}${className ? ` ${className}` : ''}`}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
});
