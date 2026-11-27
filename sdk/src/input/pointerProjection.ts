// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App } from '../app/app';
import { renderSurfaceContentRect } from '../app/surface';
import { renderSurfaceDevicePixelRatio } from '../platform/base';
import type { Vec2 } from '../types';

/** Sample the input-to-framebuffer mapping once for a batch of pointer queries. */
export function pointerProjection(app: App, surfaceW: number, surfaceH: number): (x: number, y: number) => Vec2 {
    const rect = renderSurfaceContentRect(app);
    if (rect && rect.width > 0 && rect.height > 0 && surfaceW > 0 && surfaceH > 0) {
        const scaleX = surfaceW / rect.width, scaleY = surfaceH / rect.height;
        return (x, y) => ({ x: (x - rect.x) * scaleX, y: surfaceH - (y - rect.y) * scaleY });
    }
    const dpr = renderSurfaceDevicePixelRatio(app);
    return (x, y) => ({ x: x * dpr, y: surfaceH - y * dpr });
}
