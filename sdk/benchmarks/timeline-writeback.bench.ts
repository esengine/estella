// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bench, describe } from 'vitest';
import { Animator, AnimatorControllerAPI } from '../src/animation/Animator';
import { Pose } from '../src/animation/pose';
import { getComponent, Name, Transform } from '../src/ecs/component';
import { resolveChildEntity } from '../src/ecs/childPath';
import { World } from '../src/ecs/world';
import { evaluateChannel, sampleTimeline, sampleTimelineIntoPose, type SampleDeps } from '../src/timeline/TimelineEvaluator';
import { TimelineAPI } from '../src/timeline/TimelineControl';
import { parseTimelineAsset } from '../src/timeline/TimelineLoader';
import { createTimelineMotionDriver, TIMELINE_MOTION } from '../src/timeline/timelineMotion';
import { TrackType } from '../src/timeline/TimelineTypes';
import type { Entity } from '../src/types';
import type { CppRegistry } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from '../tests/helpers/loadWasm';

const examples = resolve(dirname(fileURLToPath(import.meta.url)), '../../examples');
const clips = {
    '2D intro': 'cutscene/assets/timelines/intro.estimeline',
    '3D jog': 'character-rig/assets/models/hero_Jog_Fwd_Loop.estimeline',
};

for (const [name, file] of Object.entries(clips)) {
    describe.skipIf(!HAS_WASM)(`authored ${name}, 16 actors`, () => {
        const asset = parseTimelineAsset(JSON.parse(readFileSync(resolve(examples, file), 'utf8')));
        const tracks = asset.tracks.filter(track => track.type === TrackType.Property);
        for (const mode of ['direct', 'pose', 'controller']) {
            let registry: CppRegistry, world: World, frame: number;
            const actors: { root: Entity; pose: Pose }[] = [];
            let bindings: SampleDeps;
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
            bench(mode, () => controller ? controller.update(world, 1 / 60) : sampleAt(asset.duration * ((frame++ * 19) % 61) / 61), {
                time: 500, warmupTime: 100,
                setup: async () => {
                    const engine = await loadWasmModule();
                    registry = new engine.Registry();
                    world = new World();
                    world.connectCpp(registry, engine);
                    bindings = {
                        world, getComponent, resolveChild: (root, path) => resolveChildEntity(world, root, path),
                    };
                    if (mode === 'controller') {
                        const timeline = new TimelineAPI();
                        timeline.registerAsset(file, asset);
                        controller = new AnimatorControllerAPI();
                        controller.registerMotionDriver(TIMELINE_MOTION, createTimelineMotionDriver(timeline));
                        controller.registerController('playback', {
                            initialState: 'play', parameters: [], states: [{
                                name: 'play', motion: { kind: TIMELINE_MOTION, clip: file, loop: true }, transitions: [],
                            }],
                        });
                    }
                    frame = 0;
                    for (let i = 0; i < 16; ++i) {
                        const root = world.spawn();
                        if (controller) world.insert(root, Animator, { controller: 'playback', enabled: true });
                        actors.push({ root, pose: new Pose() });
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
                        }
                    }
                    if (controller) {
                        controller.update(world, 0);
                        controller.update(world, asset.duration / 3);
                    } else sampleAt(asset.duration / 3);
                    const channel = tracks[0].channels.find(c => c.property === 'position.x')!;
                    const expected = evaluateChannel(channel, asset.duration / 3);
                    for (const { root } of actors) {
                        const target = bindings.resolveChild(root, tracks[0].childPath);
                        if (target === null || Math.abs(world.get(target, Transform).position.x - expected) > .0001) {
                            throw new Error('Authored animation did not reach its target');
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
