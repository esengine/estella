// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    SearchField.tsx
 * @brief   The shared search/filter input — leading icon + reset-styled input in
 *          a bordered well (`.search`, theme/controls.css). Rendered as a <label>
 *          so a click anywhere in the well focuses the input. Size/placement
 *          deltas ride on `className`; popover-internal filters use the flush
 *          variant (a border-bottom row instead of a box). Trailing adornments
 *          (e.g. a kbd hint) are children.
 */
import { Search } from 'lucide-react';
import type { KeyboardEvent, ReactNode, Ref } from 'react';

export function SearchField({
  value,
  onChange,
  placeholder,
  className,
  flush,
  autoFocus,
  iconSize = 13,
  inputRef,
  onKeyDown,
  ariaLabel,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Layout deltas only (width/height/margin) — the look itself stays shared. */
  className?: string;
  /** Popover-internal variant: a flush border-bottom row instead of a box. */
  flush?: boolean;
  autoFocus?: boolean;
  iconSize?: number;
  inputRef?: Ref<HTMLInputElement>;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  ariaLabel?: string;
  /** Trailing adornment (e.g. the command palettes' Esc hint). */
  children?: ReactNode;
}) {
  return (
    <label className={`search${flush ? ' search--flush' : ''}${className ? ` ${className}` : ''}`}>
      <Search size={iconSize} strokeWidth={1.9} />
      <input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoFocus={autoFocus}
        aria-label={ariaLabel ?? placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {children}
    </label>
  );
}
