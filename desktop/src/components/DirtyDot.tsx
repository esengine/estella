// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    DirtyDot.tsx
 * @brief   The shared unsaved-changes marker — one dot, one color (the viewport
 *          selection orange), everywhere a document can be dirty: the menubar
 *          scene title, asset-editor toolbars, and dock tabs.
 */
export function DirtyDot({ title = 'Unsaved changes' }: { title?: string }) {
  return (
    <span className="dirty-dot" title={title}>
      ●
    </span>
  );
}
