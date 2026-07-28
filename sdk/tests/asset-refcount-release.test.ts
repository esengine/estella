// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    asset-refcount-release.test.ts
 * @brief   Generic-cache reference counting + group lifecycle symmetry:
 *          every load*() needs a matching release*(), an asset shared by two
 *          holders survives the first release, released audio revives from
 *          the AudioAPI warm cache without a re-fetch, and releaseGroup is
 *          the symmetric other half of loadGroup.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { AudioAPI } from '../src/audio/Audio';
import type { Backend } from '../src/asset/Backend';
import type { AddressableManifest } from '../src/asset/AddressableManifest';
import type { PlatformAudioBackend, AudioBufferHandle, AudioHandle } from '../src/audio/PlatformAudioBackend';

vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => ({
        createTexture: vi.fn(() => 42),
        registerExternalTexture: vi.fn(() => 42),
        releaseTexture: vi.fn(),
        getTextureGLId: vi.fn(() => 1),
        registerTextureWithPath: vi.fn(),
        acquireTextureByPath: vi.fn(() => 0),
        invalidateTexturePath: vi.fn(() => false),
        getTextureDimensions: vi.fn(() => ({ width: 64, height: 64 })),
    }),
    getResourceManager: () => null,
    evictTextureDimensions: vi.fn(),
}));

vi.mock('../src/platform', () => ({
    platformCreateCanvas: vi.fn(),
    platformCreateImage: vi.fn(),
    platformFetch: vi.fn(),
    platformReadFile: vi.fn(),
    platformReadTextFile: vi.fn(),
    platformFileExists: vi.fn(),
    platformLoadSubpackage: vi.fn(async () => {}),
}));

interface MockAudioBackend extends PlatformAudioBackend {
    decodes: string[];
    unloaded: number[];
}

function createAudioBackend(): MockAudioBackend {
    let nextId = 0;
    const playHandle: AudioHandle = {
        id: 0, stop() {}, pause() {}, resume() {},
        setVolume() {}, setPan() {}, setLoop() {}, setPlaybackRate() {},
        isPlaying: false, currentTime: 0, duration: 1,
    };
    const backend: MockAudioBackend = {
        name: 'mock', mixer: null, isReady: true,
        decodes: [], unloaded: [],
        initialize: async () => {},
        ensureResumed: async () => {},
        loadBuffer: async (url: string): Promise<AudioBufferHandle> => {
            backend.decodes.push(url);
            return { id: ++nextId, duration: 1, bytes: 100 };
        },
        loadBufferFromData: async (url: string): Promise<AudioBufferHandle> => {
            backend.decodes.push(url);
            return { id: ++nextId, duration: 1, bytes: 100 };
        },
        unloadBuffer: (handle: AudioBufferHandle) => { backend.unloaded.push(handle.id); },
        play: () => playHandle,
        suspend() {}, resume() {}, dispose() {},
    };
    return backend;
}

const mockModule = {
    _malloc: vi.fn(() => 0),
    _free: vi.fn(),
    HEAPU8: new Uint8Array(1024),
    GL: null,
    FS: null,
} as never;

const AUDIO = 'sfx/coin.mp3';

describe('generic-cache refcounts + releaseGroup', () => {
    let assets: Assets;
    let audioBackend: MockAudioBackend;
    let audio: AudioAPI;
    let fetchBinary: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        audioBackend = createAudioBackend();
        audio = new AudioAPI(audioBackend);
        audio.setBufferBudget(1024 * 1024);
        fetchBinary = vi.fn(async () => new ArrayBuffer(8));
        const backend: Backend = {
            fetchBinary,
            fetchText: vi.fn(async () => '{}'),
            resolveUrl: (path: string) => `http://test/${path}`,
        } as unknown as Backend;
        assets = Assets.create({ backend, module: mockModule, getAudio: () => audio });
    });

    it('an asset loaded by two holders survives the first release', async () => {
        await assets.loadAudio(AUDIO);   // holder 1 (e.g. scene A)
        await assets.loadAudio(AUDIO);   // holder 2 (e.g. additive scene B)
        expect(audioBackend.decodes).toHaveLength(1);   // one decode, shared

        assets.releaseAudio(AUDIO);      // scene A unloads
        expect(audio.getBufferStats().evictableCount).toBe(0);  // still pinned by B

        assets.releaseAudio(AUDIO);      // scene B unloads
        expect(audio.getBufferStats().evictableCount).toBe(1);  // now warm cache
        expect(audioBackend.unloaded).toEqual([]);              // retained, not freed
    });

    it('a released audio buffer revives from the warm cache without re-fetching', async () => {
        await assets.loadAudio(AUDIO);
        assets.releaseAudio(AUDIO);
        expect(audio.getBufferStats().evictableCount).toBe(1);

        await assets.loadAudio(AUDIO);   // revive: no network, no decode
        expect(fetchBinary).toHaveBeenCalledTimes(1);
        expect(audioBackend.decodes).toHaveLength(1);
        expect(audio.getBufferStats().evictableCount).toBe(0);  // held again
    });

    it('invalidate severs the audio residency so a fresh load re-fetches', async () => {
        await assets.loadAudio(AUDIO);
        assets.releaseAudio(AUDIO);

        expect(assets.invalidate(AUDIO)).toBe(true);
        expect(audioBackend.unloaded).toHaveLength(1);   // stale buffer dropped

        await assets.loadAudio(AUDIO);
        expect(fetchBinary).toHaveBeenCalledTimes(2);
        expect(audioBackend.decodes).toHaveLength(2);
    });

    it('releaseGroup mirrors loadGroup through the same typed release channels', async () => {
        const manifest: AddressableManifest = {
            version: '2.0',
            groups: {
                sfx: {
                    bundleMode: 'local',
                    labels: [],
                    assets: {
                        [AUDIO]: { path: AUDIO, type: 'audio', size: 8, labels: [] },
                    },
                },
            },
        };
        assets.setManifest(manifest);

        await assets.loadGroup('sfx');
        expect(audioBackend.decodes).toHaveLength(1);
        expect(audio.getBufferStats().evictableCount).toBe(0);  // group holds it

        assets.releaseGroup('sfx');
        expect(audio.getBufferStats().evictableCount).toBe(1);  // warm cache
        expect(audioBackend.unloaded).toEqual([]);

        // Bouncing back into the area: revived, not re-downloaded.
        await assets.loadGroup('sfx');
        expect(fetchBinary).toHaveBeenCalledTimes(1);
        expect(audioBackend.decodes).toHaveLength(1);
    });

    it('releaseGroup without a manifest is a warning no-op', () => {
        expect(() => assets.releaseGroup('nope')).not.toThrow();
    });
});
