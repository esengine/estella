// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Prefab instantiation, tortured against a hot reload underneath it.
 *
 * Instantiating a prefab that nests another one is asynchronous: the nested
 * bytes are fetched before a single entity is spawned. That await is a window,
 * and `invalidate()` on the nested prefab lands inside it — the composite then
 * gets built from a mix of what was asked for and what arrived.
 *
 * Whatever it builds, one thing has to hold: an instantiate either hands back a
 * tree the caller can despawn, or throws having left nothing behind. A partial
 * tree nobody owns is entities alive for the rest of the session.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';
import { World } from '../../src/ecs/world';
import { Assets } from '../../src/asset/Assets';
import type { Backend } from '../../src/asset/Backend';
import { instantiatePrefab } from '../../src/prefab';
import { PREFAB_FORMAT_VERSION } from '../../src/prefab/migrate';
import type { PrefabData } from '../../src/prefab/types';
import { initResourceManager, shutdownResourceManager } from '../../src/wasm/resourceManager';
import { setLogLevel, LogLevel } from '../../src/util/logger';
import type { CppRegistry, ESEngineModule } from '../../src/wasm';
import { loadWasmModule, HAS_WASM } from '../helpers/loadWasm';

const NESTED_PATH = 'prefabs/child.esprefab';
const RUNS = Number(process.env.TORTURE_RUNS ?? 200);
const SEED = process.env.TORTURE_SEED ? Number(process.env.TORTURE_SEED) : undefined;

const mockModule = { _malloc: () => 0, _free: () => {}, HEAPU8: new Uint8Array(8) } as never;
const backend = {
    fetchBinary: async () => new ArrayBuffer(8),
    fetchText: async () => '{}',
    resolveUrl: (p: string) => p,
} as unknown as Backend;

/** A leaf prefab: one root, one child, no nesting. */
function leafPrefab(tag: string): PrefabData {
    return {
        version: PREFAB_FORMAT_VERSION,
        name: `Leaf-${tag}`,
        rootEntityId: 'leaf',
        entities: [
            { prefabEntityId: 'leaf', name: `Leaf-${tag}`, parent: null, children: ['leafKid'], visible: true, components: [] },
            { prefabEntityId: 'leafKid', name: 'LeafKid', parent: 'leaf', children: [], visible: true, components: [] },
        ],
    } as PrefabData;
}

/** A composite whose child slot is the leaf, fetched through Assets. */
const COMPOSITE: PrefabData = {
    version: PREFAB_FORMAT_VERSION,
    name: 'Composite',
    rootEntityId: 'root',
    entities: [
        { prefabEntityId: 'root', name: 'Root', parent: null, children: ['slot'], visible: true, components: [] },
        {
            prefabEntityId: 'slot', name: 'Slot', parent: 'root', children: [], visible: true, components: [],
            nestedPrefab: { prefabPath: NESTED_PATH, overrides: [] },
        },
    ],
} as PrefabData;

interface Harness {
    world: World;
    assets: Assets;
    /** Open the pending nested-prefab fetch, if any. */
    settle(): boolean;
    fail(): boolean;
    outstanding(): number;
    dispose(): void;
}

/**
 * The C++ registry is not optional here: without it `despawn` does not walk
 * children at all (see World.despawnSubtree_), so "despawning the root takes the
 * subtree" — the claim this file makes — would be testing a World that cannot
 * do it rather than a prefab that built a bad tree.
 */
function makeHarness(module: ESEngineModule): Harness {
    initResourceManager({
        releaseTexture: () => {}, getTextureDimensions: () => null, setTextureMetadata: () => {},
    } as never);
    const world = new World();
    world.connectCpp(new (module as unknown as { Registry: new () => CppRegistry }).Registry(), module);
    const assets = Assets.create({ backend, module: mockModule });

    // A QUEUE, not one slot: invalidate() starts a fresh load while the previous
    // is still outstanding, and a harness that kept only the newest would strand
    // the older one — the run then hangs on a promise nothing can settle.
    const gates: Array<{ resolve: (v: unknown) => void; reject: (e: Error) => void }> = [];
    let generation = 0;
    assets.register({
        type: 'prefab',
        extensions: ['.esprefab'],
        load: () => new Promise((resolve, reject) => { gates.push({ resolve, reject }); }),
        unload: () => {},
    } as never);

    return {
        world,
        assets,
        settle() {
            const open = gates.shift();
            if (!open) return false;
            open.resolve({ data: leafPrefab(`g${generation++}`) });
            return true;
        },
        fail() {
            const open = gates.shift();
            if (!open) return false;
            open.reject(new Error('torture: nested prefab fetch failed'));
            return true;
        },
        outstanding: () => gates.length,
        dispose: () => shutdownResourceManager(),
    };
}

const flush = async (): Promise<void> => { await new Promise((r) => setTimeout(r, 0)); };

describe.skipIf(!HAS_WASM)('prefab instantiation under a hot reload', () => {
    let module: ESEngineModule;
    // Nested-prefab load failures are logged by design; hundreds of runs of them
    // would bury anything real.
    beforeAll(async () => { module = await loadWasmModule(); setLogLevel(LogLevel.Error); });
    afterAll(() => setLogLevel(LogLevel.Info));

    it('either hands back a despawnable tree or leaves nothing behind', async () => {
        const ACTIONS = ['instantiate', 'settle', 'fail', 'invalidate'] as const;

        await fc.assert(
            fc.asyncProperty(
                fc.array(fc.constantFrom(...ACTIONS), { minLength: 1, maxLength: 16 }),
                async (script) => {
                    const h = makeHarness(module);
                    const roots: number[] = [];
                    const inFlight: Promise<unknown>[] = [];
                    try {
                        for (const action of script) {
                            switch (action) {
                                case 'instantiate':
                                    inFlight.push(
                                        instantiatePrefab(h.world, COMPOSITE, { assets: h.assets }).then(
                                            (r) => { roots.push(r.root as unknown as number); },
                                            () => {},
                                        ),
                                    );
                                    break;
                                case 'settle': h.settle(); break;
                                case 'fail': h.fail(); break;
                                case 'invalidate': h.assets.invalidate(NESTED_PATH); break;
                            }
                            await flush();
                        }

                        // Open every fetch still waiting. Bounded: a load that
                        // resolves can start another, and a run that cannot be
                        // drained is itself the finding.
                        for (let i = 0; i < 64 && (h.outstanding() > 0 || i < 2); i++) {
                            h.settle();
                            await flush();
                        }
                        expect(h.outstanding(), 'a nested fetch could not be drained').toBe(0);
                        await Promise.allSettled(inFlight);

                        // Despawning each root must take its whole subtree with
                        // it. Anything left is an entity the caller was never
                        // given a handle to.
                        for (const root of roots) h.world.despawn(root as never);
                        expect(
                            h.world.entityCount(),
                            `${h.world.entityCount()} entit(ies) survived despawning every root the caller received`,
                        ).toBe(0);
                    } finally {
                        h.dispose();
                    }
                },
            ),
            { numRuns: RUNS, seed: SEED, verbose: true },
        );
    }, 300_000);
});
