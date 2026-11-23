// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Integration tests: Timeline property animation applied to real WASM-backed components.
 *
 * Requires pre-built WASM at build/wasm/web/esengine.wasm.
 * Run `node build-tools/cli.js build -t web` first if missing.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Session } from 'node:inspector';
import { setImmediate } from 'node:timers/promises';
import { Animator, AnimatorControllerAPI } from '../src/animation/Animator';
import { resolveChildEntity } from '../src/ecs/childPath';
import { TimelineAPI } from '../src/timeline/TimelineControl';
import { createTimelineMotionDriver, TIMELINE_MOTION } from '../src/timeline/timelineMotion';
import { World } from '../src/ecs/world';
import { Transform, defineComponent, getComponent, unregisterComponent } from '../src/ecs/component';
import type { Entity } from '../src/types';
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
import { sampleAnimationTracks } from '../src/timeline/timelineAnimation';

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

    it('keeps untouched script fields in their own world when timelines alternate', () => {
        const probe = defineComponent('TimelineWorldProbe', { value: 0, samples: [] as number[] });
        const worlds = [createWorld(), createWorld()];
        try {
            const layer = parseTimelineAsset({ type: 'timeline', version: '1.3', duration: 1, tracks: [{
                type: 'animation', clips: [{ start: 0, duration: 1, clip: 'motion' }],
            }] });
            const scenes = worlds.map(({ world }, index) => {
                const actor = world.spawn();
                world.insert(actor, probe, { samples: [index] });
                const motion = parseTimelineAsset({ type: 'timeline', version: '1.3', duration: 1, tracks: [{
                    type: 'property', component: probe._name,
                    channels: [{ property: 'value', keyframes: [{ time: 0, value: index + 10 }] }],
                }] });
                return { world, actor, motion };
            });
            expect(scenes[0]!.actor).toBe(scenes[1]!.actor);
            for (const { world, actor, motion } of [...scenes, ...scenes.slice().reverse()]) {
                sampleAnimationTracks(layer, 0.5, actor, { world, getComponent, resolveChild: root => root }, () => motion);
                scenes.forEach((s, index) => expect(s.world.get(s.actor, probe).samples).toEqual([index]));
            }
            scenes.forEach((s, index) => expect(s.world.get(s.actor, probe).value).toBe(index + 10));
        } finally {
            for (const { world, registry } of worlds) disposeWorld(world, registry);
            unregisterComponent(probe._name);
        }
    });

    it.each(['timeline', 'controller', 'blend'])('releases despawned joint data while the %s keeps playing', async mode => {
        const { world, registry } = createWorld();
        const probe = defineComponent('PoseLifetimeProbe', { value: 0, samples: [] as number[] });
        try {
            const root = world.spawn(), survivor = world.spawn('Stay');
            world.setParent(survivor, root);
            world.insert(survivor, probe, { value: 10 });
            const names = Array.from({ length: 32 }, (_, i) => 'Joint' + i);
            const motion = parseTimelineAsset({ type: 'timeline', version: '1.3', duration: 1,
                tracks: ['Stay', ...names.map(name => 'Part/' + name)].map(childPath => ({ type: 'property', childPath, component: probe._name,
                    channels: [{ property: 'value', keyframes: [{ time: 0, value: 40 }] }],
                })),
            });
            const layer = parseTimelineAsset({ type: 'timeline', version: '1.3', duration: 1, tracks: [{
                type: 'animation', weight: .5, clips: [{ start: 0, duration: 1, clip: 'cue' }],
            }] });
            const deps = { world, getComponent, resolveChild: (entity: Entity, path: string) => resolveChildEntity(world, entity, path) };
            const controllers = new AnimatorControllerAPI();
            if (mode !== 'timeline') {
                const timelines = new TimelineAPI();
                timelines.registerAsset('cue', motion);
                controllers.registerMotionDriver(TIMELINE_MOTION, createTimelineMotionDriver(timelines));
                const clip = { kind: TIMELINE_MOTION, clip: 'cue' };
                controllers.registerController('play', { initialState: 'step', parameters: [], states: [{
                    name: 'step', transitions: [], motion: mode === 'controller' ? clip : {
                        kind: 'blend1d', parameter: 'mix', thresholds: [{ value: 0, motion: clip }, { value: 1, motion: clip }],
                    },
                }] });
                controllers.setFloat(root, 'mix', .5);
                world.insert(root, Animator, { controller: 'play', enabled: true });
            }
            const sample = () => mode === 'timeline'
                ? sampleAnimationTracks(layer, .5, root, deps, () => motion)
                : controllers.update(world);
            const replacePart = (wave: number) => {
                const part = world.spawn('Part');
                world.setParent(part, root);
                const joints = names.map((name, i) => {
                    const joint = world.spawn(name), value = wave + i;
                    world.setParent(joint, part);
                    const data = world.insert(joint, probe, { value, samples: Array<number>(8192).fill(value + .25) });
                    return { joint, value, marker: new WeakRef(data.samples) };
                });
                sample();
                for (const { joint, value } of joints) {
                    expect(world.get(joint, probe).value).toBe(mode === 'timeline' ? (value + 40) / 2 : 40);
                }
                // A later teardown listener can still sample the joint. It must not reattach the retired data.
                const off = world.onDespawn(entity => { if (entity === joints[0]!.joint) sample(); });
                try { world.despawn(part); } finally { off(); }
                return joints.map(joint => joint.marker);
            };
            const listeners = world.getStorageSizes();
            const retired = Array.from({ length: 8 }, (_, wave) => replacePart(wave)).flat();
            // WeakRef keeps its target until this JS job ends. Collect in the test worker's own isolate.
            await setImmediate();
            const session = new Session();
            session.connect();
            try {
                await new Promise<void>((resolve, reject) => session.post('HeapProfiler.collectGarbage', err => err ? reject(err) : resolve()));
            } finally { session.disconnect(); }
            expect(retired.filter(ref => ref.deref() !== undefined)).toHaveLength(0);
            sample();
            expect(world.get(survivor, probe).value).toBe(mode === 'timeline' ? 25 : 40);
            world.despawn(root);
            expect(world.getStorageSizes()).toMatchObject({
                despawnCallbacks: listeners.despawnCallbacks, coreDisconnectCallbacks: listeners.coreDisconnectCallbacks,
            });
        } finally {
            disposeWorld(world, registry);
            unregisterComponent(probe._name);
        }
    });

    it('skips a joint retired by another joint’s write in the same evaluation', () => {
        const { world, registry } = createWorld();
        const probe = defineComponent('RetiredDuringPose', { value: 0 });
        try {
            const root = world.spawn(), first = world.spawn('First'), last = world.spawn('Last');
            for (const joint of [first, last]) {
                world.setParent(joint, root);
                world.insert(joint, probe);
            }
            const motion = parseTimelineAsset({ type: 'timeline', version: '1.3', duration: 1,
                tracks: ['First', 'Last'].map(childPath => ({ type: 'property', childPath, component: probe._name,
                    channels: [{ property: 'value', keyframes: [{ time: 0, value: 7 }] }],
                })),
            });
            const take = parseTimelineAsset({ type: 'timeline', version: '1.3', duration: 1, tracks: [{
                type: 'animation', clips: [{ start: 0, duration: 1, clip: 'motion' }],
            }] });
            const store = world.set.bind(world);
            const write = vi.spyOn(world, 'set').mockImplementation((entity, def, data) => {
                store(entity, def, data);
                if (entity === first && def === probe) world.despawn(last);
            });
            try {
                sampleAnimationTracks(take, .5, root, {
                    world, getComponent, resolveChild: (e, path) => resolveChildEntity(world, e, path),
                }, () => motion);
            } finally { write.mockRestore(); }
            expect(world.get(first, probe).value).toBe(7);
            expect(world.valid(last)).toBe(false);
            expect(world.has(last, probe)).toBe(false);
        } finally {
            disposeWorld(world, registry);
            unregisterComponent(probe._name);
        }
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
