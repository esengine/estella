// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Tooltip.tsx
 * @brief   A hover-anchored, non-interactive info card — the one primitive behind
 *          the editor's hover tooltips (e.g. the Content Browser's asset card).
 *          Portaled to the body, anchored beside the trigger, clamped on-screen,
 *          and — unlike a bare portal — it self-dismisses the instant its anchor
 *          stops being visible: a scroll, a resize, a window blur, or the anchor's
 *          host being detached/hidden. A dock tab switch detaches the host panel
 *          without unmounting its component, so a body-level portal whose only
 *          exits are mouseleave/unmount would otherwise be stranded on screen.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// UE-style hover delay: long enough not to flicker while sweeping over a grid.
const OPEN_DELAY = 450;

function Tooltip({
  anchor,
  onDismiss,
  children,
}: {
  anchor: HTMLElement;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(() => {
    const r = anchor.getBoundingClientRect();
    return { left: r.right + 10, top: r.top };
  });

  // Place beside the anchor (flip left / lift up near an edge) before paint, and
  // re-place when the card resizes — its content (stat, image dims) loads async.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const pad = 8;
      let left = a.right + 10;
      if (left + r.width > window.innerWidth - pad) left = Math.max(pad, a.left - r.width - 10);
      let top = a.top;
      if (top + r.height > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - r.height - pad);
      setPos((p) => (p.left === left && p.top === top ? p : { left, top }));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [anchor]);

  // Dismiss the moment the anchor leaves the screen. The IntersectionObserver is
  // the load-bearing part: it reports the anchor non-intersecting when its panel
  // is detached on a dock tab switch or collapsed — cases a mouseleave never sees.
  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => !e.isIntersecting)) onDismiss();
    });
    io.observe(anchor);
    window.addEventListener('scroll', onDismiss, true);
    window.addEventListener('wheel', onDismiss, { passive: true });
    window.addEventListener('resize', onDismiss);
    window.addEventListener('blur', onDismiss);
    return () => {
      io.disconnect();
      window.removeEventListener('scroll', onDismiss, true);
      window.removeEventListener('wheel', onDismiss);
      window.removeEventListener('resize', onDismiss);
      window.removeEventListener('blur', onDismiss);
    };
  }, [anchor, onDismiss]);

  return createPortal(
    <div ref={ref} className="tooltip" style={{ left: pos.left, top: pos.top }}>
      {children}
    </div>,
    document.body,
  );
}

/**
 * Hover-tooltip controller for a set of triggers that share one card. `bind(payload)`
 * returns the enter/leave handlers for a trigger (the card opens after a short
 * delay); render `card` once to host the floating card; `render` maps the hovered
 * payload to the card body. `close()` dismisses it imperatively (e.g. on drag start).
 */
export function useTooltip<T>(render: (payload: T) => ReactNode, delay = OPEN_DELAY) {
  const [target, setTarget] = useState<{ anchor: HTMLElement; payload: T } | null>(null);
  const timer = useRef<number | null>(null);

  const close = useCallback(() => {
    if (timer.current != null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setTarget(null);
  }, []);

  // A body-level portal must never outlive the component that owns it.
  useEffect(() => () => close(), [close]);

  const bind = useCallback(
    (payload: T) => ({
      onMouseEnter: (ev: React.MouseEvent) => {
        const anchor = ev.currentTarget as HTMLElement;
        if (timer.current != null) clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setTarget({ anchor, payload }), delay);
      },
      onMouseLeave: close,
    }),
    [close, delay],
  );

  const card = target ? (
    <Tooltip anchor={target.anchor} onDismiss={close}>
      {render(target.payload)}
    </Tooltip>
  ) : null;

  return { bind, card, close };
}
