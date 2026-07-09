// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  tilePreview.ts
 * @brief The in-progress gesture-paint preview (rect fill region / line cells, in
 *        TILE coords), shared from the rect/line tools to the Viewport overlay. A
 *        plain module ref read by the overlay's per-frame rAF (like {@link Marquee}
 *        and the tile-brush hover) — the rect/line tools defer their commit to
 *        release, so this is what shows the shape mid-drag. No React churn.
 */

/** What a deferred paint gesture will affect, in the layer's tile grid. */
export type TilePreviewShape =
  | { kind: 'rect'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'line'; cells: { x: number; y: number }[] };

let shape: TilePreviewShape | null = null;

export const TilePaintPreview = {
  set(s: TilePreviewShape | null): void {
    shape = s;
  },
  clear(): void {
    shape = null;
  },
  get(): TilePreviewShape | null {
    return shape;
  },
};
