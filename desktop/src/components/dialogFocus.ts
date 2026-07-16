// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    dialogFocus.ts
 * @brief   Shared modality behavior for every dialog/palette shell — one hook
 *          that remembers the opener, seeds focus inside the container, traps
 *          Tab within it, and restores focus on close. Pair it with
 *          role="dialog" aria-modal="true" on the container.
 */
import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Visible-and-focusable elements inside the container, in DOM order. */
function focusables(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.getClientRects().length > 0,
  );
}

/**
 * Modal focus management for the container behind `ref` (give it tabIndex={-1}
 * so it can take the seed focus). Runs for the container's whole mount — mount
 * a dialog only while it is open.
 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    // Resolve the container's own document/window — the popout window's when the
    // dialog was summoned from a popped-out panel, not the main editor window's.
    const doc = container.ownerDocument;
    const win = doc.defaultView ?? window;
    const opener = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;

    // Seed focus inside — unless the shell already autofocused its own field
    // (command palettes / settings focus their search input on mount).
    if (!container.contains(doc.activeElement)) container.focus();

    // Trap Tab: cycle within the container; recapture if focus escaped.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusables(container);
      if (items.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = doc.activeElement;
      const inside = active instanceof HTMLElement && container.contains(active);
      if (e.shiftKey && (!inside || active === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || active === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    win.addEventListener('keydown', onKey, true);
    return () => {
      win.removeEventListener('keydown', onKey, true);
      // Hand focus back to whoever opened the dialog (if still in the DOM).
      if (opener?.isConnected) opener.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
