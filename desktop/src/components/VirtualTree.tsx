// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  VirtualTree.tsx — a windowed fixed-height list.
 *
 * Renders only the rows in the scroll window (plus overscan) over a spacer sized
 * to the full list, so a tree of thousands of entities stays a handful of DOM
 * nodes. The list MUST already be flattened to render order (see
 * {@link buildOutlinerItems}); this owns no hierarchy — just the scroll window.
 * Shared by the editor + live-game outliner trees (one virtualization path).
 *
 * Extra props (className / onDragOver / onDrop / …) spread onto the scroll
 * container, so the outliner can attach empty-space drag-drop to it.
 */
import {
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type Key,
  type ReactNode,
} from 'react';

interface VirtualTreeProps<T> extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  items: T[];
  rowHeight: number;
  /** Rows kept rendered just outside the window (smooths fast scroll). */
  overscan?: number;
  renderRow: (item: T, index: number) => ReactNode;
  getKey: (item: T, index: number) => Key;
  /** Row index to scroll into view (only if off-screen); paired with `scrollNonce`. */
  scrollToIndex?: number;
  /** Bump to re-trigger a scroll to the SAME index (controlled imperative scroll). */
  scrollNonce?: number;
}

export function VirtualTree<T>({
  items,
  rowHeight,
  overscan = 8,
  renderRow,
  getKey,
  scrollToIndex,
  scrollNonce,
  onScroll,
  ...rest
}: VirtualTreeProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewH(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Controlled scroll-into-view (reveal-on-select / keyboard nav): only moves when
  // the target row is outside the window, so an in-view selection never jumps.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || scrollToIndex == null || scrollToIndex < 0) return;
    const top = scrollToIndex * rowHeight;
    const bottom = top + rowHeight;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollNonce]);

  const total = items.length;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(total, Math.ceil((scrollTop + viewH) / rowHeight) + overscan);

  return (
    <div
      ref={scrollRef}
      {...rest}
      onScroll={(e) => {
        setScrollTop(e.currentTarget.scrollTop);
        onScroll?.(e);
      }}
    >
      <div style={{ height: total * rowHeight, position: 'relative' }}>
        {items.slice(start, end).map((item, i) => {
          const index = start + i;
          return (
            <div
              key={getKey(item, index)}
              style={{ position: 'absolute', top: index * rowHeight, left: 0, right: 0, height: rowHeight }}
            >
              {renderRow(item, index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
