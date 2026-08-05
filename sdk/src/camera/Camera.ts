// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App } from '../app/app';
import { defineResource } from '../ecs/resource';
import { UICameraInfo, type UICameraData } from '../ui/core/ui-camera-info';
import { screenToWorld, worldToScreen, createInvVPCache } from '../ui/util/math';

/**
 * Per-App camera-space query API: screen<->world conversions, the world-space
 * mouse position, and the active camera's world bounds.
 *
 * Reads the per-App {@link UICameraInfo} resource. Each App holds its own
 * instance (published as the {@link CameraView} resource) and its own
 * inverse-view-projection cache, so two Apps running at once never share a
 * single cached `app` or clobber each other's cache.
 */
export class CameraViewAPI {
    private readonly invVPCache = createInvVPCache();

    constructor(private readonly app_: App) {}

    private cam(): UICameraData | null {
        const cam = this.app_.getResource(UICameraInfo);
        return cam.valid ? cam : null;
    }

    /**
     * Where a screen point lands on the world plane at @p planeZ.
     *
     * A screen point is a ray. Orthographically its x/y do not vary along it, so
     * the plane is irrelevant and the default answers for everyone. Under a
     * perspective camera it decides the answer, and the right plane is the one
     * the thing being hit or dragged actually sits on — z = 0 would place a
     * sprite at z = -400 wherever its shadow on the 2D plane happens to fall.
     */
    screenToWorld(screenX: number, screenY: number, planeZ = 0): { x: number; y: number } | null {
        const cam = this.cam();
        if (!cam) return null;
        this.invVPCache.update(cam.viewProjection);
        const invVP = this.invVPCache.getInverse(cam.viewProjection);
        return screenToWorld(screenX, screenY, invVP, cam.vpX, cam.vpY, cam.vpW, cam.vpH, planeZ);
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
export const CameraView = defineResource<CameraViewAPI>(null!, 'CameraView');
