// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    useDismissOnPageMove.ts
 * @brief   Close a floating layer when the page moves under it, or the user
 *          clicks or escapes away.
 *
 * @details A popover and a context menu are placed from a rect captured when they
 *          opened, so the moment their anchor moves they are pointing at nothing —
 *          which is why scroll closes them, and why the listener is on the window
 *          in the CAPTURE phase: a scroll inside a panel never reaches the window
 *          any other way (scroll does not bubble).
 *
 *          What that must not treat as the page moving is the layer's OWN list
 *          scrolling. Catching every scroll everywhere closed the dropdown the
 *          moment anyone scrolled its options — the list was unusable past the
 *          items that happened to fit. So a scroll from inside the layer is the
 *          one kind that is ignored.
 *
 *          Shared because both layers had the same block, and a fix to one that
 *          the other never got is how they drift apart.
 */
import { useEffect, type RefObject } from 'react';

export function useDismissOnPageMove(
  /** The floating element — scrolls inside it are the layer being used, not moved. */
  layer: RefObject<HTMLElement | null>,
  onClose: () => void,
  win: Window,
): void {
  useEffect(() => {
    const close = () => onClose();
    const onScroll = (e: Event) => {
      const el = layer.current;
      const target = e.target as Node | null;
      if (el && target && (el === target || el.contains(target))) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    win.addEventListener('mousedown', close);
    win.addEventListener('scroll', onScroll, true);
    win.addEventListener('resize', close);
    win.addEventListener('keydown', onKey);
    return () => {
      win.removeEventListener('mousedown', close);
      win.removeEventListener('scroll', onScroll, true);
      win.removeEventListener('resize', close);
      win.removeEventListener('keydown', onKey);
    };
  }, [layer, onClose, win]);
}
