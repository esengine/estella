// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bench, describe } from 'vitest';
import { Animator, AnimatorControllerAPI, type AnimatorControllerDef } from '../src/animation/Animator';
import { Pose } from '../src/animation/pose';
import { getComponent, Name, Sprite, Transform } from '../src/ecs/component';
import { resolveChildEntity } from '../src/ecs/childPath';
import { World } from '../src/ecs/world';
import { linearKey } from '../src/math/keyframes';
import { q } from '../src/math/quat';
import { v3 } from '../src/math/vec3';
import {
    createRootPlacement, evaluateChannel, sampleRootPlacement, sampleTimeline, sampleTimelineIntoPose, type SampleDeps,
} from '../src/timeline/TimelineEvaluator';
import { TimelineAPI } from '../src/timeline/TimelineControl';
import { parseTimelineAsset } from '../src/timeline/TimelineLoader';
import { createTimelineMotionDriver, TIMELINE_MOTION } from '../src/timeline/timelineMotion';
import { TrackType } from '../src/timeline/TimelineTypes';
import type { Entity } from '../src/types';
import type { CppRegistry } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from '../tests/helpers/loadWasm';

const examples = resolve(dirname(fileURLToPath(import.meta.url)), '../../examples');
const exampleText = (file: string) => readFileSync(resolve(examples, file), 'utf8');
const example = (file: string) => parseTimelineAsset(exampleText(file));

function spriteHierarchy() {
    const paths: string[] = [];
    const tips: string[] = [];
    const extend = (parent: string) => {
        const path = (parent ? parent + '/' : '') + 'Node' + paths.length;
        paths.push(path);
        return path;
    };
    let trunk = '';
    for (let i = 0; i < 7; i++) trunk = extend(trunk);
    for (let branch = 0; branch < 8; branch++) {
        let tip = trunk;
        for (let i = 0; i < 6; i++) tip = extend(tip);
        tips.push(tip);
    }
    return { paths, tips };
}

const sprites = spriteHierarchy();
const aimTarget = { x: 50, y: 45, z: 10 };

function spriteFades(withMovement = false, reverse = false) {
    const targets = [{ component: 'Sprite', property: 'color.a' }];
    if (withMovement) targets.push({ component: 'Transform', property: 'position.x' });
    return parseTimelineAsset({
        version: '1.3', type: 'timeline', duration: 1, wrapMode: 'loop',
        tracks: sprites.paths.flatMap((childPath, index) => targets.map(({ component, property }) => ({
            type: 'property', name: component + index, childPath, component,
            channels: [{ property, keyframes: [0, 1].map(time => ({
                time, value: reverse ? 1 - time : time, inTangent: 0, outTangent: 0, interpolation: 'linear',
            })) }],
        }))),
    });
}

const sampleModes = ['direct', 'pose', 'controller', 'reload'];
const clips = [
    { name: 'authored 2D intro', load: () => example('cutscene/assets/timelines/intro.estimeline'), modes: sampleModes },
    { name: 'authored 3D jog', load: () => example('character-rig/assets/models/hero_Jog_Fwd_Loop.estimeline'), modes: sampleModes },
    { name: '2D sprite fades', load: spriteFades, modes: sampleModes },
    { name: 'moving and fading sprites', load: () => spriteFades(true), modes: ['additive', 'blend', 'look-at'] },
];

function playback(clip: string, mode: string): AnimatorControllerDef {
    const motion = { kind: TIMELINE_MOTION, clip, loop: true };
    const state = { name: 'play', motion, transitions: [] };
    const def: AnimatorControllerDef = { initialState: 'play', parameters: [], states: [state] };
    const reverse = { ...motion, clip: 'reverse' };
    if (mode === 'blend') {
        def.parameters.push({ name: 'mix', type: 'float', default: .25 });
        def.states[0].motion = { kind: 'blend1d', parameter: 'mix', thresholds: [
            { value: 0, motion }, { value: 1, motion: reverse },
        ] };
    } else if (mode === 'additive') {
        def.layers = [{ name: 'reverse', weight: .25, blend: 'additive',
            initialState: 'play', states: [{ ...state, motion: reverse }] }];
    } else if (mode === 'look-at') {
        def.ik = sprites.tips.map(tip => ({ kind: 'look-at', tip, target: 'AimTarget', axis: 'z' }));
    }
    return def;
}

describe('load an authored timeline', () => {
    for (const [name, file] of [
        ['2D cutscene', 'cutscene/assets/timelines/intro.estimeline'],
        ['3D jog', 'character-rig/assets/models/hero_Jog_Fwd_Loop.estimeline'],
    ]) {
        const text = exampleText(file);
        bench(`${name} from file text`, () => { parseTimelineAsset(text); }, { time: 500, warmupTime: 100 });
        bench(`${name} through a caller-owned document`, () => {
            parseTimelineAsset(JSON.parse(text));
        }, { time: 500, warmupTime: 100 });
    }
});

describe('seek a joint curve for 16 actors', () => {
    const clip = example('character-rig/assets/models/hero_Jog_Fwd_Loop.estimeline');
    const rotations = clip.tracks.flatMap(track => track.type === TrackType.Property
        ? track.channels.filter(channel => channel.property === 'rotation.y') : []);
    const authored = rotations.sort((a, b) => b.keyframes.length - a.keyframes.length)[0];
    if (!authored) throw new Error('Jog clip has no joint rotation channel');
    // A baked capture keeps a key at every sample. Resample the checked-in motion
    // so both densities can be replayed without downloading a model.
    const dense = Array.from({ length: 1309 }, (_, i) => {
        const time = i / 37.5;
        return linearKey(time, evaluateChannel(authored, time % clip.duration));
    });
    for (const keyframes of [authored.keyframes, dense]) {
        const channel = { ...authored, keyframes };
        const duration = keyframes[keyframes.length - 1].time;
        const values = new Float64Array(16);
        let frame = 0;
        bench(`${keyframes.length} keys`, () => {
            frame = (frame + 19) % 113;
            for (let actor = 0; actor < values.length; actor++) {
                const phase = ((frame + actor * 7) % 113 + 0.25) / 113;
                values[actor] = evaluateChannel(channel, duration * phase);
            }
        }, { time: 500, warmupTime: 100 });
    }
});

describe('authored dodge root motion, 16 actors', () => {
    for (const edit of [false, true]) {
        const asset = example('third-person-3d/assets/models/dodge.estimeline');
        const channel = asset.tracks.flatMap(track =>
            track.type === TrackType.Property && track.component === 'Transform' && track.childPath === ''
                ? track.channels : [],
        ).find(channel => channel.property === 'position.z');
        if (!channel) throw new Error('Missing dodge root translation channel');
        const placements = Array.from({ length: 16 }, createRootPlacement);
        let frame = 0;
        bench(edit ? 'retarget the curve before each sample' : 'sample the same curve', () => {
            if (edit) channel.property = frame % 2 === 0 ? 'position.x' : 'position.z';
            const time = asset.duration * ((frame++ * 19) % 61) / 61;
            for (const out of placements) sampleRootPlacement(asset, time, out);
        }, {
            time: 500, warmupTime: 100,
            setup: () => {
                frame = 0;
                const time = asset.duration / 2;
                const expected = evaluateChannel(channel, time);
                for (const axis of ['x', 'z'] as const) {
                    channel.property = `position.${axis}`;
                    const out = placements[0];
                    if (!sampleRootPlacement(asset, time, out) || out.position[axis] !== expected) {
                        throw new Error('Dodge root motion missed the edited axis');
                    }
                }
            },
        });
    }
});

for (const { name, load, modes } of clips) {
    describe.skipIf(!HAS_WASM)(`${name}, 16 actors`, () => {
        const asset = load();
        const tracks = asset.tracks.filter(track => track.type === TrackType.Property);
        for (const mode of modes) {
            const reload = mode === 'reload';
            const composed = mode === 'additive' || mode === 'blend';
            let registry: CppRegistry, world: World, frame: number;
            const actors: { root: Entity; pose: Pose }[] = [];
            let bindings: SampleDeps;
            let timeline: TimelineAPI;
            let controller: AnimatorControllerAPI | undefined;
            const sampleAt = (time: number) => {
                for (const { root, pose } of actors) {
                    if (mode === 'direct') sampleTimeline(asset, time, root, bindings);
                    else {
                        pose.reset();
                        sampleTimelineIntoPose(asset, time, root, bindings, pose);
                        pose.applyEvaluatedTo(world);
                    }
                }
            };
            bench(reload ? 'reload clip and update controller' : mode, () => {
                if (!controller) return sampleAt(asset.duration * ((frame++ * 19) % 61) / 61);
                if (reload) timeline.registerAsset(name, parseTimelineAsset(asset));
                controller.update(world, 1 / 60);
            }, {
                time: 500, warmupTime: 100,
                setup: async () => {
                    const engine = await loadWasmModule();
                    registry = new engine.Registry();
                    world = new World();
                    world.connectCpp(registry, engine);
                    bindings = {
                        world, getComponent, resolveChild: (root, path) => resolveChildEntity(world, root, path),
                    };
                    if (mode !== 'direct' && mode !== 'pose') {
                        timeline = new TimelineAPI();
                        timeline.registerAsset(name, reload ? parseTimelineAsset(asset) : asset);
                        if (composed) timeline.registerAsset('reverse', spriteFades(true, true));
                        controller = new AnimatorControllerAPI();
                        controller.registerMotionDriver(TIMELINE_MOTION, createTimelineMotionDriver(timeline));
                        controller.registerController('playback', playback(name, mode));
                    }
                    frame = 0;
                    for (let i = 0; i < 16; ++i) {
                        const root = world.spawn();
                        if (controller) world.insert(root, Animator, { controller: 'playback', enabled: true });
                        actors.push({ root, pose: new Pose() });
                        if (mode === 'look-at') {
                            const target = world.spawn('AimTarget');
                            world.insert(target, Transform, { position: aimTarget });
                            world.setParent(target, root);
                        }
                        const nodes = new Map([['', root]]);
                        for (const track of tracks) {
                            let parent = root, path = '';
                            for (const part of track.childPath.split('/').filter(Boolean)) {
                                path = path ? `${path}/${part}` : part;
                                let child = nodes.get(path);
                                if (child === undefined) {
                                    child = world.spawn();
                                    world.insert(child, Name, { value: part });
                                    world.insert(child, Transform);
                                    world.setParent(child, parent);
                                    nodes.set(path, child);
                                }
                                parent = child;
                            }
                            if (track.component === 'Sprite') world.insert(parent, Sprite);
                        }
                    }
                    if (controller) {
                        controller.update(world, 0);
                        controller.update(world, asset.duration / 3);
                    } else sampleAt(asset.duration / 3);
                    if (mode === 'look-at') {
                        world.ensureTransformsComposed();
                        for (const { root } of actors) for (const path of sprites.tips) {
                            const joint = bindings.resolveChild(root, path);
                            if (joint === null) throw new Error('Missing look-at joint: ' + path);
                            const { worldPosition, worldRotation } = world.get(joint, Transform);
                            const direction = v3.normalize(v3.sub(aimTarget, worldPosition));
                            const facing = q.rotate(worldRotation, { x: 0, y: 0, z: 1 });
                            if (!v3.equals(facing, direction, .0001)) throw new Error('Incorrect joint orientation: ' + path);
                        }
                    }
                    for (const track of tracks[0].component === 'Sprite' ? tracks : [tracks[0]]) {
                        const tint = track.component === 'Sprite';
                        const channel = track.channels.find(c => c.property === (tint ? 'color.a' : 'position.x'))!;
                        const base = evaluateChannel(channel, asset.duration / 3);
                        let expected = base;
                        if (mode === 'additive') expected = base - .25 * base;
                        if (mode === 'blend') expected = .75 * base + .25 * (1 - base);
                        for (const { root } of actors) {
                            const target = bindings.resolveChild(root, track.childPath);
                            if (target === null) throw new Error('Missing animation target: ' + track.childPath);
                            const value = tint ? world.get(target, Sprite).color.a : world.get(target, Transform).position.x;
                            if (!Number.isFinite(value) || Math.abs(value - expected) > .0001) throw new Error('Incorrect animated value: ' + track.childPath);
                        }
                    }
                },
                teardown: () => {
                    for (const { root } of actors.splice(0)) world.despawn(root);
                    world.disconnectCpp();
                    registry.delete();
                },
            });
        }
    });
}
