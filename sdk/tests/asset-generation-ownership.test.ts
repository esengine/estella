// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    asset-generation-ownership.test.ts
 * @brief   A release gives back the acquisition it names, not the oldest one
 *          sharing its path.
 *
 * @details `invalidate()` leaves two generations of one path live at once: the
 *          holders of the outgoing one still owe a release. A path-addressed
 *          release cannot tell them apart, so it took the oldest — freeing an
 *          asset its holder was still using, and stranding the newer one with
 *          nobody able to free it. These pin the receipt-based path instead.
 */
import { describe, it, expect, vi } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { AssetRefLedger } from '../src/asset/AssetRefLedger';
import { AssetScope } from '../src/asset/AssetLease';
import type { Backend } from '../src/asset/Backend';

vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => ({ releaseTexture: vi.fn(), invalidateTexturePath: vi.fn(() => false) }),
    getResourceManager: () => null,
    evictTextureDimensions: vi.fn(),
}));

/** A generic asset whose every generation is a distinguishable object. */
function makeAssets(unloaded: string[]) {
    let n = 0;
    const assets = Assets.create({
        backend: {
            fetchBinary: vi.fn(async () => new ArrayBuffer(8)),
            fetchText: vi.fn(async () => '{}'),
            resolveUrl: (p: string) => `http://test/${p}`,
        } as unknown as Backend,
        module: { _malloc: vi.fn(() => 0), _free: vi.fn(), HEAPU8: new Uint8Array(16), GL: null, FS: null } as never,
    });
    assets.register<{ id: string }>({
        type: 'font',
        load: async () => ({ id: `gen${++n}` }),
        unload: (v: { id: string }) => { unloaded.push(v.id); },
    } as never);
    return assets;
}

describe('asset ownership is generation-exact', () => {
    it('a holder of the new generation does not free the old one', async () => {
        const unloaded: string[] = [];
        const assets = makeAssets(unloaded);
        const base = assets.sizes().refRows;

        const a = await assets.acquireTyped<{ id: string }>('font', 'f.ttf');
        assets.invalidate('f.ttf');                       // A keeps gen1, still owes a release
        const b = await assets.acquireTyped<{ id: string }>('font', 'f.ttf');
        expect(a.value.id).toBe('gen1');
        expect(b.value.id).toBe('gen2');
        expect(a.generation).not.toBe(b.generation);

        b.release();                                      // B lets go of gen2
        expect(unloaded).toEqual(['gen2']);               // ...and gen1 is untouched
        expect(unloaded).not.toContain(a.value.id);

        a.release();                                      // A lets go of gen1
        expect(unloaded).toEqual(['gen2', 'gen1']);
        expect(assets.sizes().refRows).toBe(base);        // the ledger balances
    });

    it('two holders of ONE generation still share it', async () => {
        const unloaded: string[] = [];
        const assets = makeAssets(unloaded);
        const a = await assets.acquireTyped<{ id: string }>('font', 'f.ttf');
        const b = await assets.acquireTyped<{ id: string }>('font', 'f.ttf');
        expect(a.generation).toBe(b.generation);          // a cache hit is one era

        a.release();
        expect(unloaded).toEqual([]);                     // still pinned by B
        b.release();
        expect(unloaded).toEqual(['gen1']);
    });

    it('giving the same receipt back twice is a no-op, not a double free', async () => {
        const unloaded: string[] = [];
        const assets = makeAssets(unloaded);
        const a = await assets.acquireTyped<{ id: string }>('font', 'f.ttf');
        const b = await assets.acquireTyped<{ id: string }>('font', 'f.ttf');

        a.release();
        a.release();                                      // the bug this prevents
        expect(unloaded).toEqual([]);                     // B's reference survives
        b.release();
        expect(unloaded).toEqual(['gen1']);
    });

    it('an era closed by invalidate is never rejoined, even by an equal value', () => {
        // The ledger mints the generation id, so a loader handing back an `===`
        // equal value after invalidate cannot merge two eras.
        const ledger = new AssetRefLedger<string>();
        const first = ledger.acquire('k', 'SAME');
        ledger.supersede('k');
        const second = ledger.acquire('k', 'SAME');
        expect(second.generation).not.toBe(first.generation);

        expect(ledger.release(second)?.exhausted).toBe(true);
        expect(ledger.generations('k').map((g) => g.id)).toEqual([first.generation]);
        expect(ledger.release(first)?.exhausted).toBe(true);
        expect(ledger.rows).toBe(0);
    });

    it('a scope releases what it actually acquired', async () => {
        const unloaded: string[] = [];
        const assets = makeAssets(unloaded);
        const base = assets.sizes().refRows;
        const scope = new AssetScope();

        scope.add(await assets.acquireTyped('font', 'a.ttf'));
        scope.add(await assets.acquireTyped('font', 'b.ttf'));
        assets.invalidate('a.ttf');
        scope.add(await assets.acquireTyped('font', 'a.ttf'));   // a second era of a.ttf
        expect(scope.size).toBe(3);

        scope.releaseAll();
        expect(unloaded.sort()).toEqual(['gen1', 'gen2', 'gen3']);
        expect(assets.sizes().refRows).toBe(base);
        scope.releaseAll();                                       // idempotent
        expect(unloaded).toHaveLength(3);
    });
});
