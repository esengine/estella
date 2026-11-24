// SPDX-License-Identifier: Apache-2.0
import { bench, describe } from 'vitest';
import { MeshRenderer, Sprite, Transform } from '../src/ecs/component';
import { World } from '../src/ecs/world';
import { MeshRendererAPI } from '../src/render/meshRenderer';
import type { Entity } from '../src/types';
import { Interactable } from '../src/ui/input/interactable';
import { uiHitTestWorld } from '../src/ui/util/ui-pick';
import { HAS_WASM, loadWasmModule } from '../tests/helpers/loadWasm';

const ray = { origin: { x: 0, y: 0, z: 100 }, dir: { x: 0, y: 0, z: -1 } };
const quad = { positions: [-5, -5, 5, -5, 5, 5, -5, 5], indices: [0, 1, 2, 0, 2, 3] };
const scenes = [
    { count: 16, hits: 16 }, { count: 256, hits: 256 }, { count: 4096, hits: 4096 },
    { count: 4096, hits: 2 },
];

for (const component of [Sprite, MeshRenderer]) {
    describe.skipIf(!HAS_WASM)(`world-space picking, ${component._name}`, () => {
        for (const { count, hits } of scenes) {
            let world: World, root: Entity, expected: Entity;
            const pick = () => uiHitTestWorld(world, ray);
            const setup = async () => {
                const engine = await loadWasmModule();
                world = new World();
                const registry = new engine.Registry();
                world.connectCpp(registry, engine);
                const meshes = new MeshRendererAPI(engine, registry);
                root = world.spawn();
                world.insert(root, Transform);
                const children = Array.from({ length: count }, (_, i) => {
                    const entity = world.spawn();
                    world.insert(entity, Transform, { position: { x: i < hits ? 0 : 100, y: 0, z: 0 } });
                    world.insert(entity, Interactable);
                    if (component === Sprite) world.insert(entity, Sprite);
                    else {
                        world.insert(entity, MeshRenderer);
                        meshes.setGeometry(entity, quad);
                    }
                    return entity;
                });
                // Sibling order differs from either component pool's iteration order.
                for (let i = 0; i < count; ++i) {
                    const slot = (i * 73) % count;
                    world.setParent(children[slot], root);
                    if (slot < hits) expected = children[slot];
                }
                world.flushEngineStamps();
                world.ensureTransformsComposed();
                if (pick() !== expected) throw new Error('World pick missed the topmost sibling');
            };
            const teardown = () => {
                const registry = world.getCppRegistry();
                world.despawn(root);
                world.disconnectCpp();
                registry?.delete();
            };
            bench(`${hits} hits among ${count} siblings`, () => { pick(); },
                { setup, teardown, time: 350, warmupTime: 100 });
        }
    });
}
