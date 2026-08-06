// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  virtualWindow.ts — which rows are on screen, for every windowed panel.
 *
 * The one piece both {@link VirtualTree} and {@link VirtualGrid} need and neither
 * should own: a scroll offset, a viewport height, and the row range they imply.
 * Layout is the caller's — a tree lays one item per row, a grid lays a rowful —
 * and this answers only "which rows, and how tall is the whole thing".
 *
 * Rows, not items: a grid's row is several tiles wide, so windowing in ROWS is
 * what keeps the two callers on one implementation.
 *
 * The scroller may be the caller's own (the Content Browser's carries the
 * keyboard, the click-to-deselect and the file drop), and the windowed area need
 * not start at its top — so the distance between them is MEASURED rather than
 * declared. A caller that gets that number wrong scrolls to the wrong row, and it
 * is not a number anyone should have to keep in sync with a stylesheet.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export interface VirtualWindowOptions {
  /** Total rows in the list (items for a tree, item rows for a grid). */
  rows: number;
  rowHeight: number;
  /** Rows kept rendered just outside the window (smooths fast scroll). */
  overscan?: number;
  /** Scroll into view (only if off-screen); paired with `scrollNonce`. */
  scrollToIndex?: number;
  /** Bump to re-trigger a scroll to the SAME index (controlled imperative scroll). */
  scrollNonce?: number;
  /** Scroller to window, when the caller owns it. Omitted ⇒ attach `scrollRef`. */
  scrollRef?: RefObject<HTMLDivElement | null>;
}

export interface VirtualWindow {
  /** Attach to the scrolling element (unless one was supplied). */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Attach to the full-height spacer the rows are positioned inside. */
  sizerRef: RefObject<HTMLDivElement | null>;
  /** Row range to render, overscan included (`end` exclusive). */
  start: number;
  end: number;
  /** Height the spacer needs so the scrollbar matches the un-rendered whole. */
  totalHeight: number;
  /** Bring a row into view now, without waiting for a render (keyboard nav). */
  scrollRowIntoView: (row: number) => void;
}

export function useVirtualWindow(opts: VirtualWindowOptions): VirtualWindow {
  const { rows, rowHeight, overscan = 8, scrollToIndex, scrollNonce } = opts;
  const ownRef = useRef<HTMLDivElement>(null);
  const scrollRef = opts.scrollRef ?? ownRef;
  const sizerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
  // Distance from the scroller's content top to row 0 — the scroller's padding
  // plus whatever it renders above the window (the list view's column header).
  const [lead, setLead] = useState(0);

  // A native listener, not React's onScroll: the scroller may be the caller's
  // element, and there is nowhere to hand it a prop.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = (): void => {
      setViewH(el.clientHeight);
      const sizer = sizerRef.current;
      if (sizer) setLead(sizer.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop);
    };
    const onScroll = (): void => setScrollTop(el.scrollTop);
    update();
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (sizerRef.current) ro.observe(sizerRef.current);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, [scrollRef]);

  // Only moves when the target row is outside the window, so an in-view selection
  // never jumps under the user.
  const scrollRowIntoView = useCallback((row: number): void => {
    const el = scrollRef.current;
    if (!el || row < 0) return;
    const top = lead + row * rowHeight;
    const bottom = top + rowHeight;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
  }, [scrollRef, lead, rowHeight]);

  const latest = useRef(scrollRowIntoView);
  latest.current = scrollRowIntoView;
  useEffect(() => {
    if (scrollToIndex != null) latest.current(scrollToIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollNonce]);

  const above = Math.max(0, scrollTop - lead);
  return {
    scrollRef,
    sizerRef,
    start: Math.max(0, Math.floor(above / rowHeight) - overscan),
    end: Math.min(rows, Math.ceil((above + viewH) / rowHeight) + overscan),
    totalHeight: rows * rowHeight,
    scrollRowIntoView,
  };
}
