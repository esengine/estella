// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-contract-delivery.test.ts
 * @brief   An author's promise, from the `.meta` to a world pose nobody pays for.
 *
 * @details The criterion this replaces proved that the projection worked when
 *          something handed it a registry, and nothing anywhere handed it one —
 *          so a contract had never authorised a single deferred pose in any
 *          realm, in any build, ever. A test can be green on both sides of a
 *          seam that nobody crosses.
 *
 *          So this one starts where an author actually leaves the promise and
 *          ends where it is supposed to pay off, and NOTHING in it may inject a
 *          certificate: no `certifyBounds`, no envelope handed to a constructor.
 *          The only inputs are an importer block, a manifest built by the
 *          shipping writer, and a scene naming its assets the way scenes do.
 *
 *          That the mechanism works given a certificate is a different question,
 *          answered by spine-demand-driven-pose. This one asks whether the
 *          certificate is ever there.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { Catalog } from '../src/asset/Catalog';
import { AssetScope } from '../src/asset/AssetLease';
import type { Backend } from '../src/asset/Backend';
import type { Entity } from '../src/types';
import { SpineRuntime } from '../src/spine/SpineRuntime';
import { SpineManager } from '../src/spine/SpineManager';
import { loadSpineAssets } from '../src/spine/loadSpineScene';
import { spinePairKey } from '../src/spine/prepareSpine';
import { spineManifestContractFrom } from '../src/asset/spineImportSettings';
import { ManifestModel, type AddressableManifest } from '../src/asset/AddressableManifest';
import type { RuntimeAssetSource } from '../src/runtime/runtimeAssets';
import { fakeSpineModule } from './helpers/fakeSpineModule';

function createPoolFake() {
    const live = new Set<number>();
    const byPath = new Map<string, number>();
    let next = 1;
    return {
        budget: 0,
        createTexture: vi.fn((): number => { const h = next++; live.add(h); return h; }),
        createTextureFromBytes: vi.fn((): number => { const h = next++; live.add(h); return h; }),
        registerTextureWithPath: vi.fn((handle: number, path: string) => { byPath.set(path, handle); }),
        acquireTextureByPath: vi.fn((path: string): number => byPath.get(path) ?? 0),
        invalidateTexturePath: vi.fn((path: string): boolean => byPath.delete(path)),
        releaseTexture: vi.fn((handle: number) => { live.delete(handle); }),
        getTextureDimensions: vi.fn(() => ({ width: 4, height: 4 })),
        getTextureGLId: vi.fn((handle: number) => handle + 1000),
        setTextureMetadata: vi.fn(),
    };
}
let pool = createPoolFake();
vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => pool,
    getResourceManager: () => pool,
    evictTextureDimensions: vi.fn(),
}));

const platformFactory = vi.hoisted(() => () => ({
    platformCreateCanvas: () => ({
        width: 4, height: 4,
        getContext: () => ({
            clearRect: vi.fn(), drawImage: vi.fn(),
            getImageData: () => ({ data: { buffer: new ArrayBuffer(64) } }),
        }),
    }),
    platformCreateImage: () => {
        const img: { width?: number; height?: number; onload?: () => void } = {};
        setTimeout(() => { img.width = 4; img.height = 4; img.onload?.(); }, 0);
        return img;
    },
    platformFetch: vi.fn(), platformReadFile: vi.fn(),
    platformReadTextFile: vi.fn(), platformFileExists: vi.fn(),
    platformLoadSubpackage: vi.fn(async () => {}),
    platformGetStorageItem: () => null, platformSetStorageItem: vi.fn(),
    platformWriteCacheFile: vi.fn(async () => {}),
}));
vi.mock('../src/platform', platformFactory);
vi.mock('../src/platform/base', platformFactory);

// The project, as files on somebody's disk.
const SKEL_UUID = '7386aaf3-55a9-4879-b4f3-95a5f6a1cde4';
const ATLAS_UUID = 'b5f07fb2-95dd-4ed5-98b8-414900e96b9d';
const OTHER_ATLAS_UUID = 'c0ffee00-0000-4000-8000-000000000001';
const SKEL_PATH = 'assets/spine/hero.skel';
const ATLAS_PATH = 'assets/spine/hero.atlas';
const OTHER_ATLAS_PATH = 'assets/spine/winter.atlas';

/** A scene names its assets by uuid — the shape the delivery actually failed in. */
const SKEL_REF = `@uuid:${SKEL_UUID}`;
const ATLAS_REF = `@uuid:${ATLAS_UUID}`;
const OTHER_ATLAS_REF = `@uuid:${OTHER_ATLAS_UUID}`;

/** The `.meta` importer block the inspector's "Use as Fixed Culling Bounds" left. */
const AUTHORED_META = {
    scale: 1,
    cullingBounds: { x: -200, y: -100, width: 400, height: 700 },
    cullingAtlas: ATLAS_REF,
};

const ASSET_TABLE = [
    { uuid: SKEL_UUID, path: SKEL_PATH, importer: AUTHORED_META as Record<string, unknown> },
    { uuid: ATLAS_UUID, path: ATLAS_PATH, importer: {} as Record<string, unknown> },
    { uuid: OTHER_ATLAS_UUID, path: OTHER_ATLAS_PATH, importer: {} as Record<string, unknown> },
];

/**
 * The manifest a build ships, through the writer BOTH production writers use.
 * Round-tripped through JSON, because that is what actually reaches a realm.
 */
function shippedManifest(table = ASSET_TABLE): AddressableManifest {
    const keyOfRef = new Map<string, string>();
    for (const { uuid, path } of table) {
        for (const spelling of [uuid, `@uuid:${uuid}`, path]) keyOfRef.set(spelling, uuid);
    }
    const assets: Record<string, unknown> = {};
    for (const { uuid, path, importer } of table) {
        const spineImport = spineManifestContractFrom(importer, (ref) => keyOfRef.get(ref));
        assets[uuid] = {
            path, type: 'binary', size: 0, labels: [],
            ...(spineImport ? { spineImport } : {}),
        };
    }
    const manifest = { version: '2.0', groups: { main: { bundleMode: 'local', labels: [], assets } } };
    return JSON.parse(JSON.stringify(manifest)) as AddressableManifest;
}

/** The realm's asset source, carrying only what a realm's source carries. */
function shippedSource(manifest: AddressableManifest): RuntimeAssetSource {
    return { spineCulling: ManifestModel.fromJson(manifest).spineCullingLookup() } as RuntimeAssetSource;
}

const atlasDoc = 'page.png\nsize: 4,4\nformat: RGBA8888\n';

/** A realm's Assets: uuid refs resolve to paths, exactly as `applyAssetRefResolvers` does. */
function realm(): Assets {
    const byUuid = new Map(ASSET_TABLE.map((a) => [`@uuid:${a.uuid}`, a.path]));
    const assets = Assets.create({
        backend: {
            fetchBinary: vi.fn(async () => new ArrayBuffer(8)),
            fetchText: vi.fn(async () => atlasDoc),
            resolveUrl: (p: string) => `http://test/${p}`,
        } as unknown as Backend,
        catalog: Catalog.empty(),
        module: { _malloc: vi.fn(() => 0), _free: vi.fn(), HEAPU8: new Uint8Array(1 << 16), GL: null, FS: null } as never,
    });
    assets.setAssetRefResolver((ref) => byUuid.get(ref) ?? ref);
    assets.getTextureLoader().setPixelDecoder(async () => ({
        width: 4, height: 4, pixels: new Uint8Array(64),
    }));
    return assets;
}

/** Load one pair the way a scene does, and hand back the era it produced. */
async function delivered(atlas = ATLAS_REF, manifest = shippedManifest()) {
    const assets = realm();
    const scope = new AssetScope(assets);
    const manager = new SpineManager({} as never, new Map());
    const info = await loadSpineAssets(
        null, shippedSource(manifest), manager, [{ skeleton: SKEL_REF, atlas }],
        undefined, { assets, scope },
    );
    return { era: info.get(spinePairKey(SKEL_REF, atlas))?.era, scope };
}

/** A core that declines everything and records what it was asked to draw. */
function offscreenCamera() {
    const state = { submits: 0 };
    const heap = new Uint32Array(64);
    const api = {
        renderer_submitSkeletalBatchByEntity: () => { state.submits++; },
        renderer_entityVisibleToCamera: (
            _r: unknown, _e: number, _l: number,
            _a: number, _b: number, _c: number, _d: number, out: number,
        ) => { heap[out >> 2] = 0; },
        _malloc: () => 4, _free: () => {},
        HEAPU8: new Uint8Array(heap.buffer), HEAPU32: heap,
    };
    return { core: api as never, state };
}

beforeEach(() => { pool = createPoolFake(); });

describe('an author\'s promise reaches a running scene', () => {
    it('arrives certified at the era a uuid-referencing scene loads', async () => {
        const { era, scope } = await delivered();
        expect(era, 'the pair never loaded').toBeDefined();
        expect(era!.culling.kind,
            'the contract did not survive metadata → manifest → source → era').toBe('certified');
        expect(era!.culling.kind === 'certified' && era!.culling.bounds)
            .toEqual({ minX: -200, minY: -100, maxX: 200, maxY: 600 });
        scope.releaseAll();
    });

    it('and costs nothing while no camera wants it', async () => {
        const { era, scope } = await delivered();
        const fake = fakeSpineModule();
        const runtime = new SpineRuntime('3.8', fake.module);
        runtime.loadEntity(1 as Entity, era!);
        runtime.observe(true);

        expect(runtime.mayDefer(1 as Entity),
            'a delivered contract did not authorise a deferral').toBe(true);

        const camera = offscreenCamera();
        runtime.updateAll(1 / 60);
        runtime.extractAndSubmitMeshes(camera.core, {} as never);

        const m = runtime.metrics()!;
        expect(m.pose.logicalUpdates, 'the animation stopped').toBe(1);
        expect(m.pose.worldMaterializations, 'a world pose nobody wanted was resolved').toBe(0);
        expect(m.pose.meshExtractions).toBe(0);
        expect(camera.state.submits).toBe(0);
        expect(runtime.worldPoseDebt(), 'the frame did not skip the pose').toBe(1);
        runtime.dispose();
        scope.releaseAll();
    });

    it('is named by uuid the whole way, because that is how the delivery failed', () => {
        // Not decoration: the transport this replaced resolved paths and dropped
        // uuid refs on the floor, and every criterion it had used paths.
        expect(SKEL_REF.startsWith('@uuid:')).toBe(true);
        expect(AUTHORED_META.cullingAtlas.startsWith('@uuid:')).toBe(true);
        const shipped = shippedManifest().groups.main.assets[SKEL_UUID];
        expect(shipped.spineImport, 'the contract never reached the manifest').toBeDefined();
        expect(shipped.spineImport!.atlas,
            'the shipped atlas is a ref spelling, not this build\'s identity').toBe(ATLAS_UUID);
    });
});

describe('the promise is about a pair, and stops at its edge', () => {
    it('another atlas inherits nothing', async () => {
        const { era, scope } = await delivered(OTHER_ATLAS_REF);
        expect(era, 'the pair never loaded').toBeDefined();
        expect(era!.culling.kind,
            'a promise about one atlas authorised a skeleton drawn with another').toBe('unknown');
        scope.releaseAll();
    });

    it('a contract naming an atlas this build does not ship is not shipped either', () => {
        const orphan = [{
            uuid: SKEL_UUID, path: SKEL_PATH,
            importer: { ...AUTHORED_META, cullingAtlas: '@uuid:nothing-here' } as Record<string, unknown>,
        }];
        expect(shippedManifest(orphan).groups.main.assets[SKEL_UUID].spineImport,
            'a promise about an absent asset shipped anyway').toBeUndefined();
    });

    it('half a contract is not a contract', () => {
        const keyOf = () => ATLAS_UUID;
        expect(spineManifestContractFrom({ cullingBounds: AUTHORED_META.cullingBounds }, keyOf),
            'a rectangle with no atlas shipped as a promise').toBeUndefined();
        expect(spineManifestContractFrom({ cullingAtlas: ATLAS_REF }, keyOf)).toBeUndefined();
        expect(spineManifestContractFrom({
            cullingBounds: { x: 0, y: 0, width: 0, height: 0 }, cullingAtlas: ATLAS_REF,
        }, keyOf), 'a rectangle of no area shipped as a promise').toBeUndefined();
    });
});

describe('a realm that ships no contracts', () => {
    it('certifies nothing, and nothing may defer', async () => {
        const bare = [{ uuid: SKEL_UUID, path: SKEL_PATH, importer: { scale: 1 } as Record<string, unknown> },
                      { uuid: ATLAS_UUID, path: ATLAS_PATH, importer: {} as Record<string, unknown> }];
        const { era, scope } = await delivered(ATLAS_REF, shippedManifest(bare));
        expect(era!.culling.kind).toBe('unknown');
        scope.releaseAll();
    });
});
