// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The data asset: a game's own `.json` table, loaded through the asset
 *        system rather than fetched by hand. The point of the type is not the
 *        parse — it is that the parse happens behind ref resolution, caching and
 *        the manifest, like every other asset.
 */
import { describe, it, expect, vi } from 'vitest';

// Constructing `Assets` builds a LoadContext, which wants the wasm resource
// manager — nothing this file exercises touches it (see assets.test.ts).
vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => ({}),
    evictTextureDimensions: vi.fn(),
}));

import { JsonAssetLoader } from '../src/asset/loaders/JsonAssetLoader';
import type { LoadContext } from '../src/asset/AssetLoader';

const PATH = 'assets/data/levels.json';

function makeCtx(text: string, buildPath = PATH): LoadContext {
    return {
        catalog: { getBuildPath: () => buildPath },
        loadText: vi.fn(async () => text),
    } as unknown as LoadContext;
}

describe('JsonAssetLoader', () => {
    it('hands back the parsed document', async () => {
        const loader = new JsonAssetLoader();
        const { data } = await loader.load(PATH, makeCtx('{"levels":[1,2,3],"name":"forest"}'));
        expect(data).toEqual({ levels: [1, 2, 3], name: 'forest' });
    });

    it('reads the COOKED path, so a build that renamed the file still resolves', async () => {
        // Every other loader goes through the catalog; a data asset that skipped
        // it would work in the editor and miss in the build.
        const ctx = makeCtx('[]', 'cooked/ab12cd.json');
        await new JsonAssetLoader().load(PATH, ctx);
        expect(ctx.loadText).toHaveBeenCalledWith('cooked/ab12cd.json');
    });

    it('names the file when the JSON is broken', async () => {
        // The parser's own message is a line and column in a document the caller
        // never sees, which is useless when twenty tables are loading.
        await expect(new JsonAssetLoader().load(PATH, makeCtx('{"levels": [1,'))).rejects.toThrow(PATH);
    });

    it('claims `.json` and calls itself json', () => {
        const loader = new JsonAssetLoader();
        expect(loader.type).toBe('json');
        expect(loader.extensions).toEqual(['.json']);
    });

    it('unloads without touching the document it returned', () => {
        // The caller may still be holding it; there is no subsystem residency to
        // sever, so unload has nothing to do and must not pretend otherwise.
        expect(() => new JsonAssetLoader().unload()).not.toThrow();
    });
});

// The loader only matters if `Assets` actually offers it — a type nobody
// registered is a type nobody can load.
describe('Assets.loadJson', () => {
    it('is registered as a built-in and reaches the parsed document', async () => {
        const { Assets } = await import('../src/asset/Assets');
        const backend = {
            fetchText: async () => '{"hp":12}',
            fetchBinary: async () => new ArrayBuffer(0),
            resolveUrl: (p: string) => p,
            setBaseUrl: () => {},
        } as unknown as import('../src/asset/Backend').Backend;

        const assets = Assets.create({ backend });
        expect(assets.getLoader('json')).toBeDefined();

        const { data } = await assets.loadJson<{ hp: number }>('assets/data/tuning.json');
        expect(data.hp).toBe(12);
    });
});
