// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// `esengine/minigame` is the family's public entry: it proves a vendor the SDK
// has never heard of can be brought up from a profile literal, with no engine
// edit and no per-vendor backend. The host mocked here is deliberately NOT
// WeChat or Douyin — if any of this needed a name the SDK enumerates, these
// would fail.
import { describe, it, expect, vi } from 'vitest';
import type { MiniGameGlobal } from '../src/platform/minigame/api';
import type { ESEngineModule } from '../src/wasm';

/** A wx-shaped host global for a vendor that does not exist. */
function makeHost() {
    const storage = new Map<string, string>();
    const files = new Map<string, ArrayBuffer>([
        ['data/hello.txt', new TextEncoder().encode('hi').buffer as ArrayBuffer],
    ]);
    return {
        createCanvas: () => ({ width: 0, height: 0, getContext: () => null }),
        createImage: () => ({ width: 3, height: 4, src: '', onload: null, onerror: null }),
        getFileSystemManager: () => ({
            readFileSync: (p: string, encoding?: string) => {
                const f = files.get(p);
                if (!f) throw new Error(`no such file: ${p}`);
                return encoding ? new TextDecoder().decode(f) : f;
            },
            readFile: vi.fn(),
            access: vi.fn(),
            accessSync: (p: string) => {
                if (!files.has(p)) throw new Error('missing');
            },
            writeFile: vi.fn(),
        }),
        request: vi.fn(),
        createInnerAudioContext: () => ({}),
        connectSocket: () => ({}),
        getSystemInfoSync: () => ({ pixelRatio: 3, language: 'fr_FR', windowWidth: 100, windowHeight: 200 }),
        onTouchStart: vi.fn(), onTouchMove: vi.fn(), onTouchEnd: vi.fn(),
        offTouchStart: vi.fn(), offTouchMove: vi.fn(), offTouchEnd: vi.fn(),
        getStorageSync: (k: string) => storage.get(k) ?? '',
        setStorageSync: (k: string, v: string) => void storage.set(k, v),
        removeStorageSync: (k: string) => void storage.delete(k),
        getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
    };
}

describe('esengine/minigame entry', () => {
    // Transforms the whole entry graph (core + webAppFactory + re-exports) on
    // first import — several seconds cold. Room past the 5s default so this
    // measures wiring, not machine contention.
    it('re-exports the family surface + the core SDK', async () => {
        const mg = await import('../src/index.minigame');
        expect(typeof mg.installMiniGamePlatform).toBe('function');
        expect(typeof mg.MiniGamePlatformAdapter).toBe('function');
        expect(typeof mg.initMiniGameRuntime).toBe('function');
        expect(typeof mg.createMiniGameSideModuleHost).toBe('function');
        expect(typeof mg.MiniGameAudioBackend).toBe('function');
        expect(typeof mg.MiniGameSocket).toBe('function');
        // Core + webAppFactory ride along so a game imports everything from here.
        expect(typeof mg.createWebApp).toBe('function');
        expect(typeof mg.App).toBe('function');
    }, 30000);

    it('a three-field profile for an unknown vendor becomes a working platform', async () => {
        const mg = await import('../src/index.minigame');
        const host = makeHost();
        // The whole cost of a vendor: id, label, global. No methods.
        mg.installMiniGamePlatform({
            id: 'acme-play',
            hostLabel: 'ACME Play',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            get global() { return host as any; },
        });

        const platform = await import('../src/platform');
        expect(platform.getPlatformType()).toBe('acme-play');
        // Capability checks are by family, so every mini-game path is live.
        expect(platform.isMiniGame()).toBe(true);
        expect(platform.isWeChat()).toBe(false);
        expect(platform.isWeb()).toBe(false);

        // Capabilities that needed no per-vendor code at all.
        expect(await platform.platformReadTextFile('data/hello.txt')).toBe('hi');
        expect(await platform.platformFileExists('data/hello.txt')).toBe(true);
        expect(await platform.platformFileExists('data/nope.txt')).toBe(false);
        expect(platform.platformDevicePixelRatio()).toBe(3);
        expect(platform.platformLanguage()).toBe('fr-FR');   // underscores normalized
        platform.platformSetStorageItem('save', '{"hp":10}');
        expect(platform.platformGetStorageItem('save')).toBe('{"hp":10}');
        expect(platform.platformCreateCanvas(8, 9).width).toBe(8);
        expect(platform.platformCreateImage().height).toBe(4);
        expect(platform.getPlatform().createAudioBackend().name).toBe('ACME Play');
    }, 30000);

    it.each(['legacy', 'explicit', 'aliased'] as const)('boots with packaged render settings and %s scene paths', async variant => {
        const mg = await import('../src/index.minigame');
        const factory = await import('../src/runtime/webAppFactory');
        const runtime = await import('../src/runtime/runtimeLoader');
        const { setPlatform } = await import('../src/platform');
        const { webAdapter } = await import('../src/platform/web');
        const gl = { getExtension: () => null };
        const host = { ...makeHost(), createCanvas: () => ({ width: 0, height: 0, getContext: () => gl }) };
        const adapter = mg.installMiniGamePlatform({ id: 'acme-play', hostLabel: 'ACME Play', global: host as unknown as MiniGameGlobal });
        const aliased = variant === 'aliased';
        const firstPath = variant === 'legacy' ? 'scenes/Main.json' : 'scene-1.json';
        const nextPath = variant === 'legacy' ? 'scenes/chapter.json/room.json' : 'scene-2.json';
        const sceneFiles = variant !== 'legacy' ? [
            { name: 'Main', path: aliased ? 'scenes/Main.esscene' : firstPath },
            { name: 'chapter.json/room', path: aliased ? 'scenes/Chapter.esscene' : nextPath },
        ] : undefined;
        const groups = aliased ? { main: { bundleMode: 'local', labels: [], assets: {
            '11111111-1111-4111-8111-111111111111': { path: firstPath, address: sceneFiles![0].path, type: 'scene', size: 10, labels: [] },
            '22222222-2222-4222-8222-222222222222': { path: nextPath, address: sceneFiles![1].path, type: 'scene', size: 10, labels: [] },
        } } } : {};
        const readText = vi.spyOn(adapter, 'readTextFile').mockImplementation(async path => {
            if (path === 'asset-manifest.json') return JSON.stringify({ version: '2.0', groups });
            if (path === firstPath) return JSON.stringify({ name: 'Main', entities: [] });
            throw new Error(`Unexpected package path ${path}`);
        });
        const fitted = { width: 2, height: 1, pixels: new Uint8Array(8), sourceWidth: 8, sourceHeight: 4 };
        const decode = vi.spyOn(adapter, 'loadImagePixels').mockResolvedValue(fitted);
        const app = mg.App.new();
        vi.spyOn(app, 'run').mockResolvedValue();
        const create = vi.spyOn(factory, 'createWebApp').mockReturnValue(app);
        const boot = vi.spyOn(runtime, 'initRuntime').mockResolvedValue();
        const module = { GL: { registerContext: () => 1 } } as unknown as ESEngineModule;
        const settings = {
            quality: { mode: 'high', profiles: { high: { textureStreaming: true, textureStreamingStartEdge: 64 } } },
            msaaSamples: 2, outputTransform: 'neutral', asyncCompute: false,
        } as const;
        const project = {
            achievements: ['FIRST_MAP'], physicsEnabled: false, physics3dWorld: { unitsPerMeter: 1 },
            uiTheme: 'dark' as const, uiThemeOverrides: { colors: { primary: { r: 0, g: 1, b: 0, a: 1 } } },
        };
        try {
            await mg.initMiniGameRuntime({ engineFactory: async () => module, engineWasmPath: 'wasm/core.wasm',
                sceneNames: ['Main', 'chapter.json/room'], sceneFiles, firstScene: 'Main', ...settings, ...project });
            expect(create).toHaveBeenCalledWith(module, expect.objectContaining(settings));
            expect(boot.mock.calls[0]![0]).toMatchObject(project);
            expect(readText).toHaveBeenCalledWith(firstPath);
            expect(readText).not.toHaveBeenCalledWith(nextPath);
            expect(boot.mock.calls[0]![0].scenes).toEqual([
                { name: 'Main', data: { name: 'Main', entities: [] } }, { name: 'chapter.json/room', path: nextPath },
            ]);
            expect(await boot.mock.calls[0]![0].source.decodePixels('mesh.png', true, 2)).toBe(fitted);
            expect(decode).toHaveBeenCalledWith('mesh.png', 2);
        } finally { vi.restoreAllMocks(); setPlatform(webAdapter); }
    }, 30000);

    it('initMiniGameRuntime refuses to guess at a host', async () => {
        const mg = await import('../src/index.minigame');
        const { setPlatform } = await import('../src/platform');
        const { webAdapter } = await import('../src/platform/web');
        setPlatform(webAdapter);

        await expect(
            mg.initMiniGameRuntime({
                engineFactory: async () => ({}) as never,
                engineWasmPath: 'wasm/esengine.wasm',
                sceneNames: ['Main'],
                firstScene: 'Main',
            }),
        ).rejects.toThrow(/requires a mini-game platform/);
    }, 30000);
});
