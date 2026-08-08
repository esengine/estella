// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Scene and prefab budgets: what it costs to open, save and instantiate
 *        at corpus size.
 *
 * These run against the SHIPPED SDK bundle (`esengine/node`), not `src`. A
 * probe that only exists in source is a probe the users' engine does not have —
 * the soak suite found exactly that, a census that tree-shaking had emptied out
 * of `dist` while every test measuring `src` stayed green.
 *
 * The world here is a headless App: the real wasm core, the real component
 * registry, no renderer. Everything below is CPU-side scene work, which is
 * where the cost of a big scene actually lives.
 */
import { describe, it, beforeAll, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
    createHeadlessApp,
    loadEsengineModule,
    resetWorldTo,
    serializeScene,
    instantiatePrefab,
    type App,
    type SceneData,
} from 'esengine/node';

import { WASM_DIR, HAS_WASM } from '../helpers/loadWasm';
import { budgeted, calibrate, corpusDir } from './harness';

const GROUP = 'Scenes — 10,000 sprites and the everything scene';

let root: string;
let app: App;
let sprites: SceneData;
let everything: SceneData;
let prefab: unknown;

const readScene = async (rel: string): Promise<SceneData> =>
    JSON.parse(await readFile(path.join(root, rel), 'utf8')) as SceneData;

beforeAll(async () => {
    root = corpusDir();
    await calibrate(root);
    const module = await loadEsengineModule(WASM_DIR);
    app = createHeadlessApp(module);
    sprites = await readScene('assets/scenes/sprites.esscene');
    everything = await readScene('assets/scenes/everything.esscene');
    prefab = JSON.parse(await readFile(path.join(root, 'assets/prefabs/shard-000/prefab-00000.esprefab'), 'utf8'));
}, 300_000);

describe.skipIf(!HAS_WASM)(GROUP, () => {
    it('opens the 10k-sprite scene', async () => {
        // Warmed once so every timed run despawns a full world before loading —
        // the first reset into an empty world does half the work of the rest.
        await budgeted({
            name: 'scene: open 10,000 sprites',
            group: GROUP,
            unit: 'parse',
            budget: 55,
            why: 'Double-clicking a scene in the editor. The entities exist and their components '
                + 'are in wasm storage when this returns; nothing is drawn yet.',
            runs: 3,
            warmup: 1,
        }, () => {
            const map = resetWorldTo(app.world, sprites);
            expect(map.size).toBeGreaterThan(10_000);
            return map;
        });
    }, 600_000);

    it('opens the everything scene', async () => {
        // Prefab instances are entries, not entities, until an asset-backed load
        // expands them; this path spawns the ones that carry components inline.
        // What expanding costs is the instantiate metric below.
        const inline = everything.entities.filter((e) => Array.isArray(e.components)).length;
        await budgeted({
            name: 'scene: open the everything scene',
            group: GROUP,
            unit: 'parse',
            budget: 135,
            why: 'Sprites, UI, physics bodies, spine and a tilemap in one document — the scene '
                + 'nobody authors on purpose and every project eventually has. The worst case for open.',
            runs: 3,
            warmup: 1,
        }, () => {
            const map = resetWorldTo(app.world, everything);
            expect(map.size).toBe(inline);
            return map;
        });
    }, 600_000);

    it('serializes the everything scene', async () => {
        // Left holding the everything scene by the test above; serialize measures
        // the world as it stands.
        await budgeted({
            name: 'scene: serialize the everything scene',
            group: GROUP,
            unit: 'parse',
            budget: 130,
            why: 'Every save, every Play (the editor snapshots the world so Stop can restore it) '
                + 'and every autosave pays this. It reads every component of every entity back out.',
            runs: 3,
        }, () => {
            const data = serializeScene(app.world, 'everything');
            expect(data.entities.length).toBeGreaterThan(17_000);
            return data;
        });
    }, 600_000);

    it('parses the everything scene document', async () => {
        const text = await readFile(path.join(root, 'assets/scenes/everything.esscene'), 'utf8');
        await budgeted({
            name: 'scene: JSON.parse the everything document',
            group: GROUP,
            unit: 'parse',
            budget: 15,
            why: 'The floor under scene open: reading 7MB of JSON off disk into objects. '
                + 'If opening a scene approaches a small multiple of this, the loader is close to free.',
            runs: 5,
        }, () => JSON.parse(text));
    }, 300_000);

    it('instantiates 1000 prefabs', async () => {
        const overrides = [{
            prefabEntityId: '0',
            type: 'property' as const,
            componentType: 'Transform',
            propertyName: 'position',
            value: { x: 1, y: 2, z: 0 },
        }];
        resetWorldTo(app.world, { version: 1, name: 'empty', entities: [] });
        await budgeted({
            name: 'prefab: instantiate 1000 with an override',
            group: GROUP,
            unit: 'parse',
            budget: 26,
            why: 'A spawner\'s first second — bullets, enemies, tiles. Each one flattens its source '
                + 'and replays its overrides, so this is the cost of the prefab pipeline, not of spawn.',
            runs: 3,
        }, async () => {
            for (let i = 0; i < 1000; i++) {
                await instantiatePrefab(app.world, prefab as never, { overrides });
            }
            // Cleared inside the timed region on purpose: leaving 1000 entities per
            // run would make each run measure a bigger world than the last.
            resetWorldTo(app.world, { version: 1, name: 'empty', entities: [] });
        });
    }, 600_000);
});
