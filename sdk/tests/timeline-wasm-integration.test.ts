// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Integration tests: Timeline property animation applied to real WASM-backed components.
 *
 * Requires pre-built WASM at build/wasm/web/esengine.wasm.
 * Run `node build-tools/cli.js build -t web` first if missing.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { World } from '../src/ecs/world';
import { Transform, defineComponent, getComponent, unregisterComponent } from '../src/ecs/component';
import type { ESEngineModule, CppRegistry } from '../src/wasm';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';
import {
    WrapMode,
    TrackType,
    type TimelineAsset,
    type PropertyTrack,
} from '../src/timeline/TimelineTypes';
import { setNestedProperty } from '../src/timeline/TimelinePlugin';
import { createRootPlacement, sampleRootPlacement, sampleTimelineInWorld } from '../src/timeline/TimelineEvaluator';
import { parseTimelineAsset } from '../src/timeline/TimelineLoader';

describe.skipIf(!HAS_WASM)('Timeline WASM Integration', () => {
    let module: ESEngineModule;

    beforeAll(async () => {
        module = await loadWasmModule();
    });

    function createWorld(): { world: World; registry: CppRegistry } {
        const registry = new module.Registry() as unknown as CppRegistry;
        const world = new World();
        world.connectCpp(registry, module);
        return { world, registry };
    }

    function disposeWorld(world: World, registry: CppRegistry): void {
        for (const e of world.getAllEntities()) {
            try { world.despawn(e); } catch (_) {}
        }
        world.disconnectCpp();
        (registry as any).delete();
    }

    describe('world.set updates C++ Transform', () => {
        it('should update position.x via world.set', () => {
            const { world, registry } = createWorld();
            const entity = world.spawn();
            world.insert(entity, Transform);

            const before = world.get(entity, Transform);
            expect(before.position.x).toBe(0);

            const data = world.get(entity, Transform);
            data.position.x = 42;
            world.set(entity, Transform, data);

            const after = world.get(entity, Transform);
            expect(after.position.x).toBeCloseTo(42, 5);

            disposeWorld(world, registry);
        });

        it('should update position via setNestedProperty + world.set', () => {
            const { world, registry } = createWorld();
            const entity = world.spawn();
            world.insert(entity, Transform);

            const data = world.get(entity, Transform) as Record<string, any>;
            setNestedProperty(data, 'position.x', 99);
            setNestedProperty(data, 'position.y', 55);
            world.set(entity, Transform, data as any);

            const after = world.get(entity, Transform);
            expect(after.position.x).toBeCloseTo(99, 5);
            expect(after.position.y).toBeCloseTo(55, 5);

            disposeWorld(world, registry);
        });

        it('should update position via world.insert on existing component', () => {
            const { world, registry } = createWorld();
            const entity = world.spawn();
            world.insert(entity, Transform);

            const data = world.get(entity, Transform) as Record<string, any>;
            setNestedProperty(data, 'position.x', 77);
            world.insert(entity, Transform, data as any);

            const after = world.get(entity, Transform);
            expect(after.position.x).toBeCloseTo(77, 5);

            disposeWorld(world, registry);
        });
    });

    it('reuses a channel across actors and root motion and picks the writer for the current component', () => {
        const { world, registry } = createWorld();
        const probe = defineComponent('TimelineFieldProbe', { rotation: { angle: 0 }, flags: { visible: true } });
        try {
            const actors = [world.spawn(), world.spawn()];
            for (const actor of actors) {
                world.insert(actor, Transform);
                world.insert(actor, probe);
            }
            const key = { time: 0, value: Math.PI / 2, inTangent: 0, outTangent: 0 };
            const channel = { property: 'rotation.angle', keyframes: [key] };
            const track: PropertyTrack = {
                type: TrackType.Property, name: 'Spin', childPath: '', component: 'Transform', channels: [channel],
            };
            const asset: TimelineAsset = {
                version: '1.1', type: 'timeline', duration: 1, wrapMode: WrapMode.Once,
                tracks: [track, { ...track, component: probe._name }],
            };
            const root = createRootPlacement();
            sampleTimelineInWorld(asset, 0, world, actors[0]);
            const split = vi.spyOn(String.prototype, 'split');
            let parsed: string[];
            try {
                for (const actor of actors) {
                    track.channels[0] = { ...channel };
                    sampleTimelineInWorld(asset, 0, world, actor);
                    const reloaded = parseTimelineAsset(asset);
                    sampleTimelineInWorld(reloaded, 0, world, actor);
                    sampleRootPlacement(reloaded, 0, root);
                }
                sampleRootPlacement(asset, 0, root);
                parsed = split.mock.contexts.map(String);
            } finally { split.mockRestore(); }
            track.channels[0] = channel;
            expect(parsed).not.toContain('rotation.angle');
            expect(root.rotation.z).toBeCloseTo(Math.SQRT1_2);
            for (const actor of actors) {
                expect(world.get(actor, Transform).rotation.z).toBeCloseTo(Math.SQRT1_2);
                expect(world.get(actor, probe).rotation.angle).toBe(key.value);
            }

            channel.property = 'flags.visible';
            key.value = 0;
            sampleTimelineInWorld(asset, 0, world, actors[0]);
            expect(world.get(actors[0], probe).flags.visible).toBe(false);
            expect(world.get(actors[1], probe).flags.visible).toBe(true);
            expect(sampleRootPlacement(asset, 0, root)).toBe(false);

            channel.property = 'position.x';
            Object.freeze(channel);
            key.value = 7;
            expect(sampleRootPlacement(asset, 0, root)).toBe(true);
            expect(root.position.x).toBe(7);
            sampleTimelineInWorld(asset, 0, world, actors[1]);
            expect(world.get(actors[1], Transform).position.x).toBe(7);
        } finally {
            disposeWorld(world, registry);
            unregisterComponent(probe._name);
        }
    });

    describe('getComponent resolves Transform', () => {
        it('should return Transform def from getComponent("Transform")', () => {
            const def = getComponent('Transform');
            expect(def).toBeDefined();
            expect(def!._name).toBe('Transform');
        });
    });
});
