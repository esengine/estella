// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  assetHarness — one asset system whose every async edge is schedulable.
 *
 * The bugs this suite hunts are not in a function, they are in an ORDER: a hot
 * reload that lands between a fetch resolving and the cache write, a release
 * that runs while a superseded load is still in flight. Reproducing one by hand
 * means writing the interleaving you already suspect, which is why the ones
 * nobody suspected survive.
 *
 * So nothing here settles on its own. The texture loader is a scheduled
 * function; fast-check decides which pending load resolves next, and shrinks
 * that decision along with the commands.
 */
import type * as fc from 'fast-check';
import { Assets } from '../../src/asset/Assets';
import type { Backend } from '../../src/asset/Backend';
import type { TextureResult } from '../../src/asset/Assets';
import { initResourceManager, shutdownResourceManager } from '../../src/wasm/resourceManager';
import { textureResidencyKey } from '../../src/asset/loaders/TextureLoader';
import { RuntimeConfig } from '../../src/defaults';

/**
 * The C++ texture pool, modelled rather than stubbed.
 *
 * A stub where release means gone leaves "a disposed resource never comes
 * back" vacuous — with no residency there is nothing to revive. The real pool
 * retains an unreferenced texture under its residency key, and revives it.
 */
export interface FakeGpu {
    /** Handles minted by a loader. */
    readonly created: number[];
    /** Live C++ reference count per handle. Zero = evictable or freed. */
    readonly refs: Map<number, number>;
    /** Handles the pool actually destroyed. These must never be seen again. */
    readonly freed: number[];
    /** A release that drove a handle's count below zero — a double free. */
    readonly doubleReleased: number[];
    /** Unreferenced but retained, keyed by residency key; a load revives these. */
    readonly resident: Map<string, number>;
    /** Residency keys severed by invalidate. */
    readonly severed: Set<string>;
    /** Revives that actually happened — proof the path is exercised at all. */
    readonly revived: number[];
}

export interface AssetHarness {
    readonly assets: Assets;
    readonly gpu: FakeGpu;
    /** Loader invocations, in order, as `key` — how request dedup is observed. */
    readonly loaderCalls: string[];
    /** Make the next load of `key` reject instead of resolving. */
    failNext(key: string): void;
    dispose(): void;
}

const mockModule = {
    _malloc: () => 0,
    _free: () => {},
    HEAPU8: new Uint8Array(64),
    GL: null,
    FS: null,
} as never;

/**
 * Build the system under test.
 *
 * `scheduleLoad` wraps each loader call so the scheduler owns when it settles;
 * pass `s.scheduleFunction(fn)` from a fast-check scheduler.
 */
export function makeAssetHarness(
    scheduleLoad: (key: string) => Promise<TextureResult>,
): AssetHarness {
    const gpu: FakeGpu = {
        created: [], refs: new Map(), freed: [], doubleReleased: [],
        resident: new Map(), severed: new Set(), revived: [],
    };
    const residencyOf = new Map<number, string>();
    // Revive is gated on the pool knowing the texture's size: a fake that
    // answered null made every revive bail into a re-fetch, so the path the
    // "never resurrect a destroyed handle" invariant guards went untested.
    const dimsOf = new Map<number, { width: number; height: number }>();
    const loaderCalls: string[] = [];
    const failing = new Set<string>();
    let nextHandle = 1;

    const rm = {
        registerTextureWithPath(handle: number, key: string): void {
            residencyOf.set(handle, key);
        },
        releaseTexture(handle: number): void {
            const next = (gpu.refs.get(handle) ?? 0) - 1;
            gpu.refs.set(handle, next);
            if (next < 0) {
                gpu.doubleReleased.push(handle);
                return;
            }
            if (next > 0) return;
            // Unreferenced: retained under its residency key unless that key was
            // severed, in which case the bytes are stale and the texture goes.
            const key = residencyOf.get(handle);
            if (key !== undefined && !gpu.severed.has(key)) gpu.resident.set(key, handle);
            else gpu.freed.push(handle);
        },
        getTextureDimensions: (handle: number) => dimsOf.get(handle) ?? null,
        setTextureMetadata: () => {},
        acquireTextureByPath(key: string): number {
            if (gpu.severed.has(key)) return 0;
            const handle = gpu.resident.get(key);
            if (handle === undefined) return 0;
            gpu.resident.delete(key);
            gpu.refs.set(handle, (gpu.refs.get(handle) ?? 0) + 1);
            gpu.revived.push(handle);
            return handle;
        },
        invalidateTexturePath(key: string): boolean {
            gpu.severed.add(key);
            const handle = gpu.resident.get(key);
            if (handle === undefined) return false;
            gpu.resident.delete(key);
            gpu.freed.push(handle);
            return true;
        },
        setTextureBudget: () => {},
        trimTextureCache: () => 0,
    } as never;

    initResourceManager(rm);

    const backend = {
        fetchBinary: async () => new ArrayBuffer(8),
        fetchText: async () => '{}',
        resolveUrl: (p: string) => `http://torture/${p}`,
    } as unknown as Backend;

    const assets = Assets.create({ backend, module: mockModule });

    // Every texture load becomes a scheduled task. The handle is minted here, at
    // the moment the loader is CALLED, so a value produced by a superseded load
    // is distinguishable from its successor's — which is the whole question.
    const loader = assets.getTextureLoader() as unknown as {
        load: (path: string) => Promise<TextureResult>;
        loadRaw: (path: string) => Promise<TextureResult>;
    };
    // The real loader registers its handle with the pool before returning — that
    // registration is what makes a later revive possible, so a harness that
    // skipped it would leave the revive path untested.
    const run = (flip: boolean) => async (path: string): Promise<TextureResult> => {
        loaderCalls.push(path);
        const shouldFail = failing.delete(path);
        await scheduleLoad(path);
        if (shouldFail) throw new Error(`torture: load failed for ${path}`);
        const handle = nextHandle++;
        gpu.created.push(handle);
        gpu.refs.set(handle, 1);
        dimsOf.set(handle, { width: 4, height: 4 });
        rm.registerTextureWithPath(handle, textureResidencyKey(path, flip));
        return { handle, width: 4, height: 4 } as TextureResult;
    };
    loader.load = run(true);
    loader.loadRaw = run(false);

    return {
        assets,
        gpu,
        loaderCalls,
        failNext: (key) => failing.add(key),
        dispose: () => shutdownResourceManager(),
    };
}

/**
 * Timeouts are their own property, not background noise: the timer path here
 * would fire on wall-clock time and settle loads the scheduler was still
 * holding, which turns every interleaving into a different one than the seed
 * says. Disabled per-run and restored on dispose.
 */
export function withoutLoadTimeout<T>(body: () => T): T {
    const previous = RuntimeConfig.assetLoadTimeout;
    RuntimeConfig.assetLoadTimeout = 0;
    try {
        return body();
    } finally {
        RuntimeConfig.assetLoadTimeout = previous;
    }
}

/** The scheduler type, without making every caller import fast-check's namespace. */
export type Scheduler = fc.Scheduler;

/** One live generation of a texture: the handle its holders were given, and how many. */
export interface TextureGeneration {
    readonly value: number;
    count: number;
}

/**
 * The reference ledger, read through the private field on purpose: "a refcount
 * is never negative" is an invariant about the counter itself, and routing it
 * through a public accessor would test the accessor. Nothing else reaches in.
 */
export function textureRefs(assets: Assets): ReadonlyMap<string, readonly TextureGeneration[]> {
    return (assets as unknown as {
        textureRefs_: { entries(): ReadonlyMap<string, readonly TextureGeneration[]> };
    }).textureRefs_.entries();
}

// =============================================================================
// Generic assets — the other half of the ledger
// =============================================================================

/** What a generic (non-texture) loader did, as the test can see it. */
export interface FakeGenericLoader {
    /** load() invocations, in order. */
    readonly loads: string[];
    /** Entries handed to unload(). One appearing twice is a double free. */
    readonly unloaded: unknown[];
    /** Entries produced and not yet unloaded. */
    live(): unknown[];
}

export interface GenericHarness {
    readonly assets: Assets;
    readonly loader: FakeGenericLoader;
    failNext(path: string): void;
    dispose(): void;
}

/**
 * A tilemap loader whose settling the caller owns, standing in for every
 * non-texture kind. They all share one code path (loadTyped/releaseTyped) and
 * now one ledger, so proving the contract on one proves it for audio,
 * materials, fonts, clips and prefabs too.
 */
export function makeGenericHarness(
    scheduleLoad: (path: string) => Promise<unknown>,
): GenericHarness {
    initResourceManager({
        releaseTexture: () => {},
        getTextureDimensions: () => null,
        setTextureMetadata: () => {},
    } as never);

    const backend = {
        fetchBinary: async () => new ArrayBuffer(8),
        fetchText: async () => '{}',
        resolveUrl: (p: string) => `http://torture/${p}`,
    } as unknown as Backend;
    const assets = Assets.create({ backend, module: mockModule });

    const loads: string[] = [];
    const unloaded: unknown[] = [];
    const produced: unknown[] = [];
    const failing = new Set<string>();
    let nextId = 1;

    assets.register({
        type: 'tilemap',
        extensions: ['.estilemap'],
        async load(path: string): Promise<unknown> {
            loads.push(path);
            const shouldFail = failing.delete(path);
            await scheduleLoad(path);
            if (shouldFail) throw new Error(`torture: generic load failed for ${path}`);
            const entry = { id: nextId++, path };
            produced.push(entry);
            return entry;
        },
        unload(asset: unknown): void {
            unloaded.push(asset);
        },
    } as never);

    return {
        assets,
        loader: {
            loads,
            unloaded,
            live: () => produced.filter((e) => !unloaded.includes(e)),
        },
        failNext: (path) => failing.add(path),
        dispose: () => shutdownResourceManager(),
    };
}

/** The generic half of the reference ledger, for the same reason as textureRefs. */
export function genericRefs(assets: Assets): ReadonlyMap<string, readonly { value: unknown; count: number }[]> {
    return (assets as unknown as {
        genericRefs_: { entries(): ReadonlyMap<string, readonly { value: unknown; count: number }[]> };
    }).genericRefs_.entries();
}
