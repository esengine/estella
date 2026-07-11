// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    IconButton.tsx
 * @brief   The shared square icon button — one recipe behind every panel-chrome
 *          glyph button (toolbars, panel headers, dialog close, filter toggles).
 *          Replaces the dozen hand-rolled `.pbtn`/`.cb-ico`/`.filt-btn`/… classes
 *          that all re-implemented the same "square, centered glyph, mute→text on
 *          hover" recipe. Styled by the `.icon-btn` block in theme/controls.css.
 */
import type { ReactNode, MouseEvent, KeyboardEvent } from 'react';

export function IconButton({
  children,
  title,
  onClick,
  active,
  disabled,
  size = 'md',
  variant = 'ghost',
  className,
  tabIndex,
  onKeyDown,
  ariaLabel,
}: {
  children: ReactNode;
  /** Tooltip; also the accessible name (these buttons are icon-only). */
  title?: string;
  onClick?: (e: MouseEvent) => void;
  /** Accent-colored "current mode / on" state (aria-pressed). */
  active?: boolean;
  disabled?: boolean;
  /** 22 / 24 / 28px square — matches the three sizes found across the panels. */
  size?: 'sm' | 'md' | 'lg';
  /** ghost = bare glyph (panel headers/toolbars); outline = bordered chip. */
  variant?: 'ghost' | 'outline';
  className?: string;
  tabIndex?: number;
  onKeyDown?: (e: KeyboardEvent) => void;
  /** Override the accessible name when it should differ from `title`. */
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-btn icon-btn--${size}${variant === 'outline' ? ' icon-btn--outline' : ''}${active ? ' on' : ''}${className ? ` ${className}` : ''}`}
      title={title}
      aria-label={ariaLabel ?? title}
      aria-pressed={active}
      disabled={disabled}
      tabIndex={tabIndex}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {children}
    </button>
  );
}
