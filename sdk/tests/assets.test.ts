// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { AssetRefCounter } from '../src/asset/AssetRefCounter';
import { registerComponent } from '../src/ecs/component';
import { Animator } from '../src/animation/Animator';
import { SpriteAnimator } from '../src/animation/SpriteAnimator';
import { TimelinePlayer } from '../src/timeline/TimelinePlayerComponent';
import { Terrain } from '../src/terrain/terrainPlugin';
import { discoverSceneAssets } from '../src/asset/discoverAssets';
import { AnimatorControllerAssetLoader } from '../src/asset/loaders/AnimatorControllerAssetLoader';
import { TimelineAssetLoader } from '../src/asset/loaders/TimelineAssetLoader';
import { Catalog, type CatalogData } from '../src/asset/Catalog';
import type { Backend } from '../src/asset/Backend';
import type { AssetLoader, LoadContext } from '../src/asset/AssetLoader';
import type { SceneData } from '../src/scene/scene';

const mockModule = {
    _malloc: vi.fn(() => 0),
    _free: vi.fn(),
    HEAPU8: new Uint8Array(1024),
    GL: null,
    FS: null,
} as any;

vi.mock('../src/wasm/resourceManager', async original => ({
    ...await original<typeof import('../src/wasm/resourceManager')>(),
    requireResourceManager: () => ({
        createTexture: vi.fn(() => 42),
        registerExternalTexture: vi.fn(() => 42),
        releaseTexture: vi.fn(),
        releaseBitmapFont: vi.fn(),
        getTextureGLId: vi.fn(() => 1),
        registerTextureWithPath: vi.fn(),
        getTextureDimensions: vi.fn(() => ({ width: 64, height: 64 })),
    }),
    evictTextureDimensions: vi.fn(),
}));

vi.mock('../src/platform', () => ({
    platformCreateCanvas: () => {
        const canvas = {
            width: 256, height: 256,
            getContext: () => ({
                clearRect: vi.fn(),
                drawImage: vi.fn(),
                getImageData: () => ({
                    data: { buffer: new ArrayBuffer(256 * 256 * 4) },
                }),
            }),
        };
        return canvas;
    },
    platformCreateImage: () => {
        const img: any = {};
        setTimeout(() => { img.width = 64; img.height = 64; img.onload?.(); }, 0);
        return img;
    },
    platformFetch: vi.fn(),
    platformReadFile: vi.fn(),
    platformReadTextFile: vi.fn(),
    platformFileExists: vi.fn(),
}));

function createMockBackend(): Backend {
    return {
        fetchBinary: vi.fn(async () => new ArrayBuffer(8)),
        fetchText: vi.fn(async () => '{}'),
        resolveUrl: vi.fn((path: string) => `http://test/${path}`),
    };
}

const catalogData: CatalogData = {
    version: 1,
    entries: {
        'sprites/hero.png': {
            type: 'texture',
            atlas: 'atlas_0.png',
            frame: { x: 0, y: 0, w: 64, h: 64 },
            uv: { offset: [0, 0], scale: [0.5, 0.5] },
        },
        'sprites/bg.png': { type: 'texture' },
    },
    addresses: {
        'hero': 'sprites/hero.png',
    },
    labels: {
        'icons': ['sprites/hero.png', 'sprites/bg.png'],
    },
};

describe('Assets', () => {
    let assets: Assets;
    let backend: Backend;

    beforeEach(() => {
        backend = createMockBackend();
        assets = Assets.create({
            backend,
            catalog: Catalog.fromJson(catalogData),
            module: mockModule,
        });
    });

    it('creates instance with catalog', () => {
        expect(assets.catalog).toBeDefined();
        // Wrapped to read packed assets; everything else goes to the given backend.
        expect(assets.backend.resolveUrl('a/b.png')).toBe(backend.resolveUrl('a/b.png'));
    });

    it('creates instance with empty catalog', () => {
        const a = Assets.create({ backend, module: mockModule });
        expect(a.catalog.isEmpty).toBe(true);
    });

    it('resolves address in getAtlasFrame', () => {
        const frame = assets.getAtlasFrame('hero');
        expect(frame).not.toBeNull();
        expect(frame!.atlas).toBe('atlas_0.png');
        expect(frame!.uvOffset).toEqual([0, 0]);
    });

    it('returns null atlas frame for non-atlas texture', () => {
        expect(assets.getAtlasFrame('sprites/bg.png')).toBeNull();
    });

    describe('custom loader', () => {
        interface CustomData { value: string }

        const customLoader: AssetLoader<CustomData> = {
            type: 'custom',
            extensions: ['.custom'],
            load: vi.fn(async (_path: string, ctx: LoadContext) => {
                const text = await ctx.loadText(_path);
                return { value: text };
            }),
            unload: vi.fn(),
        };

        it('registers and loads custom type', async () => {
            (backend.fetchText as any).mockResolvedValue('hello custom');
            assets.register(customLoader);
            const result = await assets.load<CustomData>('custom', 'data/test.custom');
            expect(result.value).toBe('hello custom');
        });

        it('throws for unregistered type', async () => {
            await expect(assets.load('unknown', 'foo')).rejects.toThrow('No loader registered');
        });
    });

    describe('fetchJson', () => {
        it('fetches and parses JSON', async () => {
            (backend.fetchText as any).mockResolvedValue('{"key": "value"}');
            const result = await assets.fetchJson<{ key: string }>('config.json');
            expect(result.key).toBe('value');
        });
    });
});

it('keeps registered scene names with a resolver that rejects unknown files', async () => {
    for (const definition of [Animator, SpriteAnimator, TimelinePlayer]) registerComponent(definition._name, definition);
    const backend = createMockBackend();
    const assets = Assets.create({ backend, module: mockModule });
    assets.setAssetRefResolver(() => null);
    const components = [
        { type: 'Animator', data: { controller: 'actors.patrol' } },
        { type: 'SpriteAnimator', data: { clip: 'moves/walk' } },
        { type: 'TimelinePlayer', data: { timeline: 'stage.turn' } },
    ];
    const scene: SceneData = { version: '1.0', name: 'Names', entities: [{
        id: 1, name: 'Actor', parent: null, children: [], components: structuredClone(components),
    }] };
    const result = await assets.preloadSceneAssets(scene);
    try {
        expect(result.missing).toEqual([]);
        assets.resolveSceneAssetPaths(scene, result);
        expect(scene.entities[0].components).toEqual(components);
        expect(backend.fetchText).not.toHaveBeenCalled();
    } finally { result.scope.releaseAll(); }
});

it('discovers and resolves a tiled terrain document without eagerly fetching it', async () => {
    registerComponent(Terrain._name, Terrain);
    const backend = createMockBackend();
    const assets = Assets.create({ backend, module: mockModule });
    const uuid = '@uuid:11111111-1111-4111-8111-111111111111';
    const path = 'assets/terrain/ground.esterrain';
    const resolve = (ref: string) => ref === uuid ? path : ref;
    assets.setAssetRefResolver(resolve);
    const scene: SceneData = { version: '1.0', name: 'Tiles', entities: [{
        id: 1, name: 'Ground', parent: null, children: [], components: [{ type: 'Terrain', data: { tiles: uuid } }],
    }] };
    expect(discoverSceneAssets(scene, resolve).byType.get('terrain-tiles')).toContain(path);
    const result = await assets.preloadSceneAssets(scene);
    try {
        expect(result.missing).toEqual([]);
        assets.resolveSceneAssetPaths(scene, result);
        expect(scene.entities[0]?.components[0]?.data.tiles).toBe(path);
        expect(backend.fetchText).not.toHaveBeenCalled();
    } finally { result.scope.releaseAll(); }
});

it('loads extensionless scene and controller files from a host project index', async () => {
    registerComponent('Animator', Animator);
    const backend = createMockBackend();
    const files = new Map([
        ['Hero/States', 'animatorcontroller'], ['Hero/Turn', 'animation'], ['Hero/Game.Play', 'material'],
    ]);
    vi.mocked(backend.fetchText).mockImplementation(async path => {
        if (path.endsWith('Hero/Turn')) return JSON.stringify({ version: 1, name: 'Turn', duration: 1, tracks: [] });
        if (!path.endsWith('Hero/States')) throw new Error('Unexpected file: ' + path);
        return JSON.stringify({ parameters: [], initialState: 'Idle', states: [
            { name: 'Idle', transitions: [], motion: { kind: 'timeline', clip: 'Game.Play' } },
            { name: 'Turn', transitions: [], motion: { kind: 'timeline', clip: 'Turn' } },
        ] });
    });
    const assets = Assets.create({ backend, module: mockModule });
    assets.register(new AnimatorControllerAssetLoader());
    assets.register(new TimelineAssetLoader());
    assets.setAssetRefResolver(ref => files.has(ref) ? ref : null, ref => files.get(ref));
    const scene: SceneData = { version: '1.0', name: 'Host', entities: [{
        id: 1, name: 'Actor', parent: null, children: [], components: [{ type: 'Animator', data: { controller: 'Hero/States' } }],
    }] };
    const result = await assets.preloadSceneAssets(scene);
    try {
        expect(result.missing).toEqual([]);
        expect(vi.mocked(backend.fetchText).mock.calls.map(([path]) => path.split('/').pop())).toEqual(['States', 'Turn']);
    } finally { result.scope.releaseAll(); }
});

describe('Assets: mesh references in a scene', () => {
    it.each(['MeshRenderer', 'Mesh2D'])('preloads mesh and material refs from %s and binds their handles', async type => {
        const backend = createMockBackend();
        const assets = Assets.create({ backend, module: mockModule });
        const counter = new AssetRefCounter();
        assets.setRefCounter(counter);

        assets.register({
            type: 'mesh',
            extensions: ['.esmesh'],
            load: async () => ({ handle: 77 }),
            unload: () => {},
        } as unknown as AssetLoader<{ handle: number }>);
        assets.register({ type: 'material', extensions: ['.esmaterial'], load: async () => ({ handle: 91 }) });

        const scene = {
            version: '1.0', name: 'meshscene',
            entities: [{
                id: 1, name: 'e1', parent: null, children: [],
                components: [{ type, data: { mesh: 'ship.esmesh', material: 'hull.esmaterial' } }],
            }],
        } as unknown as SceneData;

        const result = await assets.preloadSceneAssets(scene);
        try {
            expect(result.meshHandles.get('ship.esmesh')).toBe(77);
            expect(result.materialHandles.get('hull.esmaterial')).toBe(91);
            assets.resolveSceneAssetPaths(scene, result);
            expect(scene.entities[0]!.components[0]).toEqual({ type, data: { mesh: 77, material: 91 } });
            assets.trackSceneAssetReferences(scene, new Map([[1, 5]]));
            expect(counter.getMaterialRefs('hull.esmaterial')).toEqual([5]);
        } finally { result.scope.releaseAll(); }
    });
});
