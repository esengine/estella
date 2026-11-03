// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The mesh renderers of a model told apart by the id Cocos gave each component, so a material put on one part of a model instance reaches that part.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CocosModels } from '../src/import/cocos/models';
import type { CocosAssetEntry, CocosAssetIndex } from '../src/import/cocos/assets';

describe('the parts of a model', () => {
    const roots: string[] = [];
    afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });

    function models(withLibrary: boolean): { models: CocosModels; entry: CocosAssetEntry } {
        const project = mkdtempSync(path.join(tmpdir(), 'cocos-parts-'));
        roots.push(project);
        const uuid = '0b66da8a-0278-47c3-968e-5e4325ae5482';
        const scene = `${uuid}@8a0c4`;
        if (withLibrary) {
            mkdirSync(path.join(project, 'library', '0b'), { recursive: true });
            writeFileSync(path.join(project, 'library', '0b', `${scene}.json`), JSON.stringify([
                { __type__: 'cc.Prefab' },
                { __type__: 'cc.Node', _name: 'room' },
                { __type__: 'cc.Node', _name: 'wall' },
                { __type__: 'cc.MeshRenderer', node: { __id__: 2 }, __prefab: { __id__: 4 } },
                { __type__: 'cc.CompPrefabInfo', fileId: 'wallRenderer' },
            ]));
        }
        const entry: CocosAssetEntry = {
            uuid, file: path.join(project, 'assets', 'room.FBX'), rel: 'room.FBX', importer: 'fbx', userData: {},
            subs: new Map([[scene, { importer: 'gltf-scene', name: 'room.prefab', userData: {} }]]),
        };
        const index: CocosAssetIndex = { root: path.join(project, 'assets'), byUuid: new Map([[uuid, entry]]), bundles: [] };
        return { models: new CocosModels(index, path.join(project, 'out'), 'cocos', true), entry };
    }

    it('are named by the id of their renderer, from the editor library', () => {
        const { models: m, entry } = models(true);
        expect([...m.partsOf(entry)]).toEqual([['wallRenderer', 'wall']]);
    });

    it('stay unaddressed when the project has no library', () => {
        const { models: m, entry } = models(false);
        expect(m.partsOf(entry).size).toBe(0);
    });
});
