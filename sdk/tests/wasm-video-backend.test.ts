// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// WasmVideoBackend against a scripted videodec module: clock pacing, texture
// pump, transport, loop/seek wiring, and open-failure reporting.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WasmVideoBackend, type VideoWasmModule } from '../src/video/WasmVideoBackend';
import type { SideModuleHost } from '../src/sideModules/host';
import { setPlatform } from '../src/platform/base';
import { initResourceManager, shutdownResourceManager } from '../src/resourceManager';
import type { PlatformAdapter } from '../src/platform/types';

const WIDTH = 4, HEIGHT = 2;

let nowMs = 0;

function mockPlatform(bytes: ArrayBuffer): PlatformAdapter {
    return {
        name: 'wechat',
        fetch: async () => ({ ok: true, status: 200, statusText: 'OK', headers: {}, json: async () => ({}), text: async () => '', arrayBuffer: async () => bytes }) as any,
        readFile: async () => bytes,
        readTextFile: async () => '',
        fileExists: async () => true,
        loadImagePixels: async () => ({ width: 0, height: 0, pixels: new Uint8Array() }),
        instantiateWasm: async () => ({} as any),
        createCanvas: () => ({} as any),
        now: () => nowMs,
        createImage: () => ({} as any),
        bindInputEvents: () => {},
        createAudioBackend: () => ({} as any),
    };
}

/** A scripted videodec module: `advance` reports a new frame per call while
 *  `framesLeft > 0`, then flags ended. Heap is real so open/copy paths run. */
function mockVideoModule(opts: { openResult?: number; framesLeft?: number } = {}) {
    const state = {
        framesLeft: opts.framesLeft ?? 1000,
        ended: 0,
        loop: 0,
        time: 0,
        newFrame: false,
        freed: [] as number[],
        closed: [] as number[],
    };
    let brk = 8;
    const mod = {
        _malloc: vi.fn((size: number) => { const p = brk; brk += size + 8; return p; }),
        _free: vi.fn((ptr: number) => state.freed.push(ptr)),
        _es_video_open: vi.fn(() => opts.openResult ?? 1),
        _es_video_close: vi.fn((h: number) => state.closed.push(h)),
        _es_video_width: vi.fn(() => WIDTH),
        _es_video_height: vi.fn(() => HEIGHT),
        _es_video_duration: vi.fn(() => 2.5),
        _es_video_framerate: vi.fn(() => 30),
        _es_video_time: vi.fn(() => state.time),
        _es_video_set_loop: vi.fn((_h: number, loop: number) => { state.loop = loop; }),
        _es_video_has_ended: vi.fn(() => state.ended),
        _es_video_advance: vi.fn((_h: number, dt: number) => {
            state.time += dt;
            if (state.framesLeft > 0) { state.framesLeft--; state.newFrame = true; return 1; }
            if (!state.loop) state.ended = 1;
            return 0;
        }),
        _es_video_frame_rgba: vi.fn((_h: number, outPtr: number, outSize: number) => {
            if (!state.newFrame || outSize < WIDTH * HEIGHT * 4) return 0;
            mod.HEAPU8.fill(0xab, outPtr, outPtr + outSize);
            state.newFrame = false;
            return 1;
        }),
        _es_video_seek: vi.fn((_h: number, t: number) => { state.time = t; state.newFrame = true; state.framesLeft = Math.max(state.framesLeft, 1); return 1; }),
        HEAPU8: new Uint8Array(1 << 16),
    };
    return { mod: mod as unknown as VideoWasmModule, raw: mod, state };
}

function hostFor(mod: VideoWasmModule | null): SideModuleHost {
    return { acquire: vi.fn(async () => mod as any) };
}

const engineModule = { _malloc: () => 4, _free: () => {}, HEAPU8: new Uint8Array(1 << 16) } as any;

const flush = () => new Promise((r) => setTimeout(r, 0));

let rmCreate: ReturnType<typeof vi.fn>;
let rmUpdate: ReturnType<typeof vi.fn>;
let rmRelease: ReturnType<typeof vi.fn>;

beforeEach(() => {
    nowMs = 0;
    rmCreate = vi.fn(() => 7);
    rmUpdate = vi.fn();
    rmRelease = vi.fn();
    initResourceManager({
        createTextureEx: rmCreate,
        updateTextureSubregion: rmUpdate,
        releaseTexture: rmRelease,
        getTextureDimensions: vi.fn(() => null),
    } as any);
    setPlatform(mockPlatform(new ArrayBuffer(64)));
});

afterEach(() => {
    shutdownResourceManager();
});

describe('WasmVideoBackend', () => {
    it('opens the stream through the side module and uploads the first frame', async () => {
        const { mod, raw } = mockVideoModule();
        const backend = new WasmVideoBackend({ sideModules: () => hostFor(mod) });
        const onReady = vi.fn();
        const handle = backend.createStream('videos/clip.esv', { autoplay: true, muted: true });
        handle.onReady = onReady;
        await flush();

        expect(raw._es_video_open).toHaveBeenCalled();
        expect(handle.width).toBe(WIDTH);
        expect(handle.height).toBe(HEIGHT);
        expect(handle.duration).toBe(2.5);
        expect(handle.textureHandle).toBe(0); // nothing decoded yet

        nowMs = 16;
        handle.pump(engineModule); // first pump establishes the clock base
        nowMs = 32;
        handle.pump(engineModule);
        expect(rmCreate).toHaveBeenCalledTimes(1);
        expect(handle.textureHandle).toBe(7);
        expect(handle.isReady).toBe(true);
        expect(onReady).toHaveBeenCalledTimes(1);

        nowMs = 48;
        handle.pump(engineModule);
        expect(rmUpdate).toHaveBeenCalledTimes(1); // subsequent frames update in place
        handle.stop();
        expect(rmRelease).toHaveBeenCalledWith(7);
        expect(raw._es_video_close).toHaveBeenCalled();
    });

    it('does not advance the decoder while paused', async () => {
        const { mod, raw } = mockVideoModule();
        const backend = new WasmVideoBackend({ sideModules: () => hostFor(mod) });
        const handle = backend.createStream('clip.esv', { autoplay: false });
        await flush();
        nowMs = 100;
        handle.pump(engineModule);
        expect(raw._es_video_advance).not.toHaveBeenCalled();

        handle.play();
        nowMs = 116;
        handle.pump(engineModule); // clock base
        nowMs = 132;
        handle.pump(engineModule);
        expect(raw._es_video_advance).toHaveBeenCalled();
        handle.stop();
    });

    it('clamps a huge wall-clock gap to the pump budget', async () => {
        const { mod, raw } = mockVideoModule();
        const backend = new WasmVideoBackend({ sideModules: () => hostFor(mod) });
        const handle = backend.createStream('clip.esv', {});
        await flush();
        nowMs = 0;
        handle.pump(engineModule);
        nowMs = 60_000; // window was hidden for a minute
        handle.pump(engineModule);
        const dt = (raw._es_video_advance.mock.calls.at(-1) as number[])[1];
        expect(dt).toBeLessThanOrEqual(0.25);
        handle.stop();
    });

    it('fires onEnded once and stops playing when the stream ends', async () => {
        const { mod } = mockVideoModule({ framesLeft: 1 });
        const backend = new WasmVideoBackend({ sideModules: () => hostFor(mod) });
        const handle = backend.createStream('clip.esv', { loop: false });
        const onEnded = vi.fn();
        handle.onEnded = onEnded;
        await flush();
        for (let i = 1; i <= 5; i++) {
            nowMs = i * 16;
            handle.pump(engineModule);
        }
        expect(onEnded).toHaveBeenCalledTimes(1);
        expect(handle.isPlaying).toBe(false);
        handle.stop();
    });

    it('wires loop and playback rate into the decoder', async () => {
        const { mod, raw, state } = mockVideoModule();
        const backend = new WasmVideoBackend({ sideModules: () => hostFor(mod) });
        const handle = backend.createStream('clip.esv', { loop: true, playbackRate: 2 });
        await flush();
        expect(state.loop).toBe(1);
        handle.setLoop(false);
        expect(state.loop).toBe(0);

        nowMs = 0;
        handle.pump(engineModule);
        nowMs = 100;
        handle.pump(engineModule);
        const dt = (raw._es_video_advance.mock.calls.at(-1) as number[])[1];
        expect(dt).toBeCloseTo(0.2); // 100ms wall * rate 2
        handle.stop();
    });

    it('seek before the decoder is ready applies once open', async () => {
        const { mod, raw } = mockVideoModule();
        const backend = new WasmVideoBackend({ sideModules: () => hostFor(mod) });
        const handle = backend.createStream('clip.esv', {});
        handle.seek(1.5); // decoder not open yet
        await flush();
        expect(raw._es_video_seek).toHaveBeenCalledWith(1, 1.5);
        expect(handle.currentTime).toBe(1.5);
        handle.stop();
    });

    it('reports an error for a stream the decoder rejects', async () => {
        const { mod } = mockVideoModule({ openResult: 0 });
        const backend = new WasmVideoBackend({ sideModules: () => hostFor(mod) });
        const handle = backend.createStream('not-mpeg1.mp4', {});
        const onError = vi.fn();
        handle.onError = onError;
        await flush();
        expect(onError).toHaveBeenCalledTimes(1);
        expect(handle.isReady).toBe(false);
        expect(() => handle.pump(engineModule)).not.toThrow();
    });

    it('reports an error when the side module is unavailable', async () => {
        const backend = new WasmVideoBackend({ sideModules: () => hostFor(null) });
        const handle = backend.createStream('clip.esv', {});
        const onError = vi.fn();
        handle.onError = onError;
        await flush();
        expect(onError).toHaveBeenCalledTimes(1);
        expect(() => handle.pump(engineModule)).not.toThrow();
    });
});
