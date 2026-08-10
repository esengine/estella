// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Camera bounds — the world rectangle a camera may not look outside of,
 *        and the fact that it constrains where a camera IS rather than what
 *        moved it there.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '../src/ecs/world';
import { Transform, Camera, ProjectionType } from '../src/ecs/component';
import { CameraBounds, cameraBoundsUpdate, clampCameraAxis } from '../src/camera/CameraBounds';
import { FollowTarget, followUpdate } from '../src/camera/FollowTarget';
import type { Entity } from '../src/types';
import { createMockModule } from './mocks/wasm';

describe('clampCameraAxis', () => {
    it('leaves an axis alone when no interval was named', () => {
        expect(clampCameraAxis(500, 480, 0, 0)).toBe(500);
        expect(clampCameraAxis(500, 480, 100, 100)).toBe(500);
    });

    it('holds the view inside the interval', () => {
        expect(clampCameraAxis(-900, 480, -1000, 1000)).toBe(-520);
        expect(clampCameraAxis(900, 480, -1000, 1000)).toBe(520);
    });

    it('leaves a centre that already fits', () => {
        expect(clampCameraAxis(0, 480, -1000, 1000)).toBe(0);
    });

    it('centres an interval narrower than the view, rather than pinning a wall', () => {
        expect(clampCameraAxis(-300, 480, -200, 600)).toBe(200);
    });
});

describe('cameraBoundsUpdate', () => {
    let world: World;

    beforeEach(() => {
        world = new World();
        const mod = createMockModule();
        world.connectCpp(mod.getRegistry(), mod);
    });

    const spawnCamera = (x: number, y: number, bounds?: Partial<typeof CameraBounds._default>): Entity => {
        const e = world.spawn('camera');
        world.insert(e, Transform, { position: { x, y, z: 0 } });
        world.insert(e, Camera, {
            projectionType: ProjectionType.Orthographic,
            orthoSize: 540,
            aspectRatio: 16 / 9,
            isActive: true,
        });
        if (bounds) world.insert(e, CameraBounds, bounds);
        return e;
    };

    const at = (e: Entity): { x: number; y: number } => {
        const p = world.get(e, Transform).position;
        return { x: p.x, y: p.y };
    };

    it('holds a camera inside its rectangle on both axes', () => {
        const e = spawnCamera(-4000, 3000, { minX: -2000, maxX: 2000, minY: -1200, maxY: 1200 });
        cameraBoundsUpdate(world);
        expect(at(e)).toEqual({ x: -2000 + 960, y: 1200 - 540 });
    });

    it('leaves a camera with no bounds component where it is', () => {
        const e = spawnCamera(-4000, 3000);
        cameraBoundsUpdate(world);
        expect(at(e)).toEqual({ x: -4000, y: 3000 });
    });

    it('constrains only the axes that named an interval', () => {
        const e = spawnCamera(-4000, 3000, { minX: -2000, maxX: 2000 });
        cameraBoundsUpdate(world);
        expect(at(e)).toEqual({ x: -1040, y: 3000 });
    });

    // Half extents under perspective depend on how far away the subject is,
    // which orthoSize does not describe — clamping against it would be a number
    // that means nothing here.
    it('leaves a perspective camera alone', () => {
        const e = world.spawn('camera');
        world.insert(e, Transform, { position: { x: -4000, y: 0, z: 0 } });
        world.insert(e, Camera, {
            projectionType: ProjectionType.Perspective,
            orthoSize: 540,
            aspectRatio: 16 / 9,
            isActive: true,
        });
        world.insert(e, CameraBounds, { minX: -2000, maxX: 2000 });
        cameraBoundsUpdate(world);
        expect(at(e).x).toBe(-4000);
    });

    // The whole point of running after everything that moves a camera: follow is
    // one such thing, not the thing bounds belong to.
    it('holds a followed camera that was damped past the edge', () => {
        const player = world.spawn('player');
        world.insert(player, Transform, { position: { x: -5000, y: 0, z: 0 } });
        const e = spawnCamera(-4900, 0, { minX: -2000, maxX: 2000 });
        world.insert(e, FollowTarget, { target: player, offsetX: 0, offsetY: 0, deadzone: 0, damping: 0 });

        followUpdate(world, 1 / 60);
        expect(at(e).x).toBe(-5000);
        cameraBoundsUpdate(world);
        expect(at(e).x).toBe(-1040);
    });
});
