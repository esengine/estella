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
import type { AddressableManifest } from '../src/asset/AddressableManifest';

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

    it('a scene preload hands back a receipt per SUCCESSFUL acquire', async () => {
        // Covers the wiring a mocked scene loader cannot: preloadSceneAssets
        // fills the scope itself, and a load that threw leaves nothing in it.
        const unloaded: string[] = [];
        let n = 0;
        const assets = makeAssets(unloaded);
        assets.register<{ handle: number; id: string }>({
            type: 'mesh',
            load: async (path: string) => {
                if (path.includes('broken')) throw new Error('no bytes');
                return { handle: 70 + (++n), id: `mesh${n}` };
            },
            unload: (v: { id: string }) => { unloaded.push(v.id); },
        } as never);

        const scene = {
            version: '1.0', name: 's', entities: [
                { id: 1, name: 'a', parent: null, children: [],
                  components: [{ type: 'MeshRenderer', data: { mesh: 'ship.esmesh' } }] },
                { id: 2, name: 'b', parent: null, children: [],
                  components: [{ type: 'MeshRenderer', data: { mesh: 'broken.esmesh' } }] },
            ],
        } as never;

        const base = assets.sizes().refRows;
        const result = await assets.preloadSceneAssets(scene);
        expect(result.missing.map(m => m.ref)).toContain('broken.esmesh');
        // One receipt: the failed acquire owns nothing, so unload has nothing
        // to give back for it and nothing to guess at.
        expect(result.scope.size).toBe(1);

        result.scope.releaseAll();
        expect(unloaded).toEqual(['mesh1']);
        expect(assets.sizes().refRows).toBe(base);
    });

    it('one scene\'s unload cannot touch another scene\'s generation', async () => {
        const unloaded: string[] = [];
        const assets = makeAssets(unloaded);
        const base = assets.sizes().refRows;

        const sceneA = new AssetScope();
        sceneA.add(await assets.acquireTyped('font', 'shared.ttf'));

        // A hot update lands between the two scenes.
        assets.invalidate('shared.ttf');

        const sceneB = new AssetScope();
        sceneB.add(await assets.acquireTyped('font', 'shared.ttf'));

        sceneB.releaseAll();
        expect(unloaded).toEqual(['gen2']);          // B gave back B's era
        expect(assets.sizes().refRows).toBe(base + 1);   // A still holds one

        sceneA.releaseAll();
        expect(unloaded).toEqual(['gen2', 'gen1']);
        expect(assets.sizes().refRows).toBe(base);
    });

    it('a retained receipt joins the era its source names, not the era the path resolves to', async () => {
        // Splitting ownership is not acquiring: after an invalidate the path
        // resolves to a NEW instance while the splitting owner is still bound to
        // the old one, so a re-acquire receipts something nothing is using.
        const unloaded: string[] = [];
        const assets = makeAssets(unloaded);
        const base = assets.sizes().refRows;

        const held = await assets.acquireTyped<{ id: string }>('font', 'f.ttf');
        assets.invalidate('f.ttf');                                     // gen1's era closes
        const fresh = await assets.acquireTyped<{ id: string }>('font', 'f.ttf');
        expect(fresh.value.id).toBe('gen2');

        const retained = held.retain()!;
        expect(retained.generation).toBe(held.generation);              // the same era...
        expect(retained.value.id).toBe('gen1');                         // ...and the same instance
        expect(assets.sizes().refRows).toBe(base + 3);

        held.release();
        expect(unloaded).toEqual([]);                 // gen1 is still owed by the retained one
        retained.release();
        expect(unloaded).toEqual(['gen1']);
        fresh.release();
        expect(unloaded).toEqual(['gen1', 'gen2']);
        expect(assets.sizes().refRows).toBe(base);
    });

    it('there is nothing to retain once the last holder let go', async () => {
        const unloaded: string[] = [];
        const assets = makeAssets(unloaded);
        const held = await assets.acquireTyped<{ id: string }>('font', 'f.ttf');
        held.release();
        // Not a resurrection door: the asset is gone, and a receipt for it would
        // be one nobody could ever give back.
        expect(held.retain()).toBeNull();
    });

    it('a scope absorbs another\'s receipts, and gives back what it took', async () => {
        // The packaged-game shape: the loader acquires into a scope of its own
        // and hands the whole thing to the scene that will outlive it. Releasing
        // by PATH instead is what took the wrong era below.
        const unloaded: string[] = [];
        const assets = makeAssets(unloaded);
        const base = assets.sizes().refRows;

        const sceneA = new AssetScope();
        sceneA.add(await assets.acquireTyped('font', 'shared.ttf'));   // gen1

        assets.invalidate('shared.ttf');                                // a hot update lands

        const loaderScope = new AssetScope();
        loaderScope.add(await assets.acquireTyped('font', 'shared.ttf'));  // gen2
        const sceneB = new AssetScope();
        sceneB.absorb(loaderScope);
        expect(loaderScope.size).toBe(0);      // the loader owes nothing afterwards
        expect(sceneB.size).toBe(1);

        sceneB.releaseAll();
        expect(unloaded).toEqual(['gen2']);                  // B's own era
        expect(assets.sizes().refRows).toBe(base + 1);       // A still holds gen1

        // What the path door does with the same call — the era it takes is the
        // OLDEST, which is the scene that loaded before the update.
        assets.releaseTyped('font', 'shared.ttf');
        expect(unloaded).toEqual(['gen2', 'gen1']);
        sceneA.releaseAll();                                  // already gone: no double free
        expect(unloaded).toEqual(['gen2', 'gen1']);
    });

    it('a scene survives many hot updates and still balances at unload', async () => {
        // The dogfood shape: load, hot-update the same asset repeatedly, unload.
        // Every era that was acquired is given back exactly once.
        const unloaded: string[] = [];
        const assets = makeAssets(unloaded);
        const base = assets.sizes().refRows;
        const scene = new AssetScope();

        scene.add(await assets.acquireTyped('font', 'hero.ttf'));
        for (let i = 0; i < 10; i++) {
            assets.invalidate('hero.ttf');
            scene.add(await assets.acquireTyped('font', 'hero.ttf'));
        }
        expect(scene.size).toBe(11);

        scene.releaseAll();
        expect(unloaded).toHaveLength(11);
        expect(new Set(unloaded).size).toBe(11);      // no era freed twice
        expect(assets.sizes().refRows).toBe(base);    // and none stranded
    });

    it('a group bundle releases what it took, not what the manifest says today', async () => {
        // Releasing by group NAME re-reads the manifest to decide what to give
        // back. With atomic manifest updates that set is no longer the one this
        // load took out, so the bundle carries its own receipts instead.
        const unloaded: string[] = [];
        const assets = makeAssets(unloaded);
        const base = assets.sizes().refRows;
        const manifestWith = (path: string): AddressableManifest => ({
            version: '2.0',
            groups: {
                area: {
                    bundleMode: 'local', labels: [],
                    assets: { [path]: { path, type: 'font', size: 8, labels: [] } },
                },
            },
        });

        assets.setManifest(manifestWith('old.ttf'));
        const bundle = await assets.loadGroup('area');
        expect(bundle.scope.size).toBe(1);

        // The world moves on: a hot update rewrites what "area" contains.
        assets.setManifest(manifestWith('new.ttf'));

        bundle.release();
        expect(unloaded).toEqual(['gen1']);            // what it actually took
        expect(assets.sizes().refRows).toBe(base);     // and nothing stranded
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
