// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { CSSProperties } from 'react';

export interface Box {
  left: number;
  right: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Position a flyout submenu so it stays inside the window: open to the right of
 * its row by default, flip to the left when the right side would overflow (and
 * the left has room), and shift up when it would run past the bottom edge.
 * Pure so the placement is unit-tested without a DOM.
 */
export function submenuPlacement(
  row: Box,
  fly: { width: number; height: number },
  viewportW: number,
  viewportH: number,
  pad = 8,
): CSSProperties {
  const flipLeft = row.right + fly.width > viewportW - pad && row.left - fly.width > pad;
  const overflowY = Math.max(0, row.top + fly.height - (viewportH - pad));
  return {
    position: 'absolute',
    top: overflowY ? -overflowY : 0,
    visibility: 'visible',
    ...(flipLeft ? { right: '100%' } : { left: '100%' }),
  };
}
