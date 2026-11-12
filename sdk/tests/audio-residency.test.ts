// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    audio-residency.test.ts
 * @brief   AudioAPI buffer residency: the audio mirror of the texture pool's
 *          held → evictable → evicted lifecycle. Retain/release, byte-budgeted
 *          LRU eviction (with access refreshing recency), hot-reload
 *          invalidation, and the memory-pressure trim.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioAPI } from '../src/audio/Audio';
import { log } from '../src/util/logger';
import { Assets } from '../src/asset/Assets';
import type { Backend } from '../src/asset/Backend';
import type { PlatformAudioBackend, AudioBufferHandle, AudioHandle } from '../src/audio/PlatformAudioBackend';

vi.mock('../src/wasm/resourceManager', () => ({
    requireResourceManager: () => ({}), getResourceManager: () => null,
    evictTextureDimensions: vi.fn(),
}));

interface MockBackend extends PlatformAudioBackend {
    loads: string[];
    unloaded: number[];
}

function createMockBackend(bytesPerBuffer = 100): MockBackend {
    let nextId = 0;
    const playHandle: AudioHandle = {
        id: 0,
        stop() {}, pause() {}, resume() {},
        setVolume() {}, setPan() {}, setLoop() {}, setPlaybackRate() {},
        isPlaying: false, currentTime: 0, duration: 1,
    };
    const backend: MockBackend = {
        name: 'mock',
        delivery: 'bytes',
        mixer: null,
        isReady: true,
        loads: [],
        unloaded: [],
        initialize: async () => {},
        ensureResumed: async () => {},
        loadBuffer: async (url: string): Promise<AudioBufferHandle> => {
            backend.loads.push(url);
            return { id: ++nextId, duration: 1, bytes: bytesPerBuffer };
        },
        loadBufferFromData: async (url: string): Promise<AudioBufferHandle> => {
            backend.loads.push(url);
            return { id: ++nextId, duration: 1, bytes: bytesPerBuffer };
        },
        unloadBuffer: (handle: AudioBufferHandle) => { backend.unloaded.push(handle.id); },
        play: () => playHandle,
        suspend() {}, resume() {}, dispose() {},
    };
    return backend;
}

vi.mock('../src/platform', () => ({
    platformCreateCanvas: vi.fn(),
    platformCreateImage: vi.fn(),
    platformFetch: vi.fn(),
    platformReadFile: vi.fn(),
    platformReadTextFile: vi.fn(),
    platformFileExists: vi.fn(),
}));

describe('AudioAPI buffer residency', () => {
    let backend: MockBackend;
    let audio: AudioAPI;

    beforeEach(() => {
        backend = createMockBackend();
        audio = new AudioAPI(backend);
        audio.setBufferBudget(1000);
    });

    function sharedSource() {
        let loaded = false;
        const handle: AudioBufferHandle = { id: 77, duration: 1, bytes: 100 };
        backend.loadBuffer = vi.fn(async () => { loaded = true; return handle; });
        backend.unloadBuffer = vi.fn(() => { loaded = false; });
        const play = backend.play;
        backend.play = vi.fn((buffer, config) => {
            if (!loaded) throw new Error('Shared buffer already unloaded');
            return play(buffer, config);
        });
        audio.setRefResolver(() => 'physical/shared.wav');
        audio.setBufferBudget(0);
        return handle;
    }

    it('keeps a shared physical buffer alive until both authored references release it', async () => {
        sharedSource();
        await audio.preload('alias-a'); audio.retainBuffer('alias-a');
        await audio.preload('alias-b'); audio.retainBuffer('alias-b');
        audio.releaseBuffer('alias-a');
        expect(() => audio.playSFX('alias-b')).not.toThrow();
        expect(backend.unloadBuffer).not.toHaveBeenCalled();
        audio.releaseBuffer('alias-a'); // already released; cannot spend B's hold
        expect(backend.unloadBuffer).not.toHaveBeenCalled();
        audio.releaseBuffer('alias-b');
        expect(backend.unloadBuffer).toHaveBeenCalledOnce();
    });

    it('counts shared decoded bytes once while keeping each authored hold separate', async () => {
        sharedSource();
        await audio.preload('alias-a'); audio.retainBuffer('alias-a');
        await audio.preload('alias-b'); audio.retainBuffer('alias-b');
        expect(audio.getBufferStats().bufferBytes).toBe(100);
        audio.releaseBuffer('alias-a');
        expect(audio.getBufferStats().bufferBytes).toBe(100);
        audio.releaseBuffer('alias-b');
        expect(audio.getBufferStats().bufferBytes).toBe(0);
    });

    it('invalidates every cached alias of the changed physical source', async () => {
        sharedSource();
        await audio.preload('alias-a'); audio.retainBuffer('alias-a');
        await audio.preload('alias-b'); audio.retainBuffer('alias-b');
        expect(audio.invalidateBuffer('alias-a')).toBe(true);
        expect(audio.getBufferHandle('alias-a')).toBeUndefined();
        expect(audio.getBufferHandle('alias-b')).toBeUndefined();
        expect(backend.unloadBuffer).toHaveBeenCalledOnce();
    });

    it('trims shared warm entries with one physical unload and one freed-buffer count', async () => {
        sharedSource();
        audio.setBufferBudget(1000);
        await audio.preload('alias-a');
        await audio.preload('alias-b');
        expect(audio.getBufferStats()).toMatchObject({ bufferCount: 2, bufferBytes: 100, evictableCount: 2 });
        expect(audio.trimBufferCache()).toBe(1);
        expect(backend.unloadBuffer).toHaveBeenCalledOnce();
        expect(audio.getBufferStats()).toMatchObject({ bufferCount: 0, bufferBytes: 0, evictableCount: 0 });
    });

    it('coalesces concurrent aliases and retires their invalidated result once', async () => {
        audio.setRefResolver(() => 'shared.wav');
        const finish: Array<(buffer: AudioBufferHandle) => void> = [];
        backend.loadBufferFromData = vi.fn(() => new Promise<AudioBufferHandle>(resolve => { finish.push(resolve); }));
        const a = audio.preloadFromData('a', new ArrayBuffer(8));
        const b = audio.preloadFromData('b', new ArrayBuffer(8));
        expect(backend.loadBufferFromData).toHaveBeenCalledOnce();
        expect(audio.invalidateBuffer('a')).toBe(true);
        const current = audio.preloadFromData('b', new ArrayBuffer(16));
        expect(backend.loadBufferFromData).toHaveBeenCalledTimes(2);
        finish[1]({ id: 2, duration: 2, bytes: 200 });
        await current;
        finish[0]({ id: 1, duration: 1, bytes: 100 });
        await Promise.all([a, b]);
        expect(backend.unloaded).toEqual([1]);
        expect(audio.getBufferHandle('a')).toBeUndefined();
        expect(audio.getBufferHandle('b')?.id).toBe(2);
        expect(audio.getBufferStats().bufferBytes).toBe(200);
        audio.dispose();
        expect(backend.unloaded).toEqual([1, 2]);
    });

    it('allows a shared source to retry after all concurrent aliases fail', async () => {
        audio.setRefResolver(() => 'shared.wav');
        let fail!: (reason: Error) => void;
        backend.loadBuffer = vi.fn(() => new Promise<AudioBufferHandle>((_resolve, reject) => { fail = reject; }));
        const a = audio.preload('a'), b = audio.preload('b');
        const done = Promise.allSettled([a, b]);
        fail(new Error('decode failed'));
        expect((await done).every(result => result.status === 'rejected')).toBe(true);
        expect(backend.loadBuffer).toHaveBeenCalledOnce();
        backend.loadBuffer = vi.fn(async () => ({ id: 2, duration: 2, bytes: 200 }));
        await audio.preload('a');
        expect(backend.loadBuffer).toHaveBeenCalledOnce();
        expect(audio.getBufferHandle('a')?.id).toBe(2);
        expect(audio.trimBufferCache()).toBe(1);
    });

    it('invalidates the source captured by a pending load when the resolver changes', async () => {
        let source = 'old.wav';
        audio.setRefResolver(() => source);
        const finish: Array<(buffer: AudioBufferHandle) => void> = [];
        backend.loadBuffer = vi.fn(() => new Promise<AudioBufferHandle>(resolve => { finish.push(resolve); }));
        backend.invalidateSource = vi.fn();
        const old = audio.preload('key');
        source = 'new.wav';
        audio.invalidateBuffer('key');
        expect(backend.invalidateSource).toHaveBeenCalledWith('old.wav');
        const current = audio.preload('key');
        finish[1]({ id: 2, duration: 2, bytes: 200 });
        await current;
        finish[0]({ id: 1, duration: 1, bytes: 100 });
        await old;
        expect(backend.unloaded).toEqual([1]);
        expect(audio.getBufferHandle('key')?.id).toBe(2);
    });

    it.each([0, 1000])('releasing an old asset lease cannot release the replacement clip, budget=%i', async budget => {
        audio.setBufferBudget(budget);
        const assets = Assets.create({
            module: null,
            getAudio: () => audio,
            backend: {
                fetchBinary: async () => new ArrayBuffer(8),
                fetchText: async () => '{}',
                resolveUrl: (path: string) => path,
            } as Backend,
        });
        const old = await assets.acquireTyped('audio', 'edited.wav');
        const before = audio.getBufferHandle('edited.wav');
        expect(assets.invalidate('edited.wav')).toBe(true);
        const current = await assets.acquireTyped('audio', 'edited.wav');
        const replacement = audio.getBufferHandle('edited.wav');
        expect(replacement).toBeDefined();
        expect(replacement).not.toBe(before);
        old.release();
        expect(audio.getBufferHandle('edited.wav')).toBe(replacement);
        expect(audio.getBufferStats()).toMatchObject({ bufferCount: 1, evictableCount: 0 });
        expect(audio.trimBufferCache()).toBe(0);
        current.release();
        audio.trimBufferCache();
        expect(audio.getBufferStats()).toMatchObject({ bufferCount: 0, bufferBytes: 0 });
    });

    it('releases a lease on its original device when the audio provider changes', async () => {
        audio.setBufferBudget(0);
        const original = audio;
        const assets = Assets.create({
            module: null, getAudio: () => audio,
            backend: { fetchBinary: async () => new ArrayBuffer(8), fetchText: async () => '{}',
                resolveUrl: (path: string) => path } as Backend,
        });
        const old = await assets.acquireTyped('audio', 'edited.wav');
        audio = new AudioAPI(createMockBackend());
        audio.setBufferBudget(0);
        assets.invalidate('edited.wav');
        const current = await assets.acquireTyped('audio', 'edited.wav');
        const replacement = audio.getBufferHandle('edited.wav');
        old.release();
        expect(original.getBufferStats().bufferCount).toBe(0);
        expect(audio.getBufferHandle('edited.wav')).toBe(replacement);
        current.release();
        expect(audio.getBufferStats().bufferCount).toBe(0);
    });

    it('preload lands in the warm cache (evictable), playable immediately', async () => {
        await audio.preload('sfx/a.mp3');
        expect(audio.getBufferStats()).toMatchObject({
            bufferCount: 1, bufferBytes: 100, evictableCount: 1,
        });
        expect(audio.getBufferHandle('sfx/a.mp3')).toBeDefined();
    });

    it('retain pins, release returns to the warm cache, revive skips the backend', async () => {
        await audio.preload('sfx/a.mp3');
        expect(audio.retainBuffer('sfx/a.mp3')).toBe(true);
        expect(audio.getBufferStats().evictableCount).toBe(0);

        audio.releaseBuffer('sfx/a.mp3');
        expect(audio.getBufferStats().evictableCount).toBe(1);
        expect(backend.unloaded).toEqual([]);           // retained, not freed

        expect(audio.retainBuffer('sfx/a.mp3')).toBe(true);   // revive
        expect(backend.loads).toHaveLength(1);          // no second decode
    });

    it('budget 0 frees at release instead of caching', async () => {
        audio.setBufferBudget(0);
        await audio.preload('sfx/a.mp3');
        audio.retainBuffer('sfx/a.mp3');
        audio.releaseBuffer('sfx/a.mp3');
        expect(backend.unloaded).toHaveLength(1);
        expect(audio.getBufferStats().bufferCount).toBe(0);
        expect(audio.retainBuffer('sfx/a.mp3')).toBe(false);
    });

    it('evicts oldest warm-cache entries past the budget; access refreshes recency', async () => {
        audio.setBufferBudget(250);
        await audio.preload('sfx/a.mp3');
        await audio.preload('sfx/b.mp3');
        audio.getBufferHandle('sfx/a.mp3');   // touch a → b is now oldest

        await audio.preload('sfx/c.mp3');     // 300 > 250 → evict b
        expect(audio.getBufferHandle('sfx/b.mp3')).toBeUndefined();
        expect(audio.getBufferHandle('sfx/a.mp3')).toBeDefined();
        expect(audio.getBufferHandle('sfx/c.mp3')).toBeDefined();
        expect(audio.getBufferStats().bufferBytes).toBe(200);
    });

    it('never evicts held buffers, even far over budget', async () => {
        audio.setBufferBudget(50);
        await audio.preload('sfx/a.mp3');
        audio.retainBuffer('sfx/a.mp3');
        await audio.preload('sfx/b.mp3');
        audio.retainBuffer('sfx/b.mp3');
        expect(audio.getBufferStats().bufferBytes).toBe(200);
        expect(backend.unloaded).toEqual([]);
    });

    it('invalidate drops even a held buffer so stale bytes are never served', async () => {
        await audio.preload('sfx/a.mp3');
        audio.retainBuffer('sfx/a.mp3');
        expect(audio.invalidateBuffer('sfx/a.mp3')).toBe(true);
        expect(backend.unloaded).toHaveLength(1);
        expect(audio.retainBuffer('sfx/a.mp3')).toBe(false);
        expect(audio.invalidateBuffer('sfx/a.mp3')).toBe(false);
    });

    it('trimBufferCache frees only the warm cache and lets it refill', async () => {
        await audio.preload('sfx/held.mp3');
        audio.retainBuffer('sfx/held.mp3');
        await audio.preload('sfx/warm1.mp3');
        await audio.preload('sfx/warm2.mp3');

        expect(audio.trimBufferCache()).toBe(2);
        expect(audio.getBufferStats()).toMatchObject({ bufferCount: 1, evictableCount: 0 });

        audio.releaseBuffer('sfx/held.mp3');   // cache refills after the trim
        expect(audio.getBufferStats().evictableCount).toBe(1);
    });
});

// A three-minute track decoded is about 64 MB and the default cache is 32: the clip is larger than the whole
// budget, so whatever loads next evicts it. A play that was waiting on it then found nothing and said nothing (#122).
describe('a clip larger than the whole audio cache', () => {
    function sized(bytes: Record<string, number>) {
        const backend = createMockBackend();
        const played: number[] = [];
        let nextId = 100;
        backend.loadBuffer = async (url: string): Promise<AudioBufferHandle> => {
            backend.loads.push(url);
            return { id: ++nextId, duration: 1, bytes: bytes[url] ?? 10 };
        };
        const play = backend.play;
        backend.play = (buffer, config) => { played.push(buffer.id); return play(buffer, config); };
        const audio = new AudioAPI(backend);
        audio.setBufferBudget(32);
        return { audio, backend, played };
    }

    it('still plays when other clips finish loading beside it', async () => {
        const { audio, backend, played } = sized({ 'music/theme.mp3': 64 });
        const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
        audio.playBGM('music/theme.mp3');
        await Promise.all(['sfx/a.wav', 'sfx/b.wav', 'sfx/c.wav'].map((url) => audio.preload(url)));
        await new Promise((r) => setTimeout(r, 0));
        const said = warn.mock.calls.map((c) => String(c[1]));
        warn.mockRestore();
        expect(backend.loads).toContain('music/theme.mp3');
        expect(played).toHaveLength(1);
        expect(said.filter((m) => m.includes('did not play'))).toEqual([]);
        // Said once, by name and with the numbers: it will be decoded again on its next play.
        expect(said.filter((m) => m.includes('more than the whole'))).toHaveLength(1);
        expect(said.find((m) => m.includes('more than the whole'))).toMatch(/music\/theme\.mp3.*streaming/);
    });

    it('is evictable again once its play has started', async () => {
        const { audio } = sized({ 'music/theme.mp3': 64 });
        const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
        audio.playBGM('music/theme.mp3');
        await new Promise((r) => setTimeout(r, 0));
        expect(audio.getBufferHandle('music/theme.mp3')).toBeDefined();
        await audio.preload('sfx/a.wav');
        warn.mockRestore();
        // The waiting play is what held it; the cache is back under its budget now.
        expect(audio.getBufferHandle('music/theme.mp3')).toBeUndefined();
        expect(audio.getBufferStats().bufferBytes).toBeLessThanOrEqual(32);
    });

    it('says nothing about a streamed clip, which keeps only its file', async () => {
        const { audio, backend } = sized({});
        backend.loadBuffer = async (url: string): Promise<AudioBufferHandle> => (url.startsWith('music/')
            ? { id: 7, duration: 175, bytes: 3, streamed: true, savedBytes: 64 } : { id: 8 + url.length, duration: 1, bytes: 10 });
        const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
        audio.playBGM('music/theme.mp3');
        await Promise.all(['sfx/a.wav', 'sfx/b.wav'].map((url) => audio.preload(url)));
        await new Promise((r) => setTimeout(r, 0));
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
        expect(audio.getBufferHandle('music/theme.mp3')).toBeDefined();
        expect(audio.getBufferStats()).toMatchObject({ streamedCount: 1, streamedSavedBytes: 64 });
    });
});
