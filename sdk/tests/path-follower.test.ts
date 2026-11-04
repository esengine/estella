// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { afterEach, beforeAll, beforeEach } from 'vitest';
import { World } from '../src/ecs/world';
import { Transform } from '../src/ecs/component';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';
import {
    Spline, PathFollower, PathMode, PathOrient, SplinePlugin, pathPlace, type PathFollowerData,
} from '../src/spline/splinePlugin';

describe('pathPlace', () => {
    it('stops at either end of a Once path and says which way it ran out', () => {
        expect(pathPlace(3, 10, PathMode.Once)).toEqual({ s: 3, done: false });
        expect(pathPlace(12, 10, PathMode.Once)).toEqual({ s: 10, done: true });
        expect(pathPlace(-2, 10, PathMode.Once, false)).toEqual({ s: 0, done: true });
        // Standing at the start, about to go forward, is not the end.
        expect(pathPlace(0, 10, PathMode.Once, true).done).toBe(false);
    });

    it('goes round on a Loop, in either direction', () => {
        expect(pathPlace(13, 10, PathMode.Loop).s).toBeCloseTo(3);
        expect(pathPlace(-3, 10, PathMode.Loop).s).toBeCloseTo(7);
    });

    it('turns back at the ends of a PingPong', () => {
        expect(pathPlace(4, 10, PathMode.PingPong).s).toBeCloseTo(4);
        expect(pathPlace(14, 10, PathMode.PingPong).s).toBeCloseTo(6);
        expect(pathPlace(24, 10, PathMode.PingPong).s).toBeCloseTo(4);
    });

    it('is still on a curve with no length', () => {
        expect(pathPlace(5, 0, PathMode.Loop)).toEqual({ s: 0, done: false });
    });
});

/** The engine's own world: Transform is a C++ component, so a follower can only be tried against the real registry. */
describe.skipIf(!HAS_WASM)('PathFollower', () => {
    let engine: ESEngineModule, registry: CppRegistry, world: World;
    beforeAll(async () => { engine = await loadWasmModule(); });
    beforeEach(() => { registry = new engine.Registry(); world = new World(); world.connectCpp(registry, engine); });
    afterEach(() => { for (const e of world.getAllEntities()) world.despawn(e); world.disconnectCpp(); registry.delete(); });

    /** A straight 10-unit path along x on a rail at `at` (scaled by `scale`), and a follower on an entity of its own. */
    function setup(follower: Partial<PathFollowerData>, at = { x: 0, y: 0, z: 0 }, scale = 1) {
        const rail = world.spawn();
        world.insert(rail, Transform, { position: at, worldPosition: at, scale: { x: scale, y: scale, z: scale }, worldScale: { x: scale, y: scale, z: scale } } as never);
        world.insert(rail, Spline, { points: [{ x: 0, y: 0, z: 0, width: 1 }, { x: 10, y: 0, z: 0, width: 1 }], closed: false });
        const mover = world.spawn();
        world.insert(mover, Transform);
        world.insert(mover, PathFollower, { spline: rail as number, speed: 2, mode: PathMode.Once, ...follower });
        const plugin = new SplinePlugin();
        const step = (dt: number): void => (plugin as unknown as { follow(app: unknown, dt: number): void }).follow({ world }, dt);
        return { mover, step };
    }

    it('moves along the curve at its speed', () => {
        const { mover, step } = setup({});
        step(1); step(1);
        expect(world.get(mover, Transform).position.x).toBeCloseTo(4, 1);
        expect(world.get(mover, Transform).position.y).toBeCloseTo(0);
        expect(world.get(mover, PathFollower).distance).toBeCloseTo(4, 1);
    });

    it('stops itself at the end of a Once path', () => {
        const { mover, step } = setup({ speed: 8 });
        for (let i = 0; i < 4; i++) step(1);
        expect(world.get(mover, Transform).position.x).toBeCloseTo(10, 1);
        expect(world.get(mover, PathFollower).playing).toBe(false);
    });

    it("reads the curve through the rail's own Transform", () => {
        const { mover, step } = setup({ speed: 5 }, { x: 100, y: 0, z: 7 }, 2);
        step(1);
        const p = world.get(mover, Transform).position;
        // 5 world units along a curve doubled in size, from the rail's origin.
        expect(p.x).toBeCloseTo(105, 1);
        expect(p.z).toBeCloseTo(7, 1);
    });

    it('turns to face along the curve about z for a 2D sprite', () => {
        const { mover, step } = setup({ orient: PathOrient.FaceXY });
        step(1);
        const r = world.get(mover, Transform).rotation;
        expect(r.z).toBeCloseTo(0);
        expect(r.w).toBeCloseTo(1);
    });

    it('does nothing while it is not playing, or when its spline is gone', () => {
        const idle = setup({ playing: false });
        idle.step(1);
        expect(world.get(idle.mover, Transform).position.x).toBeCloseTo(0);
        const lost = setup({ spline: -1 });
        lost.step(1);
        expect(world.get(lost.mover, Transform).position.x).toBeCloseTo(0);
    });
});
