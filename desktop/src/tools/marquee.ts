// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  marquee.ts
 * @brief The in-progress box-select rect (canvas-relative CSS px), shared from the
 *        select/transform tool to the Viewport overlay. A plain module ref read by
 *        the overlay's per-frame rAF (like the tile-brush hover) — no React churn
 *        during a drag.
 */
import type { ClientRect } from '@/engine/viewportMath';

let rect: ClientRect | null = null;

export const Marquee = {
  set(r: ClientRect | null): void {
    rect = r;
  },
  get(): ClientRect | null {
    return rect;
  },
};
