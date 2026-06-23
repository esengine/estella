// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App } from '../app';
import { defineResource } from '../resource';
import { UICameraInfo, type UICameraData } from '../ui/UICameraInfo';
import { screenToWorld, worldToScreen, createInvVPCache } from '../ui/uiMath';

/**
 * Per-App camera-space query API: screen<->world conversions, the world-space
 * mouse position, and the active camera's world bounds.
 *
 * Reads the per-App {@link UICameraInfo} resource. Each App holds its own
 * instance (published as the {@link CameraView} resource) and its own
 * inverse-view-projection cache, so two Apps running at once never share a
 * single cached `app` or clobber each other's cache.
 */
export class CameraViewApi {
    private readonly invVPCache = createInvVPCache();

    constructor(private readonly app_: App) {}

    private cam(): UICameraData | null {
        const cam = this.app_.getResource(UICameraInfo);
        return cam.valid ? cam : null;
    }

    screenToWorld(screenX: number, screenY: number): { x: number; y: number } | null {
        const cam = this.cam();
        if (!cam) return null;
        this.invVPCache.update(cam.viewProjection);
        const invVP = this.invVPCache.getInverse(cam.viewProjection);
        return screenToWorld(screenX, screenY, invVP, cam.vpX, cam.vpY, cam.vpW, cam.vpH);
    }

    worldToScreen(worldX: number, worldY: number): { x: number; y: number } | null {
        const cam = this.cam();
        if (!cam) return null;
        const [sx, sy] = worldToScreen(worldX, worldY, cam.viewProjection, cam.vpX, cam.vpY, cam.vpW, cam.vpH);
        return { x: sx, y: sy };
    }

    getWorldMousePosition(): { x: number; y: number } | null {
        const cam = this.cam();
        if (!cam) return null;
        return { x: cam.worldMouseX, y: cam.worldMouseY };
    }

    getWorldBounds(): { left: number; right: number; bottom: number; top: number } | null {
        const cam = this.cam();
        if (!cam) return null;
        return { left: cam.worldLeft, right: cam.worldRight, bottom: cam.worldBottom, top: cam.worldTop };
    }
}

/**
 * Per-App camera-query API resource, published by `corePlugin`. Read it as
 * `app.getResource(CameraView)` to convert screen<->world etc. (Named
 * `CameraView` rather than `Camera` because `Camera` is the ECS component.)
 */
export const CameraView = defineResource<CameraViewApi>(null!, 'CameraView');
