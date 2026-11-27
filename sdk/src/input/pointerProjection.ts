// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App } from '../app/app';
import { renderSurfaceContentRect } from '../app/surface';
import { renderSurfaceDevicePixelRatio } from '../platform/base';
import type { Vec2 } from '../types';

/** Sample the input-to-framebuffer mapping once for a batch of pointer queries. */
export function pointerProjection(app: App, surfaceW: number, surfaceH: number): (x: number, y: number) => Vec2 {
    const { x: left, y: top, scaleX, scaleY } = pointerFrame(app, surfaceW, surfaceH);
    return (x, y) => ({ x: (x - left) * scaleX, y: surfaceH - (y - top) * scaleY });
}

/** Project a framebuffer point back into the same CSS offsets reported by input. */
export function framebufferToPointer(app: App, surfaceW: number, surfaceH: number, x: number, y: number): Vec2 {
    const { x: left, y: top, scaleX, scaleY } = pointerFrame(app, surfaceW, surfaceH);
    return { x: left + x / scaleX, y: top + (surfaceH - y) / scaleY };
}

function pointerFrame(app: App, surfaceW: number, surfaceH: number) {
    const rect = renderSurfaceContentRect(app);
    if (rect && rect.width > 0 && rect.height > 0 && surfaceW > 0 && surfaceH > 0) {
        return { x: rect.x, y: rect.y, scaleX: surfaceW / rect.width, scaleY: surfaceH / rect.height };
    }
    const ratio = renderSurfaceDevicePixelRatio(app);
    const scale = ratio > 0 ? ratio : 1;
    return { x: 0, y: 0, scaleX: scale, scaleY: scale };
}
