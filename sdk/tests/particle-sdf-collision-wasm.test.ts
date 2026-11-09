// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The CPU's answer to a `ParticleCollider`, on the real engine: what a device with no compute plays. The kernel's answer to the same shapes is
 * measured in the picture by the particle-gpu-collision editor check.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../src/app/app';
import { ParticleCollider, ParticleEmitter, Transform } from '../src/ecs/component';
import { Particle, ParticlePlugin } from '../src/particle';
import type { ParticleCollisionEventPayload } from '../src/particle/collision';
import type { Entity } from '../src/types';
import type { ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

const SDF = 4, DEPTH = 3;
let engine: ESEngineModule;
const apps: App[] = [];
afterEach(() => { for (const app of apps.splice(0)) app.quit(); });

async function scene() {
    const app = App.new(); apps.push(app);
    app.connectCpp(new engine.Registry(), engine, { ownedRegistry: true });
    app.addPlugin(new ParticlePlugin());
    const world = app.world;
    /** One particle at a time, straight along +x from the origin at 100 units a second. */
    const shot = (fields: Record<string, unknown> = {}): Entity => {
        const e = world.spawn();
        world.insert(e, Transform, {});
        world.insert(e, ParticleEmitter, {
            shape: 0, angleSpreadMin: 0, angleSpreadMax: 0, rate: 0, burstCount: 1, burstInterval: 100, maxParticles: 4,
            lifetimeMin: 4, lifetimeMax: 4, speedMin: 100, speedMax: 100, gravity: { x: 0, y: 0, z: 0 }, damping: 0, simulationSpace: 0,
            collisionEnabled: true, collisionMode: SDF, collisionEvents: true, collisionEventBudget: 8, collisionBounce: 1, collisionFriction: 0, enabled: true,
            playOnStart: true, ...fields,
        } as never);
        // The module's one particle system knows entities by number, and a new world uses the same numbers.
        const particles = app.getResource(Particle);
        particles.reset(e);
        particles.play(e);
        return e;
    };
    const collider = (x: number, fields: Record<string, unknown>, rotation?: { x: number; y: number; z: number; w: number }): Entity => {
        const e = world.spawn();
        world.insert(e, Transform, { position: { x, y: 0, z: 0 }, ...(rotation ? { rotation } : {}) });
        world.insert(e, ParticleCollider, { enabled: true, mask: 65535, ...fields } as never);
        return e;
    };
    /** Runs until the first hit, and hands it back. */
    const firstHit = async (frames = 120): Promise<ParticleCollisionEventPayload | null> => {
        for (let i = 0; i < frames; i++) {
            await app.stepFrames(1, 1 / 60);
            const events = app.getResource(Particle).collisionEvents;
            if (events.length > 0) return events[0]!;
        }
        return null;
    };
    return { app, world, shot, collider, firstHit };
}

describe.skipIf(!HAS_WASM)('a particle against a distance function, on the CPU', () => {
    beforeAll(async () => { engine = await loadWasmModule(); });

    it('bounces off a sphere at its surface', async () => {
        const s = await scene();
        s.collider(50, { shape: 0, radius: 20 });
        s.shot();
        const hit = await s.firstHit();
        expect(hit).not.toBeNull();
        expect(hit!.x).toBeCloseTo(30, 0);
        expect(hit!.normalX).toBeCloseTo(-1, 1);
    });

    it('bounces off a box at its face', async () => {
        const s = await scene();
        s.collider(50, { shape: 1, halfExtents: { x: 10, y: 40, z: 40 } });
        s.shot();
        const hit = await s.firstHit();
        expect(hit!.x).toBeCloseTo(40, 0);
        expect(hit!.normalX).toBeCloseTo(-1, 1);
    });

    it('turns a box with its entity', async () => {
        const s = await scene();
        // Turned 45 degrees about z, its near corner points back along the path: the face it meets leans.
        const half = Math.sin(Math.PI / 8), whole = Math.cos(Math.PI / 8);
        s.collider(60, { shape: 1, halfExtents: { x: 10, y: 100, z: 100 } }, { x: 0, y: 0, z: half, w: whole });
        s.shot();
        const hit = await s.firstHit();
        expect(hit).not.toBeNull();
        expect(hit!.normalX).toBeCloseTo(-Math.SQRT1_2, 1);
        expect(Math.abs(hit!.normalY)).toBeCloseTo(Math.SQRT1_2, 1);
    });

    it('takes a capsule along its up, and rounds its ends', async () => {
        const s = await scene();
        s.collider(50, { shape: 2, radius: 10, halfHeight: 30 });
        s.shot();
        const hit = await s.firstHit();
        expect(hit!.x).toBeCloseTo(40, 0);
        const over = await scene();
        // Past the end of its axis the shape is only its cap, so a path that clears the cap clears the shape.
        const e = over.world.spawn();
        over.world.insert(e, Transform, { position: { x: 50, y: -60, z: 0 } });
        over.world.insert(e, ParticleCollider, { shape: 2, radius: 10, halfHeight: 30, enabled: true, mask: 65535 } as never);
        over.shot();
        expect(await over.firstHit(60)).toBeNull();
    });

    it('keeps it in when inverted', async () => {
        const s = await scene();
        s.collider(0, { shape: 0, radius: 40, inverted: true });
        s.shot();
        const hit = await s.firstHit();
        expect(hit!.x).toBeCloseTo(40, 0);
        expect(hit!.normalX).toBeCloseTo(-1, 1);
    });

    it('passes one that shares no bit of its mask', async () => {
        const s = await scene();
        s.collider(50, { shape: 0, radius: 20, mask: 2 });
        s.shot({ collisionMask: 1 });
        expect(await s.firstHit(60)).toBeNull();
    });

    it('passes one that is switched off', async () => {
        const s = await scene();
        s.collider(50, { shape: 0, radius: 20, enabled: false });
        s.shot();
        expect(await s.firstHit(60)).toBeNull();
    });

    it('does not catch what is already leaving', async () => {
        const s = await scene();
        // Born inside and heading out: the way out is the way it is already going.
        s.collider(0, { shape: 0, radius: 40 });
        s.shot();
        expect(await s.firstHit(30)).toBeNull();
    });

    it('takes a sphere\'s size from its largest scale', async () => {
        const s = await scene();
        const e = s.world.spawn();
        s.world.insert(e, Transform, { position: { x: 50, y: 0, z: 0 }, scale: { x: 1, y: 2, z: 1 } });
        s.world.insert(e, ParticleCollider, { shape: 0, radius: 10, enabled: true, mask: 65535 } as never);
        s.shot();
        const hit = await s.firstHit();
        expect(hit!.x).toBeCloseTo(30, 0);
    });

    it('falls back as it says where a mode needs what the CPU has not got', async () => {
        const s = await scene();
        s.shot({ collisionMode: DEPTH, collisionFallback: 0, collisionFloor: 0, angleSpreadMin: -90, angleSpreadMax: -90 });
        const hit = await s.firstHit();
        expect(hit).not.toBeNull();
        expect(hit!.normalY).toBeCloseTo(1, 1);
        const other = await scene();
        other.shot({ collisionMode: DEPTH, collisionFallback: 1, collisionFloor: 0, angleSpreadMin: -90, angleSpreadMax: -90 });
        expect(await other.firstHit(30)).toBeNull();
    });
});
