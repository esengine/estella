// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../src/app/app';
import { ParticleEmitter, Transform } from '../src/ecs/component';
import { Particle, ParticleAPI, particlePlugin } from '../src/particle';
import { loadComponent, loadSceneData, serializeScene, type SceneData } from '../src/scene/scene';
import type { Entity } from '../src/types';
import type { ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('particle worlds sharing one engine', () => {
    let engine: ESEngineModule;
    const apps: App[] = [];
    beforeAll(async () => { engine = await loadWasmModule(); });
    afterEach(() => { for (const app of apps.splice(0)) app.quit({ keepRenderer: true }); });

    function createApp() {
        const app = App.new();
        apps.push(app);
        const registry = new engine.Registry();
        app.connectCpp(registry, engine, { ownedRegistry: true });
        app.addPlugin(particlePlugin);
        return { app, registry, particles: app.getResource(Particle) };
    }

    function authored(count: number) {
        const fields = {
            colorGradient: { stops: [{ t: 0, color: { r: count / 10, g: 1, b: 0, a: 1 } }] },
            sizeCurve: { keys: [{ time: 0, value: count }] },
            bursts: [{ time: 0.1, count }],
        };
        const scene: SceneData = { version: 4, name: 'effect', entities: [{
            id: 1, name: 'emitter', parent: null, children: [], components: [
                { type: 'Transform', data: {} },
                { type: 'ParticleEmitter', data: { rate: 0, burstCount: 0, maxParticles: 32,
                    duration: 1, looping: false, lifetimeMin: 10, lifetimeMax: 10, ...fields } },
            ],
        }] };
        return { scene, fields };
    }

    it('keeps baked emitter settings independent from imported and saved records', () => {
        const { app } = createApp();
        const emitter = app.world.spawn();
        const { fields } = authored(3);
        loadComponent(app.world, emitter, { type: 'ParticleEmitter', data: { ...fields } });
        fields.colorGradient.stops[0].color.r = 0.8;
        fields.sizeCurve.keys[0].value = 8;
        fields.bursts[0].count = 8;

        const saved = () => serializeScene(app.world).entities[0].components.find(c => c.type === 'ParticleEmitter')!.data as typeof fields;
        expect(saved()).toMatchObject(authored(3).fields);
        const capture = saved();
        capture.colorGradient.stops[0].color.r = 0.9;
        capture.sizeCurve.keys[0].value = 9;
        capture.bursts[0].count = 9;
        expect(saved()).toMatchObject(authored(3).fields);
    });

    it('drops live particles and baked settings when an emitter is replaced on the same entity', async () => {
        const { app, particles } = createApp();
        const entity = loadSceneData(app.world, authored(3).scene).get(1)!;
        for (let frame = 0; frame < 12; frame++) await app.stepFrames(1, 1 / 60);
        expect(particles.getAliveCount(entity)).toBe(3);
        app.world.remove(entity, ParticleEmitter);
        expect(particles.getAliveCount(entity)).toBe(0);
        app.world.insert(entity, ParticleEmitter, { rate: 0, burstCount: 2, playOnStart: true, lifetimeMin: 10, lifetimeMax: 10 });
        const saved = serializeScene(app.world).entities[0].components.find(c => c.type === 'ParticleEmitter')!.data;
        expect(saved).not.toHaveProperty('colorGradient');
        expect(saved).not.toHaveProperty('sizeCurve');
        expect(saved).not.toHaveProperty('bursts');
        for (let frame = 0; frame < 12; frame++) await app.stepFrames(1, 1 / 60);
        expect(particles.getAliveCount(entity)).toBe(2);
    });

    it.each([0, 1])('round-trips each emitter and keeps its peer running when world %i closes', async closed => {
        const worlds = [createApp(), createApp()];
        const emitters = worlds.map((world, index) => {
            const data = authored(index === 0 ? 3 : 7);
            const id = loadSceneData(world.app.world, data.scene).get(1)!;
            return { ...world, id, ...data };
        });
        const [a, b] = emitters;
        expect(a.id).toBe(b.id);
        const counts = () => emitters.map(e => e.particles.getAliveCount(e.id));
        function checkSaved(e: typeof a) {
            const components = serializeScene(e.app.world).entities[0]!.components;
            expect(components.find(c => c.type === 'ParticleEmitter')!.data).toMatchObject(e.fields);
        }
        emitters.forEach(checkSaved);
        for (let frame = 0; frame < 12; ++frame) {
            for (const e of emitters) await e.app.stepFrames(1, 1 / 60);
        }
        expect(counts()).toEqual([3, 7]);
        a.particles.reset(a.id);
        expect(counts()).toEqual([0, 7]);
        expect(a.particles.emitAt(a.id, 2, { x: 0, y: 0, z: 0 })).toBe(2);
        expect(counts()).toEqual([2, 7]);
        const survivor = emitters[1 - closed], retired = emitters[closed];
        retired.app.world.despawn(retired.id);
        retired.app.quit({ keepRenderer: true });
        checkSaved(survivor);
        await survivor.app.stepFrames(1, 1 / 60);
        expect(survivor.particles.getAliveCount(survivor.id)).toBe(closed === 0 ? 7 : 2);

        const next = createApp();
        const reused = next.app.world.spawn();
        expect(reused).toBe(retired.id);
        expect(next.particles.getAliveCount(reused)).toBe(0);
    });

    it('resolves contacts in their originating world when a query steps another world', () => {
        const a = createApp(), b = createApp();
        const [first, second] = [a, b].map(({ app }) => {
            const id = app.world.spawn();
            app.world.insert(id, Transform, {});
            app.world.insert(id, ParticleEmitter, { shape: 0, rate: 0, burstCount: 0, maxParticles: 8,
                lifetimeMin: 2, lifetimeMax: 2, speedMin: 0, speedMax: 0, gravity: { x: 0, y: 0, z: 0 },
                collisionEnabled: true, collisionMode: 2, collisionEvents: true, collisionFallback: 1 });
            return id;
        });
        expect(first).toBe(second);
        const nested = new ParticleAPI(engine, b.registry, () => null);
        let queries = 0;
        const outer = new ParticleAPI(engine, a.registry, query => {
            ++queries;
            nested.update(1 / 60);
            return { body: 42 as Entity, x: query.x, y: query.y, z: query.z, nx: -1, ny: 0, nz: 0 };
        });
        outer.setCollisionBudget({ queries: 2, events: 2 });
        nested.setCollisionBudget({ queries: 0, events: 0 });
        const shot = [first, 2, { x: 0, y: 0, z: 0 }, { velocity: { x: 100, y: 0, z: 0 } }] as const;
        expect(outer.emitAt(...shot)).toBe(2);
        expect(nested.emitAt(...shot)).toBe(2);
        outer.update(1 / 60);
        expect(queries).toBe(2);
        expect(outer.collisionEvents.map(hit => hit.body)).toEqual([42, 42]);
        expect(nested.collisionEvents).toEqual([]);
        expect(nested.collisionStats[0]).toMatchObject({ hits: 0, budgetSkipped: 2 });
    });
});
