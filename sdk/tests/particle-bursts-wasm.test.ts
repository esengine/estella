// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A burst schedule driven through the real core: each burst is born when the emitter's clock reaches its time.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../src/app/app';
import { Transform, ParticleEmitter } from '../src/ecs/component';
import { Particle, ParticlePlugin } from '../src/particle';
import type { ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

let engine: ESEngineModule;
const apps: App[] = [];
afterEach(() => { for (const app of apps.splice(0)) app.quit(); });

describe.skipIf(!HAS_WASM)('a particle burst schedule through the core', () => {
    beforeAll(async () => { engine = await loadWasmModule(); });

    const setup = (looping: boolean) => {
        const app = App.new();
        apps.push(app);
        app.connectCpp(new engine.Registry(), engine, { ownedRegistry: true });
        app.addPlugin(new ParticlePlugin());
        const e = app.world.spawn();
        app.world.insert(e, Transform, {});
        app.world.insert(e, ParticleEmitter, { rate: 0, burstCount: 0, maxParticles: 200, lifetimeMin: 10, lifetimeMax: 10, duration: 1, looping, speedMin: 0, speedMax: 0, gravity: { x: 0, y: 0, z: 0 } });
        return { app, e, particle: app.getResource(Particle) };
    };

    it('releases each burst once its time is reached', async () => {
        const { app, e, particle } = setup(false);
        particle.setBursts(e, [{ time: 0.1, count: 3 }, { time: 0.3, count: 2 }]);
        await app.stepFrames(3, 1 / 60);
        expect(particle.getAliveCount(e)).toBe(0);
        await app.stepFrames(9, 1 / 60);   // 0.2 s: the first burst has passed
        expect(particle.getAliveCount(e)).toBe(3);
        await app.stepFrames(12, 1 / 60);  // 0.4 s: both
        expect(particle.getAliveCount(e)).toBe(5);
        await app.stepFrames(60, 1 / 60);  // a one-shot emitter does not repeat them
        expect(particle.getAliveCount(e)).toBe(5);
    });

    it('repeats the schedule every duration while the emitter loops', async () => {
        const { app, e, particle } = setup(true);
        particle.setBursts(e, [{ time: 0.5, count: 4 }]);
        await app.stepFrames(90, 1 / 60);  // 1.5 s: the 0.5 s burst and the one at 1.5 s
        expect(particle.getAliveCount(e)).toBeGreaterThanOrEqual(4);
        expect(particle.getAliveCount(e)).toBeLessThanOrEqual(8);
        await app.stepFrames(70, 1 / 60);  // 2.67 s: passes at 0.5, 1.5 and 2.5
        expect(particle.getAliveCount(e)).toBe(12);
    });
});
