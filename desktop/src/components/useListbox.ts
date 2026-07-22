// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    useListbox.ts
 * @brief   The shared keyboard + ARIA behavior for the editor's popover dropdowns
 *          — the standalone <Select> and the inspector's Enum / Entity / Flags
 *          controls. One implementation so every dropdown navigates and reads to a
 *          screen reader the same way, instead of each rolling (or omitting) its own.
 *
 *          Seeds focus on the current option when the popover opens (skipped when a
 *          search box owns focus), arrow-navigates the `.dd-opt` buttons, and hands
 *          back ARIA props for the trigger + list. Escape / backdrop dismissal and
 *          focus-return to the trigger stay with the caller's `close()` (it also
 *          ends any inspector edit gesture).
 */
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';

export function useListbox(isOpen: boolean, opts: { seedFocus?: boolean; multi?: boolean } = {}) {
  const { seedFocus = true, multi = false } = opts;
  const listRef = useRef<HTMLDivElement>(null);

  // Focus the current (or first) option on open so arrow keys work immediately —
  // unless a search box autofocused, in which case typing wins.
  useEffect(() => {
    if (!isOpen || !seedFocus) return;
    const raf = requestAnimationFrame(() => {
      const list = listRef.current;
      const target =
        list?.querySelector<HTMLButtonElement>('.dd-opt.on') ??
        list?.querySelector<HTMLButtonElement>('.dd-opt');
      target?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [isOpen, seedFocus]);

  const onListKey = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('.dd-opt') ?? [])];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    // From outside the list (e.g. a search box), ArrowDown enters at the top,
    // ArrowUp at the bottom; otherwise step and clamp.
    const next = i < 0
      ? (e.key === 'ArrowDown' ? 0 : items.length - 1)
      : e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1);
    items[next]?.focus();
  };

  const triggerProps = { 'aria-haspopup': 'listbox' as const, 'aria-expanded': isOpen };
  const listProps = {
    ref: listRef,
    role: 'listbox' as const,
    'aria-multiselectable': multi || undefined,
    onKeyDown: onListKey,
  };
  return { listRef, onListKey, triggerProps, listProps };
}
