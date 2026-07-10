// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Segmented.tsx
 * @brief   The shared segmented control — an inset well of mutually-exclusive
 *          buttons with an accent-filled active segment. One implementation
 *          behind every view/mode switch (Content Browser grid/list, Settings
 *          enums, Launcher layout, Tileset modes). Styled by theme/controls.css.
 */
import type { ReactNode } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label?: string;
  icon?: ReactNode;
  /** Tooltip; doubles as the accessible name for icon-only segments. */
  title?: string;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  grow,
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (v: T) => void;
  ariaLabel?: string;
  /** Fill the container width, segments sharing it equally (world picker). */
  grow?: boolean;
}) {
  return (
    <div className={`seg${grow ? ' grow' : ''}`} role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={`${value === o.value ? 'on' : ''}${o.icon && !o.label ? ' ic' : ''}`}
          title={o.title}
          aria-label={!o.label ? o.title : undefined}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
