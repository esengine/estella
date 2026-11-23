// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { World } from '../src/ecs/world';
import { Sprite, Transform, getComponent } from '../src/ecs/component';
import { writeProjection } from '../src/ecs/componentProjection';
import { Pose } from '../src/animation/pose';
import { Animator, AnimatorControllerAPI } from '../src/animation/Animator';
import { TimelineAPI } from '../src/timeline/TimelineControl';
import { sampleTimeline } from '../src/timeline/TimelineEvaluator';
import { parseTimelineAsset } from '../src/timeline/TimelineLoader';
import { createTimelineMotionDriver, TIMELINE_MOTION } from '../src/timeline/timelineMotion';
import { speculate } from '../src/ecs/speculation';
import { ResourceStorage } from '../src/ecs/resource';
import { getDefaultContext } from '../src/ecs/context';
import type { EngineApi } from '../src/ecs/bridge/engineApi';
import type { ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('animation component replacement', () => {
    let engine: ESEngineModule;
    beforeAll(async () => { engine = await loadWasmModule(); });

    function scene(fields: boolean) {
        const world = new World(), registry = new engine.Registry();
        const method = engine as ESEngineModule & Record<string, (...args: unknown[]) => boolean>;
        const transformFields = method.storeTransformFields, spriteFields = method.storeSpriteFields;
        expect(typeof transformFields).toBe('function');
        expect(typeof spriteFields).toBe('function');
        const transform = fields ? vi.fn(transformFields) : vi.spyOn(registry, 'addTransform');
        const sprite = fields ? vi.fn(spriteFields) : vi.spyOn(registry, 'addSprite');
        try {
            Object.assign(method, { storeTransformFields: fields ? transform : undefined, storeSpriteFields: fields ? sprite : undefined });
            world.connectCpp(registry, engine);
        } finally {
            Object.assign(method, { storeTransformFields: transformFields, storeSpriteFields: spriteFields });
        }
        const entity = world.spawn();
        const dispose = () => { world.disconnectCpp(); registry.delete(); };
        return { world, registry, entity, transform, sprite, dispose };
    }

    it('round-trips every scalar and preserves the registry journal of each component on both routes', () => {
        const direct = scene(true), legacy = scene(false);
        const api = engine as EngineApi;
        const paint = {
            ...Sprite._default, texture: 0xf1234567, material: 0xe7654321,
            color: { r: .125, g: .25, b: .5, a: .75 },
            size: { x: 10, y: 11 }, pivot: { x: .25, y: .75 },
            uvOffset: { x: 12, y: 13 }, uvScale: { x: 14, y: 15 },
            tileSize: { x: 16, y: 17 }, tileSpacing: { x: 18, y: 19 }, parallax: { x: 20, y: 21 },
            layer: -7, order: -321, maskInteraction: 2, drawMode: 1,
        };
        const pose = {
            position: { x: 1, y: 2, z: 3 }, rotation: { x: 4, y: 5, z: 6, w: 7 },
            scale: { x: 8, y: 9, z: 10 }, worldPosition: { x: 11, y: 12, z: 13 },
            worldRotation: { x: 14, y: 15, z: 16, w: 17 }, worldScale: { x: 18, y: 19, z: 20 },
        };
        const run = ({ world, registry, entity, transform, sprite }: typeof direct) => {
            const reader = api.registry_watchEntityChanges!(registry);
            const journal = () => api.registry_entityChangeSequence!(registry);
            try {
                world.set(entity, Transform, pose);
                world.set(entity, Sprite, paint);
                const inserted = journal();
                world.set(entity, Transform, pose);
                const moved = journal();
                expect(world.get(entity, Transform)).toEqual(pose);
                for (const flag of ['lit', 'flipX', 'flipY', 'enabled']) {
                    const row = { ...paint, lit: false, flipX: false, flipY: false, enabled: false, [flag]: true };
                    world.set(entity, Sprite, row);
                    expect(world.get(entity, Sprite)).toEqual(row);
                }
                expect(transform).toHaveBeenCalledTimes(2);
                expect(sprite).toHaveBeenCalledTimes(5);
                return [inserted, moved, journal()];
            } finally { api.registry_unwatchEntityChanges!(registry, reader); }
        };
        try {
            const expected = run(legacy);
            expect(expected[1]).toBeGreaterThan(expected[0]);
            expect(run(direct)).toEqual(expected);
            // The first input specifies a new world pose. The next carries the composer's existing output.
            expect(direct.transform.mock.results.map(result => result.value)).toEqual([false, true]);
        } finally { direct.dispose(); legacy.dispose(); }
    });

    it('submits direct timeline and animator output without rebuilding defaults on each track', () => {
        const clip = parseTimelineAsset({
            version: '1.3', type: 'timeline', duration: 2, wrapMode: 'loop',
            tracks: [
                ['Transform', 'scale.z', 3], ['Sprite', 'color.a', 0.25],
            ].map(([component, property, value]) => ({
                type: 'property', name: component, component, childPath: '',
                channels: [{ property, keyframes: [{ time: 0, value, interpolation: 'linear' }] }],
            })),
        });
        const context = getDefaultContext(), previous = context.editorBridge;
        for (const fields of [false, true]) {
            const { world, entity, dispose } = scene(fields);
            const changed = vi.fn();
            world.insert(entity, Transform);
            world.insert(entity, Sprite);
            world.insert(entity, Animator, { controller: 'controller', enabled: true });
            const timeline = new TimelineAPI(), controller = new AnimatorControllerAPI();
            timeline.registerAsset('clip', clip);
            controller.registerMotionDriver(TIMELINE_MOTION, createTimelineMotionDriver(timeline));
            controller.registerController('controller', {
                initialState: 'play', parameters: [],
                states: [{ name: 'play', motion: { kind: TIMELINE_MOTION, clip: 'clip' }, transitions: [] }],
            });
            world.enableChangeSequenceTracking(Transform, false);
            const transformDefaults = vi.spyOn(Transform, '_default', 'get');
            const spriteDefaults = vi.spyOn(Sprite, '_default', 'get');
            context.editorBridge = { registerComponent() {}, onComponentChanged: changed };
            try {
                for (const sample of [
                    () => sampleTimeline(clip, 0.25, entity, { world, getComponent, resolveChild: root => root }),
                    () => controller.update(world, 0.25),
                ]) {
                    const cursor = world.getChangeSequence();
                    sample();
                    expect(world.get(entity, Transform).scale.z).toBe(3);
                    expect(world.get(entity, Sprite).color.a).toBe(0.25);
                    expect(world.isChangedAfterSequence(entity, Transform, cursor)).toBe(true);
                    expect(changed).toHaveBeenCalledWith(entity, 'Transform');
                    expect(changed).toHaveBeenCalledWith(entity, 'Sprite');
                    expect(transformDefaults).toHaveBeenCalledTimes(fields ? 0 : 1);
                    expect(spriteDefaults).toHaveBeenCalledTimes(fields ? 0 : 1);
                    changed.mockClear(); transformDefaults.mockClear(); spriteDefaults.mockClear();
                }
            } finally {
                transformDefaults.mockRestore(); spriteDefaults.mockRestore();
                context.editorBridge = previous; dispose();
            }
        }
    });

    it('preserves authored pose accessors and intercepted writes', () => {
        const { world, entity, dispose } = scene(true);
        try {
            world.insert(entity, Transform);
            const pose = new Pose(), track = pose.track(world, entity, Transform)!;
            const read = vi.fn(() => ({ x: 7, y: 2 }));
            Object.defineProperty(track.data, 'position', { enumerable: true, get: read });
            track.touched.add('position');
            pose.applyTo(world);
            expect(read).toHaveBeenCalledTimes(1);
            expect(world.get(entity, Transform).position).toEqual({ x: 7, y: 2, z: 0 });

            const row = world.get(entity, Transform), observed = vi.spyOn(world, 'set');
            writeProjection(world, entity, Transform, row);
            expect(observed.mock.calls).toEqual([[entity, Transform, row]]);
            observed.mockRestore();

            const get = vi.spyOn(world, 'get');
            read.mockClear();
            writeProjection(world, entity, Transform, track.data as never);
            expect(read).toHaveBeenCalledTimes(1);
            get.mockRestore();
        } finally { dispose(); }
    });

    it('completes partial projections and delegates a rejected computed value exactly once', () => {
        const { world, entity, transform, dispose } = scene(true);
        try {
            world.insert(entity, Transform);
            transform.mockClear();
            writeProjection(world, entity, Transform, { position: { x: 2, y: 3 } } as never);
            expect(world.get(entity, Transform).position).toEqual({ x: 2, y: 3, z: 0 });
            expect(transform).not.toHaveBeenCalled();
            const row = world.get(entity, Transform);
            row.worldPosition.z = 17;
            writeProjection(world, entity, Transform, row);
            expect(transform.mock.results.map(r => r.value)).toEqual([false]);
            expect(world.get(entity, Transform).worldPosition.z).toBe(17);
            speculate({ world, resources: new ResourceStorage() }, () => {
                const edit = world.get(entity, Transform);
                edit.position.x = 18;
                writeProjection(world, entity, Transform, edit);
                expect(world.get(entity, Transform).position.x).toBe(18);
                return 'abandon';
            });
            expect(world.get(entity, Transform)).toEqual(row);
        } finally { dispose(); }
    });

    it('leaves a malformed vector to the object binding and can roll back a later valid write', () => {
        const { world, entity, transform, dispose } = scene(true);
        const state = getDefaultContext().wasmError;
        const previous = state.handler;
        const errors = vi.fn();
        state.handler = errors;
        try {
            world.insert(entity, Transform, { position: { x: 3, y: 4, z: 5 } });
            const original = world.get(entity, Transform);
            world.set(entity, Transform, { ...original, position: 17 } as never);
            expect(errors).toHaveBeenCalledOnce();
            expect(transform).toHaveBeenCalledTimes(1);
            expect(world.get(entity, Transform)).toEqual(original);
            speculate({ world, resources: new ResourceStorage() }, () => {
                world.set(entity, Transform, { ...original, position: { x: -5, y: -4, z: -3 } });
                expect(world.get(entity, Transform).position.x).toBe(-5);
                return 'abandon';
            });
            expect(transform).toHaveBeenCalledTimes(3);
            expect(world.get(entity, Transform)).toEqual(original);
        } finally { state.handler = previous; dispose(); }
    });

    it('completes older input, keeps authored data isolated and publishes the same edit notifications', () => {
        const context = getDefaultContext(), previous = context.editorBridge;
        const added = vi.fn(), changed = vi.fn();
        const { world, entity, transform, dispose } = scene(true);
        context.editorBridge = { registerComponent() {}, onComponentAdded: added, onComponentChanged: changed };
        try {
            world.enableChangeSequenceTracking(Transform, false);
            const input = { position: { x: 4, y: 8 }, scale: { y: 2 } };
            world.set(entity, Transform, input as never);
            const cursor = world.getChangeSequence();
            input.position.x = 9;
            expect(world.get(entity, Transform).position).toEqual({ x: 4, y: 8, z: 0 });
            world.set(entity, Transform, input as never);
            expect(world.get(entity, Transform).scale).toEqual({ x: 1, y: 2, z: 1 });
            expect(world.isChangedAfterSequence(entity, Transform, cursor)).toBe(true);
            expect(added.mock.calls).toEqual([[entity, 'Transform']]);
            expect(changed.mock.calls).toEqual([[entity, 'Transform'], [entity, 'Transform']]);
            expect(transform).toHaveBeenCalledTimes(2);
            expect(input.scale).toEqual({ y: 2 });
        } finally { context.editorBridge = previous; dispose(); }
    });
});
