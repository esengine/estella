// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Button.tsx
 * @brief   The shared text button (with an optional leading icon) — one recipe
 *          behind dialog actions, toolbar commands, and empty-state CTAs.
 *          Variants: soft (default), primary (accent fill), danger (error fill).
 *          Styled by the `.btn-soft` recipe in theme/app.css.
 */
import type { ReactNode, MouseEvent } from 'react';

export function Button({
  children,
  onClick,
  variant = 'soft',
  disabled,
  title,
  type = 'button',
  className,
}: {
  children: ReactNode;
  onClick?: (e: MouseEvent) => void;
  variant?: 'soft' | 'primary' | 'danger';
  disabled?: boolean;
  title?: string;
  type?: 'button' | 'submit';
  className?: string;
}) {
  const mod = variant === 'primary' ? ' is-primary' : variant === 'danger' ? ' is-danger' : '';
  return (
    <button
      type={type}
      className={`btn-soft${mod}${className ? ` ${className}` : ''}`}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
