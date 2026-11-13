// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    breakable.test.ts
 * @brief   A thing that breaks: whole until its flag is raised, its pieces after, and whole again when it is lowered.
 *
 *          Held here: that raising `broken` puts the pieces where the whole stood and hides the whole rather than
 *          removing it, that each piece is thrown out from where the thing was struck once the world has a body for
 *          it, that the pieces go after their lifetime, and that lowering the flag undoes all of it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Entity } from '../src/types';
import type { TransformData } from '../src/ecs/component';
import type { PrefabServer } from '../src/prefab/prefabServer';

// The engine's own Transform, MeshRenderer and RigidBody3D live in the C++ registry, which a unit test has none of.
// Stood in for here by components of the same shape, handed out under the names the breakable asks for them by.
vi.mock('../src/ecs/component', async (importOriginal) => {
    const real = await importOriginal<typeof import('../src/ecs/component')>();
    const Transform = real.defineComponent('BreakableTestTransform', { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } });
    const stand: Record<string, unknown> = {
        MeshRenderer: real.defineComponent('BreakableTestRenderer', { enabled: true }),
        RigidBody3D: real.defineComponent('BreakableTestBody', { bodyType: 2, enabled: true }),
    };
    return { ...real, Transform, getComponent: (name: string) => stand[name] ?? real.getComponent(name) };
});

const { App } = await import('../src/app/app');
const { Transform, getComponent } = await import('../src/ecs/component');
const { Breakable, BreakablePlugin, burstVelocity, reportContact, setBodyPusher } = await import('../src/breakable/breakable');
const { Prefabs } = await import('../src/prefab/prefabServer');
const MeshRenderer = getComponent('MeshRenderer')!;
const Body = getComponent('RigidBody3D')!;

interface Made { root: Entity; pieces: Entity[] }

function setup(pieceAt: [number, number, number][] = [[10, 0, 0], [-10, 0, 0], [0, 10, 0]]) {
    const app = App.new();
    app.addPlugin(new BreakablePlugin());
    const made: Made[] = [];
    let fail = false;
    const released: string[] = [];
    const prefabs = {
        prepare: vi.fn(async (path: string) => ({ release: () => { released.push(path); } })),
        instantiate: vi.fn(async () => {
            if (fail) throw new Error('no such prefab');
            const root = app.world.spawn('Pieces');
            app.world.insert(root, Transform, {});
            const pieces = pieceAt.map(([x, y, z], i) => {
                const e = app.world.spawn(`Piece ${i + 1}`);
                app.world.insert(e, Transform, { position: { x, y, z } });
                app.world.insert(e, Body, {});
                app.world.setParent?.(e, root);
                return e;
            });
            made.push({ root, pieces });
            return { root, entities: new Map<number, Entity>([[0, root], ...pieces.map((e, i): [number, Entity] => [i + 1, e])]) };
        }),
    } as unknown as PrefabServer;
    app.insertResource(Prefabs, prefabs);
    const whole = app.world.spawn('Pot');
    app.world.insert(whole, Transform, { position: { x: 100, y: 50, z: 0 } });
    app.world.insert(whole, MeshRenderer, {});
    app.world.insert(whole, Body, {});
    app.world.insert(whole, Breakable, { pieces: 'pot_pieces.esprefab', burst: 200 });
    const breakIt = (on: boolean): void => app.world.update(whole, Breakable, (d) => { d.broken = on; });
    const tick = async (n = 1): Promise<void> => { for (let i = 0; i < n; i++) await app.tick(0.1); };
    return { app, whole, made, prefabs, released, breakIt, tick, failNext: () => { fail = true; } };
}

let pushed: [Entity, { x: number; y: number; z: number }][] = [];
let bodies = new Set<Entity>();
beforeEach(() => {
    pushed = [];
    bodies = new Set();
    setBodyPusher((entity, velocity) => { if (!bodies.has(entity)) return false; pushed.push([entity, velocity]); return true; });
});

describe('a thing that breaks', () => {
    it('is whole until its flag is raised', async () => {
        const { app, whole, prefabs, tick } = setup();
        await tick(3);
        expect(prefabs.instantiate).not.toHaveBeenCalled();
        expect(app.world.get(whole, MeshRenderer).enabled).toBe(true);
    });

    it('has its pieces made ready while it stands whole, and lets them go when it is removed', async () => {
        const { app, whole, prefabs, released, tick } = setup();
        await tick(3);
        expect(prefabs.prepare).toHaveBeenCalledTimes(1);
        expect(prefabs.prepare).toHaveBeenCalledWith('pot_pieces.esprefab');
        expect(released).toEqual([]);
        // Other pieces asked for: the first are let go and the new ones made ready.
        app.world.update(whole, Breakable, (d) => { d.pieces = 'pot_shards.esprefab'; });
        await tick(2);
        expect(released).toEqual(['pot_pieces.esprefab']);
        expect(prefabs.prepare).toHaveBeenLastCalledWith('pot_shards.esprefab');
        app.world.despawn(whole);
        await tick(1);
        expect(released).toEqual(['pot_pieces.esprefab', 'pot_shards.esprefab']);
    });

    it('puts its pieces where it stood and hides the whole, which is not removed', async () => {
        const { app, whole, made, prefabs, breakIt, tick } = setup();
        breakIt(true);
        await tick(2);
        expect(prefabs.instantiate).toHaveBeenCalledTimes(1);
        expect(prefabs.instantiate).toHaveBeenCalledWith('pot_pieces.esprefab');
        expect((app.world.get(made[0]!.root, Transform) as TransformData).position).toMatchObject({ x: 100, y: 50, z: 0 });
        expect(app.world.valid(whole)).toBe(true);
        expect(app.world.get(whole, MeshRenderer).enabled).toBe(false);
        expect(app.world.get(whole, Body).enabled).toBe(false);
        // Once: a thing that is broken is not broken again every frame.
        await tick(5);
        expect(prefabs.instantiate).toHaveBeenCalledTimes(1);
    });

    it('throws each piece out from where it was struck, once the world has a body for it', async () => {
        const { made, breakIt, tick } = setup();
        breakIt(true);
        await tick(2);
        // No bodies yet: the world makes them on its next step, and nothing is thrown until then.
        expect(pushed).toEqual([]);
        for (const e of made[0]!.pieces) bodies.add(e);
        await tick(1);
        expect(pushed.map(([e]) => e)).toEqual(made[0]!.pieces);
        const [right, left, up] = pushed.map(([, v]) => v);
        // Out along where each lies from the middle, at the speed asked, and a little up.
        expect(right!.x).toBeGreaterThan(150);
        expect(left!.x).toBeLessThan(-150);
        expect(up!.y).toBeGreaterThan(190);
        for (const v of [right!, left!, up!]) expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(200, 6);
        expect(right!.y).toBeGreaterThan(0);
        // Thrown once.
        await tick(3);
        expect(pushed).toHaveLength(3);
    });

    it('flies from where it is struck, not from its middle', () => {
        // Struck on its right side, the piece on the left goes left and the piece at the blow goes up.
        expect(burstVelocity({ x: -10, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, 100).x).toBeLessThan(-90);
        const at = burstVelocity({ x: 10, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, 100);
        expect([at.x, at.y, at.z]).toEqual([0, 100, 0]);
    });

    it('lets its pieces fall where they are when it has no burst', async () => {
        const { app, whole, made, breakIt, tick } = setup();
        app.world.update(whole, Breakable, (d) => { d.burst = 0; });
        breakIt(true);
        await tick(2);
        for (const e of made[0]!.pieces) bodies.add(e);
        await tick(2);
        expect(pushed).toEqual([]);
    });

    it('takes the pieces away after their lifetime, and stays broken', async () => {
        const { app, whole, made, breakIt, tick } = setup();
        app.world.update(whole, Breakable, (d) => { d.lifetime = 0.5; });
        breakIt(true);
        await tick(3);
        expect(app.world.valid(made[0]!.root)).toBe(true);
        await tick(5);
        expect(app.world.valid(made[0]!.root)).toBe(false);
        expect(app.world.get(whole, MeshRenderer).enabled).toBe(false);
        expect(app.world.get(whole, Breakable).broken).toBe(true);
    });

    it('is whole again when the flag is lowered, and breaks afresh when it is raised', async () => {
        const { app, whole, made, prefabs, breakIt, tick } = setup();
        breakIt(true);
        await tick(2);
        breakIt(false);
        await tick(1);
        expect(app.world.valid(made[0]!.root)).toBe(false);
        expect(app.world.get(whole, MeshRenderer).enabled).toBe(true);
        expect(app.world.get(whole, Body).enabled).toBe(true);
        breakIt(true);
        await tick(2);
        expect(prefabs.instantiate).toHaveBeenCalledTimes(2);
        expect(app.world.valid(made[1]!.root)).toBe(true);
    });

    it('breaks when struck at least as hard as its breakImpulse, from where it was struck', async () => {
        const { app, whole, prefabs, tick } = setup();
        app.world.update(whole, Breakable, (d) => { d.breakImpulse = 400; });
        const other = app.world.spawn('Ball');
        // Too soft: a ball rolled into it.
        reportContact(other, whole, 120, { x: 110, y: 50, z: 0 });
        await tick(2);
        expect(prefabs.instantiate).not.toHaveBeenCalled();
        // Hard: thrown at it, it named second or first.
        reportContact(whole, other, 380, { x: 90, y: 50, z: 0 });
        reportContact(other, whole, 650, { x: 100, y: 70, z: 10 });
        await tick(2);
        expect(prefabs.instantiate).toHaveBeenCalledTimes(1);
        const data = app.world.get(whole, Breakable);
        expect(data.broken).toBe(true);
        // The hardest hit, in its own space: it stands at (100, 50, 0).
        expect(data.origin).toEqual({ x: 0, y: 20, z: 10 });
        // Broken things are not broken again by what lands on them.
        reportContact(other, whole, 900, { x: 100, y: 50, z: 0 });
        await tick(2);
        expect(prefabs.instantiate).toHaveBeenCalledTimes(1);
    });

    it('is not broken by a hit when it has no breakImpulse, however hard', async () => {
        const { app, whole, prefabs, tick } = setup();
        reportContact(app.world.spawn('Boulder'), whole, 1e6, { x: 100, y: 50, z: 0 });
        await tick(2);
        expect(prefabs.instantiate).not.toHaveBeenCalled();
    });

    it('stops hearing hits when its app ends', async () => {
        const { app, whole } = setup();
        const ball = app.world.spawn('Ball');
        const asked = vi.spyOn(app.world, 'has');
        reportContact(ball, whole, 500, { x: 100, y: 50, z: 0 });
        expect(asked).toHaveBeenCalled();
        app.quit();
        asked.mockClear();
        // An app that has ended holds its world no longer through a hit it was told of.
        reportContact(ball, whole, 500, { x: 100, y: 50, z: 0 });
        expect(asked).not.toHaveBeenCalled();
    });

    it('takes its pieces with it when it is removed', async () => {
        const { app, whole, made, breakIt, tick } = setup();
        breakIt(true);
        await tick(2);
        app.world.despawn(whole);
        await tick(1);
        expect(app.world.valid(made[0]!.root)).toBe(false);
    });

    it('stays whole, and says so, when its pieces cannot be loaded', async () => {
        const { app, whole, breakIt, tick, failNext } = setup();
        failNext();
        breakIt(true);
        await tick(3);
        expect(app.world.get(whole, MeshRenderer).enabled).toBe(true);
        expect(app.world.get(whole, Breakable).broken).toBe(false);
    });
});
