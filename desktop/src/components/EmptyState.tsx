// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    EmptyState.tsx
 * @brief   The shared "nothing here yet" panel state — a dashed-chip icon, a title,
 *          an optional hint, and optional actions/children. One look everywhere a
 *          panel has no content to show (no selection, no project, empty list), so
 *          empty panels read consistently instead of each rolling its own.
 */
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function EmptyState({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: LucideIcon;
  title: string;
  /** A short line under the title saying what to do next. */
  hint?: ReactNode;
  /** Optional trailing content — a primary action, onboarding steps, etc. */
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">
        <Icon size={22} strokeWidth={1.4} />
      </div>
      <div className="empty-state__title">{title}</div>
      {hint && <div className="empty-state__hint">{hint}</div>}
      {children}
    </div>
  );
}
