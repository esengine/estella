// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  VirtualGrid.tsx — a windowed auto-fill tile grid.
 *
 * The Content Browser's half of the virtualization {@link VirtualTree} does for
 * the outliner: a folder is however many files the user put in it, and mounting a
 * tile per entry is how opening one costs thousands of DOM nodes and an image
 * decode apiece. Only the rows in the scroll window exist.
 *
 * Columns are computed, not observed. `repeat(auto-fill, minmax(T, 1fr))` fits the
 * largest n where `n·T + (n-1)·gap ≤ W`, and each row here is laid out as
 * `repeat(n, 1fr)` with the same gap — the same tiles at the same widths, but a
 * number this component knows, so keyboard navigation can move by a row without
 * asking the DOM where the rows happened to break.
 *
 * Row height is MEASURED from a real row rather than derived: a tile is a square
 * thumbnail plus a name strip whose height is the stylesheet's business, and a
 * virtualizer that guesses it drifts a row per screenful.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useVirtualWindow } from './virtualWindow';

interface VirtualGridProps<T> {
  items: T[];
  /** The scroller to window — the caller's, so it keeps its own event handlers. */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Minimum tile width in px — the `minmax()` floor. Ignored when `columns` is set. */
  tileSize: number;
  /** Gap between tiles in px; must match the stylesheet's. */
  gap: number;
  /** Fix the column count instead of fitting it to the width — `1` is a list. */
  columns?: number;
  /** Row height to assume for the first render only, before one is measured.
   *  Defaults to a square tile plus a name strip, which is what a grid row is. */
  estimatedRowHeight?: number;
  /** Rows kept rendered just outside the window. A grid row is a whole rowful of
   *  tiles, so the default is far smaller than a list's. */
  overscan?: number;
  /** Renders one tile; the returned element carries its own React key. */
  renderItem: (item: T, index: number) => ReactNode;
  /** ITEM index to scroll into view; paired with `scrollNonce`. */
  scrollToIndex?: number;
  scrollNonce?: number;
  /** Reports the live column count, so a caller's arrow keys move by a real row. */
  onColumns?: (columns: number) => void;
}

/** The width available to the grid — the scroller's content box, padding removed. */
function useContentWidth(ref: RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = (): void => {
      const cs = getComputedStyle(el);
      setWidth(Math.max(0, el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

export function VirtualGrid<T>({
  items,
  scrollRef,
  tileSize,
  gap,
  columns: fixedColumns,
  estimatedRowHeight,
  overscan = 2,
  renderItem,
  scrollToIndex,
  scrollNonce,
  onColumns,
}: VirtualGridProps<T>) {
  const width = useContentWidth(scrollRef);
  const columns = fixedColumns ?? (width > 0 ? Math.max(1, Math.floor((width + gap) / (tileSize + gap))) : 1);

  // Measured through a REF CALLBACK, not an effect: the probe is whichever row
  // happens to be first in the window, so it is replaced by a different element
  // every time the window moves. An effect keyed on anything else keeps observing
  // the row that scrolled away — and a detached element reports zero, which sent
  // the row height back to the estimate and the scrollbar to nonsense.
  const [rowSize, setRowSize] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const probeRef = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    // Never accept zero: a row mid-teardown has no height, and it is not news.
    const measure = (): void => setRowSize((h) => el.offsetHeight || h);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    observer.current = ro;
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);

  const estimated = estimatedRowHeight ?? Math.floor((width - gap * (columns - 1)) / columns) + 30;
  const rowHeight = Math.max(1, rowSize || estimated) + gap;

  const rows = Math.ceil(items.length / columns);
  const win = useVirtualWindow({
    rows,
    rowHeight,
    overscan,
    scrollRef,
    scrollToIndex: scrollToIndex == null || scrollToIndex < 0 ? undefined : Math.floor(scrollToIndex / columns),
    scrollNonce,
  });

  useEffect(() => onColumns?.(columns), [columns, onColumns]);

  return (
    <div ref={win.sizerRef} style={{ height: win.totalHeight, position: 'relative' }}>
      {Array.from({ length: Math.max(0, win.end - win.start) }, (_, r) => {
        const row = win.start + r;
        const from = row * columns;
        return (
          <div
            key={row}
            ref={r === 0 ? probeRef : undefined}
            style={{
              display: 'grid',
              // minmax(0, …), not a bare `1fr`: `1fr` floors each track at the
              // tile's min-content, and a tile whose name does not wrap has a
              // min-content as wide as the name — one long filename would widen
              // every column and push the row past the scroller.
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              gap: `${gap}px`,
              position: 'absolute',
              top: row * rowHeight,
              left: 0,
              right: 0,
            }}
          >
            {items.slice(from, from + columns).map((item, c) => renderItem(item, from + c))}
          </div>
        );
      })}
    </div>
  );
}
