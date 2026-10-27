// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, describe, expect, it } from 'vitest';
import { buildCameraInfo, type CameraPOV } from '../src/camera/CameraPlugin';
import { ProjectionType, ClearFlags } from '../src/ecs/component';
import { followRenderOrigin, pushRenderOrigin, renderOrigin, resetRenderOrigin, setRenderOriginStep } from '../src/render/renderOrigin';

const pov = (over: Partial<CameraPOV>): CameraPOV => ({
    entity: -1, isActive: true, x: 0, y: 0, z: 0, rotation: 0, projection: ProjectionType.Perspective, orthoSize: 10, fov: 60, near: 0.1, far: 100000,
    viewport: { x: 0, y: 0, z: 1, w: 1 }, clearFlags: ClearFlags.ColorAndDepth, priority: 0, pixelPerfect: false, cullingMask: 0xFFFFFFFF, renderTarget: 0, ...over,
});

const clip = (m: Float32Array, p: [number, number, number]): [number, number, number, number] =>
    [0, 1, 2, 3].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]) as [number, number, number, number];

afterEach(resetRenderOrigin);

describe('the render origin', () => {
    it('is zero, and the render view is the view, while it is off', () => {
        const cam = buildCameraInfo(pov({ x: 5, y: 2, z: 9 }), 800, 600, null, [], 0);
        expect(Array.from(cam.renderViewProjection)).toEqual(Array.from(cam.viewProjection));
        expect(followRenderOrigin(1e6, 0, 0)).toBe(false);
        expect(renderOrigin()).toMatchObject({ x: 0, y: 0, z: 0 });
    });

    it('stays where it is until the eye is further than a step, then moves to the eye rounded to the step', () => {
        setRenderOriginStep(1000);
        expect(followRenderOrigin(900, -900, 300)).toBe(false);
        expect(followRenderOrigin(2600, 10, -4100)).toBe(true);
        expect(renderOrigin()).toMatchObject({ x: 3000, y: 0, z: -4000 });
        expect(followRenderOrigin(3400, 10, -4100)).toBe(false);
    });

    it('draws a point relative to the origin where the view draws it relative to the world', () => {
        setRenderOriginStep(1000);
        followRenderOrigin(40000, 30, 60000);
        const o = renderOrigin();
        for (const p of [
            pov({ x: 40000, y: 30, z: 60000 }),
            pov({ x: 40000, y: 30, z: 60000, tilt: { x: 0.1, y: 0.3, z: 0, w: 0.95 } }),
            pov({ x: 40000, y: 30, z: 20, orbit: { yaw: 0.4, pitch: 0.3, focusZ: 60000 } }),
        ]) {
            const cam = buildCameraInfo(p, 800, 600, null, [], 0);
            const world: [number, number, number] = [40003, 31, 59990];
            const a = clip(cam.viewProjection, world);
            const b = clip(cam.renderViewProjection, [world[0] - o.x, world[1] - o.y, world[2] - o.z]);
            for (let i = 0; i < 4; i++) expect(b[i]).toBeCloseTo(a[i]!, 1);
        }
    });

    it('is handed to the engine once for each place it stands', () => {
        const seen: number[][] = [];
        setRenderOriginStep(10);
        pushRenderOrigin((x, y, z) => seen.push([x, y, z]));
        followRenderOrigin(100, 0, 0);
        pushRenderOrigin((x, y, z) => seen.push([x, y, z]));
        pushRenderOrigin((x, y, z) => seen.push([x, y, z]));
        expect(seen).toEqual([[100, 0, 0]]);
    });
});
