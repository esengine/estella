// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Stage C: the native audio + lifecycle seams. Audio is a thin SDK shell
 *        over the host's es_audio* engine (miniaudio), assembled onto the bridge
 *        like storage; foreground/background is a pushed signal (like touch). Both
 *        are optional — a host without them stays silent / always-visible, and
 *        assertNativeHost must still pass.
 */
import { describe, it, expect, vi } from 'vitest';
import { createHostBridge, NativePlatformAdapter, assertNativeHost } from '../src/platform/native';
import type { NativeBridge } from '../src/platform/native';
import { NativeAudioBackend } from '../src/audio/NativeAudioBackend';
import {
    AUDIO_BINDINGS, hasAudioBindings,
    REGISTRY_BINDINGS, REGISTRY_OPS, RESOURCE_BINDINGS, PLATFORM_BINDINGS,
} from '../src/ecs/bridge/nativeBindings';

function hostGlobals(): Record<string, unknown> {
    return {
        console: { log: () => {}, error: () => {}, warn: () => {} },
        setTimeout: () => 0,
        clearTimeout: () => {},
        performance: { now: () => 0 },
        TextDecoder,
    };
}

/** A fake native audio engine, installed as the host's es_audio* primitives. */
function installAudioHost(scope: Record<string, unknown>) {
    const calls = { play: [] as unknown[][], at: [] as number[], stop: [] as number[], setVolume: [] as unknown[][], suspend: 0, resume: 0 };
    let nextBuffer = 1;
    let nextVoice = 100;
    const voices = new Map<number, { playing: boolean; time: number; loop: boolean }>();

    scope.es_audioLoad = (bytes: ArrayBuffer) => ({ id: nextBuffer++, duration: 2, bytes: bytes.byteLength * 4 });
    scope.es_audioUnload = () => {};
    scope.es_audioPlay = (buf: number, vol: number, pan: number, loop: boolean, rate: number, loopStart?: number, start?: number, end?: number, at?: number) => {
        const id = nextVoice++;
        voices.set(id, { playing: true, time: 0, loop });
        // The ninth is the moment of the host's clock a voice begins on, kept apart so the others read as they did.
        if (at) calls.at.push(at);
        // The sixth is where a loop comes back to, the seventh and eighth where the clip begins and ends; recorded only when they are somewhere.
        calls.play.push(start || end ? [buf, vol, pan, loop, rate, loopStart, start, end] : loopStart ? [buf, vol, pan, loop, rate, loopStart] : [buf, vol, pan, loop, rate]);
        return id;
    };
    scope.es_audioStop = (v: number) => { voices.delete(v); calls.stop.push(v); };
    scope.es_audioPause = (v: number) => { const s = voices.get(v); if (s) s.playing = false; };
    scope.es_audioResume = (v: number) => { const s = voices.get(v); if (s) s.playing = true; };
    scope.es_audioSetVolume = (v: number, x: number) => calls.setVolume.push([v, x]);
    scope.es_audioSetPan = () => {};
    scope.es_audioSetLoop = () => {};
    scope.es_audioSetRate = () => {};
    scope.es_audioVoiceState = (v: number) => {
        const s = voices.get(v);
        return s ? { playing: s.playing, currentTime: s.time } : null;
    };
    scope.es_audioSuspendAll = () => { calls.suspend++; };
    scope.es_audioResumeAll = () => { calls.resume++; };
    return { calls, voices };
}

function audioScope(): Record<string, unknown> {
    const scope = {
        ...hostGlobals(),
        es_readAsset: () => new ArrayBuffer(4),
        es_loadImagePixels: () => ({ width: 1, height: 1, pixels: new ArrayBuffer(4) }),
    };
    installAudioHost(scope);
    return scope;
}

describe('hasAudioBindings', () => {
    it('is true only when the whole surface is bound (all-or-nothing)', () => {
        const scope = audioScope();
        expect(hasAudioBindings(scope)).toBe(true);
        delete scope[AUDIO_BINDINGS.play];
        expect(hasAudioBindings(scope)).toBe(false);
    });
});

describe('createHostBridge — audio assembly', () => {
    it('keeps independent subscriptions when the same callback is registered twice', () => {
        const scope = audioScope(), audio = createHostBridge(scope).audio!, callback = vi.fn();
        const first = audio.onEnded(callback), second = audio.onEnded(callback);
        const push = scope.es_onNativeAudioEnded as (id: number) => void;
        push(100); expect(callback).toHaveBeenCalledTimes(2);
        first(); first(); callback.mockClear(); push(101); expect(callback).toHaveBeenCalledOnce();
        second(); callback.mockClear(); push(102); expect(callback).not.toHaveBeenCalled();
    });
    it('continues notifying other subscribers when one callback throws', () => {
        const scope = audioScope(), audio = createHostBridge(scope).audio!, second = vi.fn();
        audio.onEnded(() => { throw Error('subscriber failed'); }); audio.onEnded(second);
        expect(() => (scope.es_onNativeAudioEnded as (id: number) => void)(100)).toThrow('subscriber failed');
        expect(second).toHaveBeenCalledWith(100);
    });
    it('a subscription withdrawn during dispatch cannot receive that event', () => {
        const scope = audioScope(), audio = createHostBridge(scope).audio!, second = vi.fn();
        let release = () => {};
        audio.onEnded(() => release()); release = audio.onEnded(second);
        (scope.es_onNativeAudioEnded as (id: number) => void)(100);
        expect(second).not.toHaveBeenCalled();
    });
    it('subscriptions added during dispatch wait for the next completion', () => {
        const scope = audioScope(), audio = createHostBridge(scope).audio!, added = vi.fn();
        let installed = false;
        audio.onEnded(() => { if (!installed) { installed = true; audio.onEnded(added); } });
        const push = scope.es_onNativeAudioEnded as (id: number) => void;
        push(100); expect(added).not.toHaveBeenCalled(); push(101); expect(added).toHaveBeenCalledWith(101);
    });
    it('assembles bridge.audio when the host bound the engine', () => {
        expect(createHostBridge(audioScope()).audio).toBeDefined();
    });

    it('omits bridge.audio when the host bound no engine', () => {
        const scope = {
            ...hostGlobals(),
            es_readAsset: () => new ArrayBuffer(4),
            es_loadImagePixels: () => ({ width: 1, height: 1, pixels: new ArrayBuffer(4) }),
        };
        expect(createHostBridge(scope).audio).toBeUndefined();
    });
});

describe('NativeAudioBackend', () => {
    it('two backends sharing one native bridge receive their own voice completions', () => {
        const scope = audioScope(), audio = createHostBridge(scope).audio!;
        const first = new NativeAudioBackend(audio), second = new NativeAudioBackend(audio);
        const a = first.play({ id: 1, duration: 1 }, {}), b = second.play({ id: 1, duration: 1 }, {});
        a.onEnd = vi.fn(); b.onEnd = vi.fn();
        const push = scope.es_onNativeAudioEnded as (id: number) => void;
        push(a.id); expect(a.onEnd).toHaveBeenCalledOnce(); expect(b.onEnd).not.toHaveBeenCalled();
        first.dispose(); push(b.id); expect(b.onEnd).toHaveBeenCalledOnce(); second.dispose();
    });
    it('repeated preview backend shutdowns preserve the main backend completion subscription', () => {
        const scope = audioScope(), audio = createHostBridge(scope).audio!;
        const main = new NativeAudioBackend(audio), handle = main.play({ id: 1, duration: 1 }, {});
        handle.onEnd = vi.fn();
        for (let i = 0; i < 100; i++) new NativeAudioBackend(audio).dispose();
        (scope.es_onNativeAudioEnded as (id: number) => void)(handle.id);
        expect(handle.onEnd).toHaveBeenCalledOnce(); main.dispose();
    });
    it('hands the host where a loop comes back to, and nothing for a voice that does not loop', async () => {
        const scope = audioScope();
        const host = installAudioHost(scope);
        const backend = new NativeAudioBackend(createHostBridge(scope).audio!);
        const buffer = await backend.loadBufferFromData('music', new ArrayBuffer(16));
        backend.play(buffer, { loop: true, loopStart: 8 });
        backend.play(buffer, { loopStart: 8 });
        backend.play(buffer, { loop: true });
        expect(host.calls.play).toEqual([[buffer.id, 1, 0, true, 1, 8], [buffer.id, 1, 0, false, 1], [buffer.id, 1, 0, true, 1]]);
    });

    it('plays a clip the exporter re-encoded from past its silence to its real end', async () => {
        const scope = audioScope();
        const host = installAudioHost(scope);
        const backend = new NativeAudioBackend(createHostBridge(scope).audio!);
        // The fake host says every clip decodes to two seconds: 1.95 of sound, with 0.025 before it and as much after.
        const buffer = await backend.loadBufferFromData('music', new ArrayBuffer(16), { trim: { seconds: 1.95, lead: 0.025 } });
        expect(buffer.duration).toBeCloseTo(1.95, 9);
        backend.play(buffer, {});
        backend.play(buffer, { loop: true });
        backend.play(buffer, { loop: true, loopStart: 0.5 });
        const close = (v: number) => expect.closeTo(v, 9);
        expect(host.calls.play).toEqual([
            [buffer.id, 1, 0, false, 1, close(0.025), close(0.025), close(1.975)],
            [buffer.id, 1, 0, true, 1, close(0.025), close(0.025), close(1.975)],
            [buffer.id, 1, 0, true, 1, close(0.525), close(0.025), close(1.975)],
        ]);
        // A host that took the silence off itself says the clip is as long as it should be, and is asked for nothing.
        const exact = await backend.loadBufferFromData('music2', new ArrayBuffer(16), { trim: { seconds: 2, lead: 0.025 } });
        backend.play(exact, { loop: true });
        expect(host.calls.play.at(-1)).toEqual([exact.id, 1, 0, true, 1, 0, 0, close(2)]);
    });

    it('begins voices of one token at one moment of the host clock, and asks nothing of a host that has no clock', async () => {
        const scope = audioScope();
        const host = installAudioHost(scope);
        let now = 10;
        scope.es_audioTime = () => now;
        const backend = new NativeAudioBackend(createHostBridge(scope).audio!);
        const buffer = await backend.loadBufferFromData('stem', new ArrayBuffer(16));
        const together = {};
        backend.play(buffer, { loop: true, together });
        now = 10.02;
        backend.play(buffer, { loop: true, together });
        backend.play(buffer, { loop: true });
        // Both at a twentieth of a second past when the first was asked for; the third, with no token, now.
        expect(host.calls.at).toEqual([expect.closeTo(10.05, 9), expect.closeTo(10.05, 9)]);

        const old = audioScope();
        const oldHost = installAudioHost(old);
        const plain = new NativeAudioBackend(createHostBridge(old).audio!);
        plain.play(await plain.loadBufferFromData('stem', new ArrayBuffer(16)), { loop: true, together: {} });
        expect(oldHost.calls.at).toEqual([]);
    });

    it('loads, plays and reports state through the bridge', async () => {
        const scope = audioScope();
        const host = installAudioHost(scope);   // capture the same closure the bridge will use
        const bridge = createHostBridge(scope);
        const backend = new NativeAudioBackend(bridge.audio!);
        expect(backend.mixer).toBeNull();

        const buffer = await backend.loadBufferFromData('sfx', new ArrayBuffer(16));
        expect(buffer).toMatchObject({ duration: 2 });
        expect(buffer.bytes).toBe(64);

        const handle = backend.play(buffer, { volume: 0.5, loop: true, pan: 2 });
        // pan is clamped to [-1, 1] before it reaches the host.
        expect(host.calls.play[0]).toEqual([buffer.id, 0.5, 1, true, 1]);
        expect(handle.isPlaying).toBe(true);
        expect(handle.duration).toBe(2);

        handle.setVolume(0.25);
        expect(host.calls.setVolume[0]).toEqual([handle.id, 0.25]);
    });

    it('fires onEnd from the host push, then a later stop() is a no-op', () => {
        const scope = audioScope();
        const host = installAudioHost(scope);
        const bridge = createHostBridge(scope);
        const backend = new NativeAudioBackend(bridge.audio!);
        const handle = backend.play({ id: 1, duration: 1 }, {});
        handle.onEnd = vi.fn();

        // The host reports the voice ended on its own.
        (scope.es_onNativeAudioEnded as (v: number) => void)(handle.id);
        expect(handle.onEnd).toHaveBeenCalledTimes(1);

        const stopsBefore = host.calls.stop.length;
        handle.stop();   // guarded — the voice is already gone
        expect(host.calls.stop.length).toBe(stopsBefore);
    });

    it('retires native ownership before invoking a throwing completion callback', () => {
        const scope = audioScope(), bridge = createHostBridge(scope);
        const backend = new NativeAudioBackend(bridge.audio!);
        const handle = backend.play({ id: 1, duration: 1 }, {});
        const owned = (backend as unknown as { voices_: Map<number, unknown> }).voices_;
        handle.onEnd = () => { throw Error('callback failed'); };
        expect(() => (scope.es_onNativeAudioEnded as (v: number) => void)(handle.id)).toThrow('callback failed');
        expect(owned.size).toBe(0); expect(handle.isPlaying).toBe(false);
    });

    it.each(['stop', 'end'])('a native handle retired by %s ignores later parameter writes', kind => {
        const scope = audioScope(), bridge = createHostBridge(scope), audio = bridge.audio!;
        const writes = ['pause', 'resume', 'setVolume', 'setPan', 'setLoop', 'setRate'] as const;
        const spies = writes.map(name => vi.spyOn(audio, name));
        const backend = new NativeAudioBackend(audio), handle = backend.play({ id: 1, duration: 1 }, {});
        if (kind === 'stop') handle.stop();
        else (scope.es_onNativeAudioEnded as (v: number) => void)(handle.id);
        handle.pause(); handle.resume(); handle.setVolume(.2); handle.setPan(.5); handle.setLoop(true); handle.setPlaybackRate(2);
        for (const spy of spies) expect(spy).not.toHaveBeenCalled();
        expect(handle.isPlaying).toBe(false); expect(handle.currentTime).toBe(0);
    });

    it('stop() tears the voice down through the bridge', () => {
        const scope = audioScope();
        const host = installAudioHost(scope);
        const bridge = createHostBridge(scope);
        const backend = new NativeAudioBackend(bridge.audio!);
        const handle = backend.play({ id: 1, duration: 1 }, {});
        handle.stop();
        expect(host.calls.stop).toContain(handle.id);
        expect(handle.isPlaying).toBe(false);
    });

    it('suspend/resume drive the whole device', () => {
        const scope = audioScope();
        const host = installAudioHost(scope);
        const backend = new NativeAudioBackend(createHostBridge(scope).audio!);
        backend.suspend();
        backend.resume();
        expect(host.calls.suspend).toBe(1);
        expect(host.calls.resume).toBe(1);
    });
});

describe('createHostBridge — visibility (lifecycle)', () => {
    it('routes the host visibility push to onShow / onHide', () => {
        const scope = audioScope();
        const bridge = createHostBridge(scope);
        const show = vi.fn();
        const hide = vi.fn();
        const offShow = bridge.onShow!(show);
        bridge.onHide!(hide);

        const push = scope.es_onNativeVisibility as (visible: boolean) => void;
        push(false);
        push(true);
        expect(hide).toHaveBeenCalledTimes(1);
        expect(show).toHaveBeenCalledTimes(1);

        offShow();
        push(true);
        expect(show).toHaveBeenCalledTimes(1);   // detached
    });

    it('routes the host memory-warning push to subscribers, and detaches', () => {
        const scope = audioScope();
        const bridge = createHostBridge(scope);
        const warn = vi.fn();
        const off = bridge.onMemoryWarning!(warn);

        const push = scope.es_onNativeMemoryWarning as () => void;
        push();
        expect(warn).toHaveBeenCalledTimes(1);
        off();
        push();
        expect(warn).toHaveBeenCalledTimes(1);
    });
});

describe('NativePlatformAdapter — Stage C surfaces', () => {
    function bridgeWith(audio: NativeBridge['audio'], visibility: boolean): NativeBridge {
        const shows: (() => void)[] = [];
        const hides: (() => void)[] = [];
        return {
            readFile: async () => new ArrayBuffer(0),
            fileExists: async () => false,
            fetch: async () => ({ ok: false, status: 404 }),
            loadImagePixels: async () => ({ width: 1, height: 1, pixels: new Uint8Array(4) }),
            getStorageItem: () => null,
            setStorageItem: () => {},
            removeStorageItem: () => {},
            storageKeys: () => [],
            registerInput: () => () => {},
            devicePixelRatio: () => 1,
            audio,
            ...(visibility ? {
                onShow: (cb: () => void) => { shows.push(cb); return () => {}; },
                onHide: (cb: () => void) => { hides.push(cb); return () => {}; },
                onMemoryWarning: (cb: () => void) => { cb(); return () => {}; },
            } : {}),
        };
    }

    it('advertises createAudioBackend only when the bridge has audio', () => {
        const scope = audioScope();
        const audio = createHostBridge(scope).audio;
        expect(new NativePlatformAdapter(bridgeWith(audio, true)).createAudioBackend?.()?.name).toBe('native');
        expect(new NativePlatformAdapter(bridgeWith(undefined, true)).createAudioBackend).toBeUndefined();
    });

    it('delegates onAppShow / onAppHide / onMemoryWarning to the bridge, tolerating a bridge without them', () => {
        const withVisibility = new NativePlatformAdapter(bridgeWith(undefined, true));
        expect(typeof withVisibility.onAppShow(() => {})).toBe('function');
        const warn = vi.fn();
        withVisibility.onMemoryWarning(warn);
        expect(warn).toHaveBeenCalledTimes(1);   // the fake bridge fires on subscribe

        const without = new NativePlatformAdapter(bridgeWith(undefined, false));
        expect(() => without.onAppHide(() => {})()).not.toThrow();
        expect(() => without.onMemoryWarning(() => {})()).not.toThrow();
    });
});

describe('assertNativeHost — audio stays optional', () => {
    it('passes on a host with no audio engine', () => {
        const scope = hostGlobals();
        for (const name of [
            ...Object.values(REGISTRY_OPS),
            ...Object.values(REGISTRY_BINDINGS),
            ...Object.values(RESOURCE_BINDINGS),
            ...Object.values(PLATFORM_BINDINGS),
        ]) scope[name] = () => undefined;
        expect(hasAudioBindings(scope)).toBe(false);
        expect(() => assertNativeHost(scope)).not.toThrow();
    });
});

// The same rule the web backend follows (audioStreaming.ts), so a track that streams in the editor streams on the
// phone: before this the native host decoded every clip whole, 0.37 MB a second (#122).
describe('NativeAudioBackend streaming', () => {
    /** A PCM WAV header that says `seconds`, with one byte a second so the file stays small. */
    function wav(seconds: number): ArrayBuffer {
        const view = new DataView(new ArrayBuffer(44 + seconds));
        view.setUint32(0, 0x52494646, false); view.setUint32(8, 0x57415645, false);
        view.setUint32(12, 0x666d7420, false); view.setUint32(16, 16, true);
        view.setUint32(28, 1, true);   // byte rate
        view.setUint32(36, 0x64617461, false); view.setUint32(40, seconds, true);
        return view.buffer;
    }

    function streamingHost(canStream = true) {
        const scope = audioScope();
        const asked: boolean[] = [];
        scope.es_audioLoad = (bytes: ArrayBuffer, stream?: boolean) => {
            asked.push(stream === true);
            return stream && canStream
                ? { id: 1, duration: 175, bytes: bytes.byteLength, streamed: true }
                : { id: 1, duration: 175, bytes: 67_057_376 };
        };
        return { backend: new NativeAudioBackend(createHostBridge(scope).audio!), asked };
    }

    it('hands the host a clip the importer says to stream, and reports what that saved', async () => {
        const { backend, asked } = streamingHost();
        const data = new ArrayBuffer(2_400_000);
        const buffer = await backend.loadBufferFromData('music', data, { loadType: 'streaming' });
        expect(asked).toEqual([true]);
        // What stays resident is the file; the PCM it did not take is the rest of what decoding would cost.
        expect(buffer).toMatchObject({ streamed: true, bytes: 2_400_000, duration: 175 });
        expect(buffer.savedBytes).toBe(175 * 48000 * 2 * 4 - 2_400_000);
    });

    it('lets the length decide under auto, and decodes what the importer says to decode', async () => {
        const { backend, asked } = streamingHost();
        await backend.loadBufferFromData('long', wav(40));
        await backend.loadBufferFromData('short', wav(5));
        await backend.loadBufferFromData('forced', wav(40), { loadType: 'decompress' });
        expect(asked).toEqual([true, false, false]);
    });

    it('reports a decoded clip as decoded when the host could not stream it', async () => {
        const { backend, asked } = streamingHost(false);
        const buffer = await backend.loadBufferFromData('music', new ArrayBuffer(2_400_000), { loadType: 'streaming' });
        expect(asked).toEqual([true]);
        expect(buffer.streamed).toBeUndefined();
        expect(buffer.bytes).toBe(67_057_376);
    });
});
