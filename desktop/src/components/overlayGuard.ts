// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  overlayGuard.ts — a live count of open transient overlays (context
 *        menus, popovers, field dropdowns). While any is open it OWNS the
 *        keyboard, so the global shortcut handler (App.tsx) suppresses scene
 *        commands — otherwise Delete / Ctrl+Z / F5 would bubble past a floating
 *        menu and hit the scene *behind* it. A plain module counter (not a store)
 *        because the handler reads it synchronously on every keydown; overlays
 *        bump it on mount and drop it on unmount. Shared across editor windows
 *        (popouts run in the same JS realm), so a menu in any window guards all.
 */
let count = 0;

export const overlayGuard = {
  /** An overlay opened — call from a mount effect. */
  open() {
    count++;
  },
  /** An overlay closed — call from that effect's cleanup. */
  close() {
    count = Math.max(0, count - 1);
  },
  /** True while at least one transient overlay is open. */
  get active(): boolean {
    return count > 0;
  },
};
