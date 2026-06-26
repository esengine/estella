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

export function Popover({
  anchor,
  width,
  onClose,
  children,
}: {
  /** The trigger's bounding rect, captured at open time. */
  anchor: DOMRect;
  /** Panel width; defaults to the anchor's width (so a dropdown lines up). */
  width?: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: anchor.left, top: anchor.bottom + 2 });

  // Measure then clamp before paint so the first frame is already on-screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    let left = anchor.left;
    if (left + r.width > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - r.width - pad);
    let top = anchor.bottom + 2;
    // No room below → flip above the anchor.
    if (top + r.height > window.innerHeight - pad) top = Math.max(pad, anchor.top - r.height - 2);
    setPos({ left, top });
  }, [anchor]);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="popover"
      style={{ left: pos.left, top: pos.top, width: width ?? anchor.width }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
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
