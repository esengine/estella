// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { bench, describe } from 'vitest';
import { World } from '../src/ecs/world';
import { getComponent, Name, Sprite, Transform } from '../src/ecs/component';
import { resolveChildEntity } from '../src/ecs/childPath';
import { sampleTimeline, type SampleDeps } from '../src/timeline/TimelineEvaluator';
import { InterpType, TrackType, WrapMode, type PropertyTrack, type TimelineAsset } from '../src/timeline/TimelineTypes';
import type { Entity } from '../src/types';
import type { CppRegistry } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from '../tests/helpers/loadWasm';

for (const kind of ['2D sprite', '3D joint']) {
    for (const actorCount of [1, 16]) {
        describe.skipIf(!HAS_WASM)(`${kind}: ${actorCount} actors, 55 descendant tracks each`, () => {
            let world: World, registry: CppRegistry, asset: TimelineAsset;
            let indexed: SampleDeps, walked: SampleDeps;
            const roots: Entity[] = [];
            let frame = 0;

            const setup = async () => {
                roots.length = 0;
                const engine = await loadWasmModule();
                registry = new engine.Registry() as unknown as CppRegistry;
                world = new World();
                world.connectCpp(registry, engine);
                const tracks: PropertyTrack[] = [];
                const parents: number[] = [];
                const paths: string[] = [];
                for (let i = 0; i < 55; i++) {
                    const parent = i < 7 ? i - 1 : (i - 7) % 6 === 0 ? 6 : i - 1;
                    const path = `${parent < 0 ? '' : `${paths[parent]}/`}Node${i}`;
                    parents.push(parent);
                    paths.push(path);
                    tracks.push({ type: TrackType.Property, name: `Track${i}`, childPath: path,
                        component: kind === '2D sprite' ? 'Sprite' : 'Transform', channels: [{
                            property: kind === '2D sprite' ? 'color.a' : 'position.x', keyframes: [
                                { time: 0, value: 0, inTangent: 0, outTangent: 0, interpolation: InterpType.Linear },
                                { time: 1, value: 1, inTangent: 0, outTangent: 0, interpolation: InterpType.Linear },
                            ],
                        }],
                    });
                }
                asset = { version: '1.1', type: 'timeline', duration: 1, wrapMode: WrapMode.Loop, tracks };
                for (let actor = 0; actor < actorCount; actor++) {
                    const root = world.spawn(), nodes: Entity[] = [];
                    roots.push(root);
                    for (let i = 0; i < paths.length; i++) {
                        const entity = world.spawn();
                        nodes.push(entity);
                        world.insert(entity, Name, { value: `Node${i}` });
                        world.insert(entity, Transform);
                        if (kind === '2D sprite') world.insert(entity, Sprite);
                        world.setParent(entity, parents[i] < 0 ? root : nodes[parents[i]]);
                    }
                }
                const unversioned = { tryGet: world.tryGet.bind(world) };
                indexed = { world, getComponent, resolveChild: (root, path) => resolveChildEntity(world, root, path) };
                walked = { world, getComponent, resolveChild: (root, path) => resolveChildEntity(unversioned, root, path) };
                for (const root of roots) sampleTimeline(asset, 0.5, root, indexed);
                const target = resolveChildEntity(world, roots[0], paths[54])!;
                const value = kind === '2D sprite' ? world.get(target, Sprite).color.a : world.get(target, Transform).position.x;
                if (value !== 0.5) throw new Error('Timeline benchmark did not animate its target');
            };

            const teardown = () => {
                for (const root of roots) world.despawn(root);
                world.disconnectCpp();
                (registry as unknown as { delete(): void }).delete();
            };

            const sample = (deps: SampleDeps) => {
                if (roots.length !== actorCount) throw new Error('Timeline benchmark was not populated');
                const time = (frame++ % 60) / 60;
                for (const root of roots) sampleTimeline(asset, time, root, deps);
            };
            bench('walk hierarchy', () => sample(walked), { setup, teardown, time: 500, warmupTime: 100 });
            bench('reuse named children', () => sample(indexed), { setup, teardown, time: 500, warmupTime: 100 });
        });
    }
}
