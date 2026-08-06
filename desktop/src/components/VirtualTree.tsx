// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  VirtualTree.tsx — a windowed fixed-height list.
 *
 * Renders only the rows in the scroll window (plus overscan) over a spacer sized
 * to the full list, so a tree of thousands of entities stays a handful of DOM
 * nodes. The list MUST already be flattened to render order (see
 * {@link buildOutlinerItems}); this owns no hierarchy — just the layout. Which
 * rows are on screen is {@link useVirtualWindow}'s, shared with VirtualGrid.
 * Shared by the editor + live-game outliner trees (one virtualization path).
 *
 * Extra props (className / onDragOver / onDrop / …) spread onto the scroll
 * container, so the outliner can attach empty-space drag-drop to it.
 */
import type { HTMLAttributes, Key, ReactNode } from 'react';
import { useVirtualWindow } from './virtualWindow';

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
  overscan,
  renderRow,
  getKey,
  scrollToIndex,
  scrollNonce,
  ...rest
}: VirtualTreeProps<T>) {
  const win = useVirtualWindow({ rows: items.length, rowHeight, overscan, scrollToIndex, scrollNonce });

  return (
    <div ref={win.scrollRef} {...rest}>
      {/* Virtualization sizer — presentational so it doesn't sit between a
          role="tree" container and its role="treeitem" rows. */}
      <div ref={win.sizerRef} role="presentation" style={{ height: win.totalHeight, position: 'relative' }}>
        {items.slice(win.start, win.end).map((item, i) => {
          const index = win.start + i;
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
