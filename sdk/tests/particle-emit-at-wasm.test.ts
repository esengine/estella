// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Particle.emitAt through the real core: a burst where something happened, now, from an emitter that is neither
 *        moved nor replayed — Saltline's bullet impacts were a pool of emitters dragged to each hit and restarted.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../src/app/app';
import { Transform, ParticleEmitter } from '../src/ecs/component';
import { Particle, ParticlePlugin } from '../src/particle';
import { ParticleCollisionEvent, type ParticleCollisionEventPayload } from '../src/particle/collision';
import { EventReader, type EventReaderInstance } from '../src/ecs/event';
import { defineSystem, Schedule } from '../src/ecs/system';
import { Physics3DPlugin, Physics3DRuntime } from '../src/physics3d/Physics3DPlugin';
import { RigidBody3D, BoxCollider3D } from '../src/physics3d/Physics3DComponents';
import type { Physics3DWasmModule } from '../src/physics3d/Physics3DModule';
import type { ESEngineModule } from '../src/wasm';
import { HAS_WASM, hasSideModule, loadSideModule, loadWasmModule } from './helpers/loadWasm';

let engine: ESEngineModule;
const apps: App[] = [];
afterEach(() => { for (const app of apps.splice(0)) app.quit(); });

describe.skipIf(!HAS_WASM)('Particle.emitAt through the core', () => {
    beforeAll(async () => { engine = await loadWasmModule(); });

    const quiet = { rate: 0, burstCount: 0, playOnStart: false, looping: false, lifetimeMin: 5, lifetimeMax: 5, speedMin: 0, speedMax: 0, gravity: { x: 0, y: 0, z: 0 } };

    it('spawns what it is asked for at once, from an emitter that never plays, and no more than its pool', async () => {
        const app = App.new(); apps.push(app);
        app.connectCpp(new engine.Registry(), engine, { ownedRegistry: true });
        app.addPlugin(new ParticlePlugin());
        const e = app.world.spawn();
        app.world.insert(e, Transform, {});
        app.world.insert(e, ParticleEmitter, { ...quiet, maxParticles: 10 });
        await app.stepFrames(2, 1 / 60);
        const particle = app.getResource(Particle);
        expect(particle.getAliveCount(e)).toBe(0);
        expect(particle.emitAt(e, 6, { x: 3, y: 0, z: 0 })).toBe(6);
        await app.stepFrames(1, 1 / 60);
        expect(particle.getAliveCount(e)).toBe(6);
        expect(particle.emitAt(e, 6, { x: -3, y: 0, z: 0 })).toBe(4);   // the pool holds 10
        await app.stepFrames(30, 1 / 60);
        expect(particle.getAliveCount(e)).toBe(10);                    // they live their lifetime
    });

    // Where they start, read off where they hit: the emitter stands at the origin with no speed of its own, so a particle
    // that reaches a wall at x 100 started where emitAt put it and moved as emitAt aimed it.
    it.skipIf(!hasSideModule('physics3d'))('starts them at the point, aimed along the normal and carried by the velocity', async () => {
        const app = App.new(); apps.push(app);
        app.connectCpp(new engine.Registry(), engine, { ownedRegistry: true });
        const module = await loadSideModule<Physics3DWasmModule>('physics3d');
        app.addPlugin(new Physics3DPlugin('', { gravity: { x: 0, y: 0, z: 0 } }, async () => module));
        await app.getResource(Physics3DRuntime).initPromise;
        app.addPlugin(new ParticlePlugin());
        const world = app.world;
        const wall = world.spawn();
        world.insert(wall, Transform, { position: { x: 100, y: 0, z: 0 } });
        world.insert(wall, RigidBody3D, { bodyType: 0 });
        world.insert(wall, BoxCollider3D, { halfExtents: { x: 5, y: 200, z: 200 } });
        const received: ParticleCollisionEventPayload[] = [];
        app.addSystemToSchedule(Schedule.Update, defineSystem([EventReader(ParticleCollisionEvent)],
            (reader: EventReaderInstance<ParticleCollisionEventPayload>) => { for (const hit of reader) received.push(hit); }, { name: 'ReadHits' }));
        const e = world.spawn();
        world.insert(e, Transform, {});
        // A cone of no width along its own +Y, 3000 units/s: emitAt turns that +Y onto the normal (+X here).
        world.insert(e, ParticleEmitter, { ...quiet, shape: 3, shapeAngle: 0, shapeRadius: 0, speedMin: 3000, speedMax: 3000, maxParticles: 4,
            collisionEnabled: true, collisionMode: 2, collisionFallback: 1, collisionEvents: true, collisionMask: 65535 });
        await app.stepFrames(2, 1 / 60);
        app.getResource(Particle).emitAt(e, 1, { x: 60, y: 7, z: 0 }, { normal: { x: 1, y: 0, z: 0 } });
        await app.stepFrames(3, 1 / 60);
        const hit = received.find((h) => h.emitter === e);
        expect(hit).toBeDefined();
        expect(hit!.body).toBe(wall);
        expect(hit!.x).toBeCloseTo(95, 1);   // the wall's near face
        expect(hit!.y).toBeCloseTo(7, 1);    // the height it was emitted at
        expect(hit!.velocityX).toBeCloseTo(3000, 0);
    });
});
