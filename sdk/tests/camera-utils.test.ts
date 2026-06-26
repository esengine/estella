// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
import { CameraViewApi } from '../src/camera/Camera';

const mockUICameraData = {
    viewProjection: new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
    ]),
    vpX: 0,
    vpY: 0,
    vpW: 800,
    vpH: 600,
    screenW: 800,
    screenH: 600,
    worldLeft: -400,
    worldRight: 400,
    worldBottom: -300,
    worldTop: 300,
    worldMouseX: 50,
    worldMouseY: -25,
    valid: true,
};

function makeCamera(cameraData = mockUICameraData): CameraViewApi {
    const app = { getResource: vi.fn(() => cameraData) } as any;
    return new CameraViewApi(app);
}

describe('CameraViewApi', () => {
    it('returns null when the camera is invalid', () => {
        const cam = makeCamera({ ...mockUICameraData, valid: false });
        expect(cam.screenToWorld(400, 300)).toBeNull();
        expect(cam.worldToScreen(0, 0)).toBeNull();
        expect(cam.getWorldMousePosition()).toBeNull();
        expect(cam.getWorldBounds()).toBeNull();
    });

    it('converts screen center to world origin with identity VP', () => {
        const result = makeCamera().screenToWorld(400, 300);
        expect(result).not.toBeNull();
        expect(result!.x).toBeCloseTo(0, 1);
        expect(result!.y).toBeCloseTo(0, 1);
    });

    it('converts world origin back to screen center', () => {
        const result = makeCamera().worldToScreen(0, 0);
        expect(result).not.toBeNull();
        expect(result!.x).toBeCloseTo(400, 0);
        expect(result!.y).toBeCloseTo(300, 0);
    });

    it('returns the world mouse position', () => {
        expect(makeCamera().getWorldMousePosition()).toEqual({ x: 50, y: -25 });
    });

    it('returns the world bounds', () => {
        expect(makeCamera().getWorldBounds()).toEqual({
            left: -400, right: 400, bottom: -300, top: 300,
        });
    });

    // The whole point of F3: two Apps each have their own CameraViewApi reading
    // their own UICameraInfo — no shared global `app_` to bleed between them.
    it('is isolated per App', () => {
        const a = makeCamera({ ...mockUICameraData, worldMouseX: 1, worldMouseY: 2 });
        const b = makeCamera({ ...mockUICameraData, worldMouseX: 9, worldMouseY: 8 });
        expect(a.getWorldMousePosition()).toEqual({ x: 1, y: 2 });
        expect(b.getWorldMousePosition()).toEqual({ x: 9, y: 8 });
        expect(a.getWorldMousePosition()).toEqual({ x: 1, y: 2 });
    });
});
