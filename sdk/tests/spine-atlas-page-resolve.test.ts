// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-atlas-page-resolve.test.ts
 * @brief   Regression: a spine atlas names its pages by AUTHORED filename
 *          (`spineboy.png`), but a cook may re-encode the staged file (.ktx2)
 *          or content-address it. The page path must resolve through
 *          `source.resolveRef` like every other fetch, and a KTX2 page must
 *          transcode through the realm's basis provider instead of the image
 *          decoder (which cannot decode KTX2 on any platform).
 */
import { describe, it, expect, vi } from 'vitest';

// The host takes bytes at the GPU boundary while the real atlas loader chooses the decoder.
const { rm, device } = vi.hoisted(() => ({
    device: { connected: true },
    rm: {
        registerTextureWithPath: vi.fn(),
        getTextureGLId: vi.fn(() => 7),
        createTextureFromBytes: vi.fn(() => 11),
        adoptTextureContent: vi.fn(() => true),
        releaseTexture: vi.fn(),
    },
}));
vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => rm,
    getResourceManager: () => device.connected ? rm : null,
}));

import { loadSpineAssets, loadSpineSceneEntities } from '../src/spine/loadSpineScene';
import { SpineManager } from '../src/spine/SpineManager';
import { textureRefill } from '../src/wasm/textureRefill';
import { loadDragonBonesAssets, loadDragonBonesSceneEntities } from '../src/dragonbones/loadDragonBonesScene';
import { DragonBonesManager } from '../src/dragonbones/DragonBonesManager';
import { releaseUnusedAtlases } from '../src/dragonbones/atlasOwnership';
import { SpineAssetLoader } from '../src/asset/loaders/SpineAssetLoader';
import { Catalog } from '../src/asset/Catalog';
import type { RuntimeAssetSource } from '../src/runtime/runtimeAssets';
import type { SceneData } from '../src/scene/scene';
import type { Entity } from '../src/types';
import type { BasisTranscoder } from '../src/asset/compressed';

const ATLAS = 'spineboy.png\nsize: 4,4\nformat: RGBA8888\n';

function makeSource(resolved: Record<string, string>): RuntimeAssetSource & {
    decodePixels: ReturnType<typeof vi.fn>;
    fetchedBinaries: string[];
} {
    const fetchedBinaries: string[] = [];
    return {
        backend: {
            fetchText: vi.fn(async () => ATLAS),
            fetchBinary: vi.fn(async (p: string) => {
                fetchedBinaries.push(p);
                return new Uint8Array([1, 2, 3]).buffer;
            }),
        } as never,
        decodePixels: vi.fn(async () => ({ width: 4, height: 4, pixels: new Uint8Array(64) })),
        resolveRef: (r: string) => resolved[r] ?? r,
        fetchedBinaries,
    };
}

const PAIR = [{ skeleton: 'assets/spine/boy.skel', atlas: 'assets/spine/boy.atlas' }];

it.each(['SpineAnimation', 'DragonBonesAnimation'])('releases a late atlas when %s quits during decode', async type => {
    const spine = new SpineManager({} as never, new Map());
    const dragon = new DragonBonesManager({} as never);
    const bindSpine = vi.spyOn(spine, 'loadEntity'), bindDragon = vi.spyOn(dragon, 'loadSkeleton');
    const source = makeSource({});
    const isSpine = type === 'SpineAnimation';
    const skeletonPath = 'assets/late/hero.json', atlasPath = isSpine ? 'assets/late/hero.atlas' : 'assets/late/hero_tex.json';
    source.backend.fetchText = async path => path === skeletonPath ? '{"skeleton":{"spine":"4.2"}}'
        : isSpine ? ATLAS : '{"imagePath":"page.png"}';
    const sceneData: SceneData = { version: 1, name: 'preview', entities: [{
        id: 1, name: 'character', parent: null, children: [],
        components: [{ type, data: { skeletonPath, atlasPath } }],
    }] };
    const entityMap = new Map([[1, 7 as Entity]]);
    let finish!: () => void, decoding!: () => void;
    const started = new Promise<void>(resolve => { decoding = resolve; });
    const wait = new Promise<void>(resolve => { finish = resolve; });
    source.decodePixels.mockImplementationOnce(async () => {
        decoding();
        await wait;
        return { width: 4, height: 4, pixels: new Uint8Array(64) };
    });
    rm.createTextureFromBytes.mockReturnValueOnce(116);
    rm.releaseTexture.mockClear();
    const options = { sceneData, entityMap, module: null, source };
    const pending = isSpine ? loadSpineSceneEntities({ ...options, spineManager: spine, registry: {} as never })
        : loadDragonBonesSceneEntities({ ...options, manager: dragon });
    await Promise.race([started, pending.then(() => { throw new Error('scene skipped atlas decode'); })]);
    (isSpine ? spine : dragon).dispose();
    finish();
    await pending;
    expect(bindSpine).not.toHaveBeenCalled();
    expect(bindDragon).not.toHaveBeenCalled();
    expect(rm.releaseTexture.mock.calls).toEqual([[116]]);
});

async function readAndRelease(...args: Parameters<typeof loadSpineAssets>) {
    const info = await loadSpineAssets(...args);
    for (const pair of info.values()) pair.preparation?.release();
}

describe('loadSpineAssets resolves atlas page paths through the manifest', () => {
    it('transcodes a KTX2-staged page and binds it under the authored page name', async () => {
        const source = makeSource({ 'assets/spine/spineboy.png': 'assets/spine/spineboy.ktx2' });
        const transcoder: BasisTranscoder = {
            transcode: vi.fn(() => null),
            transcodeToRgba: vi.fn(() => ({ width: 2, height: 2, data: new Uint8Array(16) })),
        };
        const info = await loadSpineAssets({} as never, source, null, PAIR, async () => transcoder);

        expect(source.decodePixels).not.toHaveBeenCalled();
        expect(source.fetchedBinaries).toContain('assets/spine/spineboy.ktx2');
        expect(transcoder.transcodeToRgba).toHaveBeenCalledTimes(1);
        const tex = info.get('assets/spine/boy.skel:assets/spine/boy.atlas')!.era.value.textures.get('spineboy.png');
        expect(tex).toEqual({ glId: 7, w: 2, h: 2 });
        for (const pair of info.values()) pair.preparation?.release();
    });

    it('recognizes the WeChat .ktx2.bin staging spelling as KTX2', async () => {
        const source = makeSource({ 'assets/spine/spineboy.png': 'assets/spine/spineboy.ktx2.bin' });
        const transcoder: BasisTranscoder = {
            transcode: vi.fn(() => null),
            transcodeToRgba: vi.fn(() => ({ width: 2, height: 2, data: new Uint8Array(16) })),
        };
        await readAndRelease({} as never, source, null, PAIR, async () => transcoder);
        expect(source.decodePixels).not.toHaveBeenCalled();
        expect(transcoder.transcodeToRgba).toHaveBeenCalledTimes(1);
    });

    it('decodes a content-addressed page from its STAGED path', async () => {
        const source = makeSource({ 'assets/spine/spineboy.png': 'assets/1234abcd.png' });
        await readAndRelease({} as never, source, null, PAIR);
        expect(source.decodePixels).toHaveBeenCalledWith('assets/1234abcd.png', false);
    });

    it('derives the page dir from a @uuid atlas ref resolved to its PATH (playable)', async () => {
        // The playable resolveRef expands @uuid → logical source path; the page
        // path must come from THAT resolved dir, not the bare @uuid (which gave an
        // empty dir → "/spineboy.png" → ERR_FILE_NOT_FOUND).
        const source = makeSource({
            '@uuid:skel': 'assets/spine/boy.skel',
            '@uuid:atlas': 'assets/spine/boy.atlas',
        });
        await readAndRelease({} as never, source, null, [{ skeleton: '@uuid:skel', atlas: '@uuid:atlas' }]);
        expect(source.decodePixels).toHaveBeenCalledWith('assets/spine/spineboy.png', false);
    });

    it('a dirless atlas path yields the bare page name, never a leading slash', async () => {
        const source = makeSource({});
        await readAndRelease({} as never, source, null, [{ skeleton: 'boy.skel', atlas: 'boy.atlas' }]);
        expect(source.decodePixels).toHaveBeenCalledWith('spineboy.png', false);
    });

    // A device has no wasm transcoder and never will; its host decodes KTX2 in C++.
    // Asking for the transcoder there is what left every Spine atlas unloadable.
    it('takes a KTX2 page from the ResourceManager when it can decode one', async () => {
        const source = makeSource({ 'assets/spine/spineboy.png': 'assets/spine/spineboy.ktx2' });
        const createTextureFromKTX2 = vi.fn(() => ({ handle: 21, width: 8, height: 8 }));
        Object.assign(rm, { createTextureFromKTX2 });
        try {
            const info = await loadSpineAssets({} as never, source, null, PAIR);

            expect(createTextureFromKTX2).toHaveBeenCalledTimes(1);
            expect(source.decodePixels).not.toHaveBeenCalled();
            const tex = info.get('assets/spine/boy.skel:assets/spine/boy.atlas')!.era.value.textures.get('spineboy.png');
            expect(tex).toEqual({ glId: 7, w: 8, h: 8 });
            for (const pair of info.values()) pair.preparation?.release();
        } finally {
            delete (rm as { createTextureFromKTX2?: unknown }).createTextureFromKTX2;
        }
    });

    it('a KTX2 page in a realm without basis warns and skips, not throws', async () => {
        const source = makeSource({ 'assets/spine/spineboy.png': 'assets/spine/spineboy.ktx2' });
        const info = await loadSpineAssets({} as never, source, null, PAIR, async () => null);
        expect(info.get('assets/spine/boy.skel:assets/spine/boy.atlas')!.era.value.textures.size).toBe(0);
    });
});

describe('standalone atlas ownership', () => {
    it('discards pixels decoded after their resource manager was retired', async () => {
        const source = makeSource({});
        source.decodePixels.mockImplementationOnce(async () => {
            device.connected = false;
            return { width: 4, height: 4, pixels: new Uint8Array(64) };
        });
        rm.createTextureFromBytes.mockClear();
        rm.releaseTexture.mockClear();
        try {
            const info = await loadSpineAssets(null, source, null, PAIR);
            const pair = [...info.values()][0]!;
            expect(pair.era.value.textures.size).toBe(0);
            pair.preparation!.release();
            expect(rm.createTextureFromBytes).not.toHaveBeenCalled();
            expect(rm.releaseTexture).not.toHaveBeenCalled();
        } finally { device.connected = true; }
    });

    it('shares one page across a batch and releases it after the last live skeleton', async () => {
        const source = makeSource({});
        rm.releaseTexture.mockClear();
        rm.createTextureFromBytes.mockReturnValueOnce(101);
        const another = { skeleton: 'assets/spine/other.skel', atlas: PAIR[0]!.atlas };
        const info = await loadSpineAssets(null, source, null, [...PAIR, another, another]);
        const [first, second] = [...info.values()];
        expect(info.size).toBe(2);
        expect(source.decodePixels).toHaveBeenCalledTimes(1);
        const retained = first!.era.retain()!;
        first!.preparation!.release(); first!.preparation!.release();
        const joined = first!.era.retain()!;
        retained.release(); joined.release();
        expect(first!.era.retain()).toBeNull();
        expect(rm.releaseTexture).not.toHaveBeenCalled();
        expect(textureRefill(101)).toBeDefined();
        second!.preparation!.release();
        expect(textureRefill(101)).toBeUndefined();
        expect(rm.releaseTexture.mock.calls).toEqual([[101]]);
    });

    it('gives back an uploaded page when reading the skeleton fails', async () => {
        const source = makeSource({});
        source.backend.fetchBinary = async () => { throw Error('skeleton missing'); };
        rm.releaseTexture.mockClear();
        rm.createTextureFromBytes.mockReturnValueOnce(102);
        const info = await loadSpineAssets(null, source, null, PAIR);
        expect(info.size).toBe(0);
        expect(rm.releaseTexture.mock.calls).toEqual([[102]]);
        expect(textureRefill(102)).toBeUndefined();
    });

    it.each(['spine', 'dragonbones'])('releases the %s atlas if its progress observer rejects the batch', async kind => {
        const source = makeSource({});
        const refused = new Error('pair refused'), notify = vi.fn(() => { throw refused; });
        rm.releaseTexture.mockClear(); rm.createTextureFromBytes.mockReturnValueOnce(105);
        if (kind === 'dragonbones') source.backend.fetchText = async () => '{"imagePath":"page.png"}';
        const pending = kind === 'spine' ? loadSpineAssets(null, source, null, PAIR, undefined, undefined, notify)
            : loadDragonBonesAssets(null, source, PAIR, undefined, undefined, undefined, notify);
        await expect(pending).rejects.toBe(refused);
        expect(notify).toHaveBeenCalledOnce();
        expect(rm.releaseTexture.mock.calls).toEqual([[105]]);
        expect(textureRefill(105)).toBeUndefined();
    });

    it('retires a DragonBones refill while its image decode is in flight', async () => {
        const source = makeSource({});
        source.backend.fetchText = async () => '{"imagePath":"page.png"}';
        rm.createTextureFromBytes.mockReturnValueOnce(103).mockReturnValueOnce(104);
        rm.releaseTexture.mockClear(); rm.adoptTextureContent.mockClear();
        const info = await loadDragonBonesAssets(null, source, PAIR);
        const refill = textureRefill(103)!;
        let finish!: () => void;
        source.decodePixels.mockImplementationOnce(async () => {
            await new Promise<void>(resolve => { finish = resolve; });
            return { width: 4, height: 4, pixels: new Uint8Array(64) };
        });
        const pending = refill();
        releaseUnusedAtlases(info.values());
        finish();
        expect(await pending).toBe(false);
        expect(await refill()).toBe(false);
        expect(rm.releaseTexture.mock.calls).toEqual([[103], [104]]);
        expect(rm.adoptTextureContent).not.toHaveBeenCalled();
        expect(rm.registerTextureWithPath).not.toHaveBeenCalled();
    });
});

/**
 * The SAME question of the OTHER door. A registry acquisition goes through
 * SpineAssetLoader, which resolved page siblings against the STAGED directory —
 * so every spine in a content-addressed build drew nothing.
 */
describe('SpineAssetLoader page paths', () => {
    /** A pack as staging leaves it: every asset a hash under one flat directory,
     *  addressable by the path it was authored at. */
    function stagedCatalog() {
        return Catalog.fromJson({
            version: 1,
            entries: {
                'assets/spine/boy.atlas': { type: 'spine', buildPath: 'assets/079064052ce23797.atlas' },
                'assets/spine/boy.skel': { type: 'spine', buildPath: 'assets/2f68d725077a3ab0.skel' },
                'assets/spine/spineboy.png': { type: 'texture', buildPath: 'assets/97fac9903b799107.png' },
            },
        });
    }

    function ctxOver(catalog: Catalog, acquired: string[]) {
        return {
            catalog,
            resourceManager: rm,
            loadText: async () => ATLAS,
            loadBinary: async () => new Uint8Array([1, 2, 3]).buffer,
            acquireTexture: async (path: string) => {
                acquired.push(path);
                return { value: { handle: 5, width: 8, height: 8 } };
            },
        } as never;
    }

    it('names a page where the atlas was AUTHORED, not where staging put it', async () => {
        const acquired: string[] = [];
        await new SpineAssetLoader().prepare(
            'assets/2f68d725077a3ab0.skel', 'assets/079064052ce23797.atlas',
            ctxOver(stagedCatalog(), acquired),
        );
        expect(acquired).toEqual(['assets/spine/spineboy.png']);
    });

    it('falls back to the ref itself when nothing staged it', async () => {
        // Editor and dev realms hand over authored paths and carry no catalog.
        const acquired: string[] = [];
        await new SpineAssetLoader().prepare(
            'assets/spine/boy.skel', 'assets/spine/boy.atlas',
            ctxOver(Catalog.empty(), acquired),
        );
        expect(acquired).toEqual(['assets/spine/spineboy.png']);
    });
});
