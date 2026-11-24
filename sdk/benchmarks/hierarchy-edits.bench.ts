// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Run against either build with ESENGINE_WASM_DIR=/path/to/core pnpm --filter ./sdk exec vitest bench --run hierarchy-edits.
import { bench, describe } from 'vitest';
import { Transform } from '../src/ecs/component';
import { World } from '../src/ecs/world';
import { loadSceneData, SCENE_FORMAT_VERSION, type SceneData } from '../src/scene/scene';
import type { Entity } from '../src/types';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from '../tests/helpers/loadWasm';

describe.skipIf(!HAS_WASM)('Scene hierarchy edits through the runtime API', () => {
    let core: ESEngineModule;
    for (const type of ['Sprite', 'MeshRenderer']) {
        for (const depth of [20, 2048]) {
            // Same component count and document order. Only the number of links per tree changes.
            const scene: SceneData = { version: SCENE_FORMAT_VERSION, name: type, entities: [] };
            for (let i = 0; i < 2048; i++) {
                const parent = i % depth === 0 ? null : i - 1;
                scene.entities.push({
                    id: i + 1, name: `Node ${i}`, parent: parent === null ? null : parent + 1, children: [],
                    components: [{ type: 'Transform', data: {} }, { type, data: {} }],
                });
                if (parent !== null) scene.entities[parent].children.push(i + 1);
            }
            bench(`load 2048 ${type} nodes, depth ${depth}`, () => {
                const world = new World(), registry = new core.Registry();
                world.connectCpp(registry, core);
                try {
                    const loaded = loadSceneData(world, scene);
                    const leaf = loaded.get(scene.entities.length);
                    if (loaded.size !== scene.entities.length || leaf === undefined) throw new Error('incomplete scene');
                    const rendered = type === 'Sprite' ? registry.hasSprite(leaf) : registry.hasMeshRenderer(leaf);
                    if (!rendered || !registry.hasParent(leaf)) throw new Error('missing render component or parent');
                } finally {
                    world.disconnectCpp();
                    registry.delete();
                }
            }, { setup: async () => { core = await loadWasmModule(); }, time: 350, warmupTime: 100 });
        }
    }

    for (const depth of [32, 4096]) {
        let world: World, registry: CppRegistry, leaf: Entity;
        const nodes: Entity[] = [];
        const setup = async () => {
            core = await loadWasmModule();
            registry = new core.Registry();
            world = new World();
            world.connectCpp(registry, core);
            nodes.length = 0;
            for (let i = 0; i < depth; i++) {
                const e = world.spawn();
                world.insert(e, Transform);
                if (i > 0) world.setParent(e, nodes[i - 1]);
                nodes.push(e);
            }
            leaf = world.spawn();
            world.insert(leaf, Transform);
            world.setParent(leaf, nodes[depth - 1]);
            world.flushEngineStamps();
            world.ensureTransformsComposed();
        };
        bench(`1024 leaf moves and one composition, depth ${depth}`, () => {
            for (let i = 0; i < 1024; i++) world.setParent(leaf, nodes[depth - 2 + i % 2]);
            world.flushEngineStamps();
            world.ensureTransformsComposed();
        }, {
            setup, teardown: () => { world.disconnectCpp(); registry.delete(); },
            time: 350, warmupTime: 100,
        });
    }
});
