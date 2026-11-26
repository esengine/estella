// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
import { CameraViewAPI, type CameraLens } from '../src/camera/Camera';
import { perspective } from '../src/math/mat4';

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

function makeCamera(cameraData: typeof mockUICameraData & Pick<CameraLens, 'rebasedProjection'> = mockUICameraData): CameraViewAPI {
    const app = { getResource: vi.fn(() => cameraData) } as any;
    return new CameraViewAPI(app);
}

describe('CameraViewAPI', () => {
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

    it('intersects and clips perspective rays at their world depth after rebasing', () => {
        const origin = { x: 2 ** 28, y: -(2 ** 28), z: 2 ** 28 };
        const cam = makeCamera({ ...mockUICameraData,
            rebasedProjection: { origin, viewProjection: new Float32Array(perspective(Math.PI / 2, 4 / 3, 1, 100)) },
        });
        const target = { x: origin.x + 5, y: origin.y, z: origin.z - 10 };
        expect(cam.worldToScreen(target.x, target.y, target.z)).toEqual({ x: 550, y: 300 });
        expect(cam.screenToWorld(550, 300, target.z)?.x).toBeCloseTo(target.x, 4);
        expect(cam.projectDirectionAt(target, { x: 1, y: 0, z: 0 })?.x).toBeCloseTo(30);
        const first = { ...target, z: origin.z - 0.5 };
        const clipped = cam.clipSegment(first, target);
        expect(clipped?.a.z).toBeCloseTo(origin.z - 1, 2);
        expect(clipped?.b).toEqual(target);
    });

    it('returns the world mouse position', () => {
        expect(makeCamera().getWorldMousePosition()).toEqual({ x: 50, y: -25 });
    });

    it('returns the world bounds', () => {
        expect(makeCamera().getWorldBounds()).toEqual({
            left: -400, right: 400, bottom: -300, top: 300,
        });
    });

    // The whole point of F3: two Apps each have their own CameraViewAPI reading
    // their own UICameraInfo — no shared global `app_` to bleed between them.
    it('is isolated per App', () => {
        const a = makeCamera({ ...mockUICameraData, worldMouseX: 1, worldMouseY: 2 });
        const b = makeCamera({ ...mockUICameraData, worldMouseX: 9, worldMouseY: 8 });
        expect(a.getWorldMousePosition()).toEqual({ x: 1, y: 2 });
        expect(b.getWorldMousePosition()).toEqual({ x: 9, y: 8 });
        expect(a.getWorldMousePosition()).toEqual({ x: 1, y: 2 });
    });
});
