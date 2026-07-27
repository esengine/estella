// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Popover.tsx
 * @brief   A trigger-anchored popover — the one primitive behind the inspector's
 *          themed dropdowns, flag pickers, and asset pickers (and anything else
 *          that needs a floating panel under a field). Portaled to the body,
 *          positioned under the anchor rect, clamped to the viewport (flips above
 *          when it would overflow the bottom), and dismissed on an outside press,
 *          a scroll, a resize, or Escape — the same mechanics as ContextMenu, but
 *          anchored to an element instead of the cursor.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePanelWindow } from '@/components/PanelWindow';
import { overlayGuard } from '@/components/overlayGuard';
import { useDismissOnPageMove } from './useDismissOnPageMove';

export function Popover({
  anchor,
  width,
  onClose,
  children,
  className,
}: {
  /** The trigger's bounding rect, captured at open time. */
  anchor: DOMRect;
  /** Panel width: a number pins it, `'auto'` sizes to content, omitted = the
   *  anchor's width (so a field dropdown lines up under its trigger). */
  width?: number | 'auto';
  onClose: () => void;
  children: ReactNode;
  /** Extra class on the `.popover` shell — e.g. a glass variant for overlays. */
  className?: string;
}) {
  const win = usePanelWindow();
  const doc = win.document;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: anchor.left, top: anchor.bottom + 2 });
  // Who had focus when the popover opened (usually the trigger) — keyboard focus
  // returns there on close, unless the dismissal itself focused another control.
  const opener = useRef<HTMLElement | null>(doc.activeElement as HTMLElement | null);

  // While open, the popover owns the keyboard — suppress global scene shortcuts
  // so Delete/Ctrl+Z don't bubble past an open dropdown/picker to the scene.
  useEffect(() => {
    overlayGuard.open();
    return () => overlayGuard.close();
  }, []);

  useEffect(
    () => () => {
      const cur = doc.activeElement;
      const stillOurs = cur == null || cur === doc.body || (ref.current?.contains(cur) ?? false);
      const el = opener.current;
      if (stillOurs && el && doc.contains(el)) el.focus();
    },
    [doc],
  );

  // Measure then clamp before paint so the first frame is already on-screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    let left = anchor.left;
    if (left + r.width > win.innerWidth - pad) left = Math.max(pad, win.innerWidth - r.width - pad);
    let top = anchor.bottom + 2;
    // No room below → flip above the anchor.
    if (top + r.height > win.innerHeight - pad) top = Math.max(pad, anchor.top - r.height - 2);
    setPos({ left, top });
  }, [anchor, win]);

  useDismissOnPageMove(ref, onClose, win);

  return createPortal(
    <div
      ref={ref}
      className={`popover${className ? ` ${className}` : ''}`}
      style={{ left: pos.left, top: pos.top, width: width === 'auto' ? undefined : (width ?? anchor.width) }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    doc.body,
  );
}

/**
 * Trigger state for a popover anchored to a button: tracks open + the captured
 * anchor rect. `open(el)` snapshots the trigger's rect; `close()` clears it.
 */
export function usePopover() {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  return {
    anchor,
    isOpen: anchor != null,
    open: (el: HTMLElement | null) => setAnchor(el?.getBoundingClientRect() ?? null),
    close: () => setAnchor(null),
  };
}
