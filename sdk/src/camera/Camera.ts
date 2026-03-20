import type { App } from '../app';
import { UICameraInfo, type UICameraData } from '../ui/UICameraInfo';
import { screenToWorld, worldToScreen, createInvVPCache } from '../ui/uiMath';

const invVPCache = createInvVPCache();

let app_: App | null = null;

export function initCameraAPI(app: App): void {
    app_ = app;
}

export function shutdownCameraAPI(): void {
    app_ = null;
}

function getCameraData(): UICameraData | null {
    if (!app_) return null;
    const cam = app_.getResource(UICameraInfo);
    return cam.valid ? cam : null;
}

export const CameraUtils = {
    screenToWorld(screenX: number, screenY: number): { x: number; y: number } | null {
        const cam = getCameraData();
        if (!cam) return null;
        invVPCache.update(cam.viewProjection);
        const invVP = invVPCache.getInverse(cam.viewProjection);
        return screenToWorld(screenX, screenY, invVP, cam.vpX, cam.vpY, cam.vpW, cam.vpH);
    },

    worldToScreen(worldX: number, worldY: number): { x: number; y: number } | null {
        const cam = getCameraData();
        if (!cam) return null;
        const [sx, sy] = worldToScreen(worldX, worldY, cam.viewProjection, cam.vpX, cam.vpY, cam.vpW, cam.vpH);
        return { x: sx, y: sy };
    },

    getWorldMousePosition(): { x: number; y: number } | null {
        const cam = getCameraData();
        if (!cam) return null;
        return { x: cam.worldMouseX, y: cam.worldMouseY };
    },

    getWorldBounds(): { left: number; right: number; bottom: number; top: number } | null {
        const cam = getCameraData();
        if (!cam) return null;
        return { left: cam.worldLeft, right: cam.worldRight, bottom: cam.worldBottom, top: cam.worldTop };
    },
};
