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
    const calls = { play: [] as unknown[][], stop: [] as number[], setVolume: [] as unknown[][], suspend: 0, resume: 0 };
    let nextBuffer = 1;
    let nextVoice = 100;
    const voices = new Map<number, { playing: boolean; time: number; loop: boolean }>();

    scope.es_audioLoad = (bytes: ArrayBuffer) => ({ id: nextBuffer++, duration: 2, bytes: bytes.byteLength * 4 });
    scope.es_audioUnload = () => {};
    scope.es_audioPlay = (buf: number, vol: number, pan: number, loop: boolean, rate: number) => {
        const id = nextVoice++;
        voices.set(id, { playing: true, time: 0, loop });
        calls.play.push([buf, vol, pan, loop, rate]);
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
