// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, expect, it, vi } from 'vitest';
import type { PlatformAudioBackend, AudioHandle } from '../src/audio/PlatformAudioBackend';
const backends: PlatformAudioBackend[] = [], listeners = new Set<() => void>();
const muteListeners = new Set<(muted: boolean) => void>();
let hostMuted = false;
vi.mock('../src/platform/base', async original => ({
    ...await original<typeof import('../src/platform/base')>(),
    isPlatformInitialized: () => true,
    getPlatform: () => ({ onAudioMute: (callback: (muted: boolean) => void) => {
        muteListeners.add(callback); callback(hostMuted);
        return () => muteListeners.delete(callback);
    } }),
    platformCreateAudioBackend: () => {
        const backend = { name: 'Mock', mixer: null, isReady: true,
            initialize: vi.fn().mockResolvedValue(undefined), ensureResumed: vi.fn().mockResolvedValue(undefined),
            loadBuffer: vi.fn().mockResolvedValue({ id: 1, duration: 1 }), unloadBuffer: vi.fn(),
            suspend: vi.fn(), resume: vi.fn(), dispose: vi.fn(),
            play: vi.fn(() => { let playing = true; return { id: 1, get isPlaying() { return playing; }, currentTime: 0, duration: 1,
                stop: vi.fn(() => { playing = false; }), pause: vi.fn(), resume: vi.fn(),
                setVolume: vi.fn(), setPan: vi.fn(), setLoop: vi.fn(), setPlaybackRate: vi.fn() } satisfies AudioHandle; }),
        } as unknown as PlatformAudioBackend;
        backends.push(backend); return backend;
    },
    platformOnMemoryWarning: (callback: () => void) => { listeners.add(callback); return () => listeners.delete(callback); },
}));
const { App } = await import('../src/app/app');
const { AudioPlugin } = await import('../src/audio/AudioPlugin');
const { Audio } = await import('../src/audio/Audio');
const { AudioSource, SoundEventSource } = await import('../src/audio/AudioComponents');
const { triggerSoundEventSource } = await import('../src/audio/SoundEventSource');
const { SoundEvents } = await import('../src/audio/SoundEventPlayback');
const { Assets } = await import('../src/asset/AssetPlugin');
const { parseSoundEvent } = await import('../src/audio/SoundEvent');
const apps: ReturnType<typeof App.new>[] = [];
function build(plugin: InstanceType<typeof AudioPlugin>) { const app=App.new(); apps.push(app); app.addPlugin(plugin); return app; }

it('drives awake event sources and cancels queued definitions on disconnect and cleanup', async () => {
    const app = build(new AudioPlugin()), owner = app.world.spawn(), release = vi.fn();
    const lease = { key: 'steps', generation: 1, value: parseSoundEvent({ version: 1, clips: [] }), release, retain: () => null };
    let resolve!: (value: typeof lease) => void;
    const acquire = vi.fn().mockResolvedValueOnce(lease).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    app.insertResource(Assets, { acquireTyped: acquire } as unknown as import('../src/asset/Assets').Assets);
    app.world.insert(owner, SoundEventSource, { event: 'steps.esaudioevent', playOnAwake: true });
    await app.tick(1 / 60); await app.tick(1 / 60);
    expect(acquire).toHaveBeenCalledOnce(); expect(app.getResource(SoundEvents).getStats().rejected).toBe(1);
    app.world.disconnectCpp(); expect(release).toHaveBeenCalledOnce();
    const pending = triggerSoundEventSource(app.world, owner); app.quit();
    expect(await pending).toBeNull(); resolve(lease); await new Promise(done => setTimeout(done, 0));
    expect(release).toHaveBeenCalledTimes(2); expect(await triggerSoundEventSource(app.world, owner)).toBeNull();
});
afterEach(() => { for(const app of apps.splice(0)) app.quit(); backends.length=0; listeners.clear(); muteListeners.clear(); hostMuted=false; });
it('host mute overrides game resume and preserves explicit suspension after host unmute', () => {
    hostMuted = true;
    const app = build(new AudioPlugin()), audio = app.getResource(Audio), backend = backends[0];
    expect(backend.suspend).toHaveBeenCalledOnce();
    audio.resume(); expect(backend.resume).not.toHaveBeenCalled();
    audio.suspend();
    for (const callback of muteListeners) callback(false);
    expect(backend.resume).not.toHaveBeenCalled();
    audio.resume(); expect(backend.resume).toHaveBeenCalledOnce();
    app.quit(); expect(muteListeners.size).toBe(0);
});
it('execution holds keep audio suspended until the final owner releases, preserving user suspension', () => {
    const app=build(new AudioPlugin()),audio=app.getResource(Audio),backend=backends[0];
    const first=app.holdExecution(),second=app.holdExecution();audio.resume();
    expect(backend.suspend).toHaveBeenCalledOnce();expect(backend.resume).not.toHaveBeenCalled();
    first();expect(backend.resume).not.toHaveBeenCalled();audio.suspend();second();
    expect(backend.resume).not.toHaveBeenCalled();audio.resume();expect(backend.resume).toHaveBeenCalledOnce();
});
it('quitting an older app releases its backend and preserves the newer app voice and subscription', async () => {
    const plugin=new AudioPlugin(), first=build(plugin), second=build(plugin);
    const a=first.getResource(Audio), b=second.getResource(Audio);
    await a.preload('a.wav'); await b.preload('b.wav');
    const firstVoice=a.playSFX('a.wav')!, secondVoice=b.playSFX('b.wav')!;
    const callbacks=[...listeners]; first.quit();
    expect(backends[0].dispose).toHaveBeenCalledOnce(); expect(backends[1].dispose).not.toHaveBeenCalled();
    expect(firstVoice.isPlaying).toBe(false); expect(secondVoice.isPlaying).toBe(true);
    expect(listeners.has(callbacks[0])).toBe(false); expect(listeners.has(callbacks[1])).toBe(true);
    second.quit(); expect(backends[1].dispose).toHaveBeenCalledOnce(); expect(listeners.size).toBe(0);
});
it('releases exactly one backend per preview while keeping the main app alive', () => {
    const plugin=new AudioPlugin(), main=build(plugin);
    for(let i=0;i<100;i++) { const preview=build(plugin); expect(listeners.size).toBe(2); preview.quit(); expect(listeners.size).toBe(1); }
    expect(backends[0].dispose).not.toHaveBeenCalled(); main.quit();
    for(const backend of backends) expect(backend.dispose).toHaveBeenCalledOnce(); expect(listeners.size).toBe(0);
});
it('parameterless cleanup releases the latest app only and remains idempotent', () => {
    const plugin=new AudioPlugin(), first=build(plugin); build(plugin);
    plugin.cleanup(); plugin.cleanup();
    expect(backends[0].dispose).not.toHaveBeenCalled(); expect(backends[1].dispose).toHaveBeenCalledOnce();
    first.quit(); expect(backends[0].dispose).toHaveBeenCalledOnce(); expect(listeners.size).toBe(0);
});
it('quitting the newer app first leaves older source updates available', async () => {
    const plugin=new AudioPlugin(), first=build(plugin), second=build(plugin);
    await first.getResource(Audio).preload('a.wav');
    second.quit();
    const entity=first.world.spawn(); first.world.insert(entity,AudioSource,{clip:'a.wav',playing:true});
    await first.tick(1/60); expect(backends[0].play).toHaveBeenCalledOnce();
    first.quit(); expect(backends[0].dispose).toHaveBeenCalledOnce();
});
it('cleanup withdraws the owning world despawn listener and prevents later source playback', async () => {
    const plugin=new AudioPlugin(), app=App.new(); apps.push(app);
    const off=vi.fn(), subscribe=vi.spyOn(app.world,'onDespawn').mockReturnValue(off);
    app.addPlugin(plugin); expect(subscribe).toHaveBeenCalledOnce();
    await app.getResource(Audio).preload('a.wav');
    const entity=app.world.spawn(); app.world.insert(entity,AudioSource,{clip:'a.wav',playing:true});
    plugin.cleanup(app); await app.tick(1/60);
    expect(off).toHaveBeenCalledOnce(); expect(backends[0].play).not.toHaveBeenCalled();
    app.quit(); expect(off).toHaveBeenCalledOnce(); expect(backends[0].dispose).toHaveBeenCalledOnce();
});
it('stopAllSources silences the latest source and resets its playOnAwake trigger', async () => {
    const plugin=new AudioPlugin(), app=build(plugin); await app.getResource(Audio).preload('a.wav');
    const entity=app.world.spawn(); app.world.insert(entity,AudioSource,{clip:'a.wav',playOnAwake:true});
    await app.tick(1/60); const old=vi.mocked(backends[0].play).mock.results[0].value;
    plugin.stopAllSources(); expect(old.isPlaying).toBe(false);
    await app.tick(1/60); expect(backends[0].play).toHaveBeenCalledTimes(2);
});
it('leaving play mode ends the sources and the music the session started (issue #227)', async () => {
    const { setEditorMode, setPlayMode } = await import('../src/ecs/env');
    setEditorMode(true); setPlayMode(true);
    try {
        const app = build(new AudioPlugin()), audio = app.getResource(Audio);
        await audio.preload('loop.wav'); await audio.preload('bgm.wav');
        const entity = app.world.spawn(); app.world.insert(entity, AudioSource, { clip: 'loop.wav', playOnAwake: true, loop: true });
        await app.tick(1 / 60);
        audio.playBGM('bgm.wav'); await new Promise(done => setTimeout(done, 0));
        const voices = vi.mocked(backends[0].play).mock.results.map(r => r.value as AudioHandle);
        expect(voices.length).toBe(2); expect(voices.every(v => v.isPlaying)).toBe(true);
        setPlayMode(false); await app.tick(1 / 60);
        expect(voices.map(v => v.isPlaying)).toEqual([false, false]);
        // Back in play, an awake source wakes again rather than staying silent.
        setPlayMode(true); await app.tick(1 / 60);
        expect(backends[0].play).toHaveBeenCalledTimes(3);
    } finally { setEditorMode(false); setPlayMode(false); }
});

it('installs per-app event ownership and releases an emitter when its entity despawns', async () => {
    const plugin = new AudioPlugin(), app = build(plugin), owner = app.world.spawn(), release = vi.fn();
    const lease = { key: 'steps', generation: 1, value: parseSoundEvent({ version: 1, clips: [] }), release, retain: () => null };
    app.insertResource(Assets, { acquireTyped: vi.fn().mockResolvedValue(lease) } as unknown as import('../src/asset/Assets').Assets);
    const events = app.getResource(SoundEvents), emitter = (await events.load('steps.esaudioevent', { owner }))!;
    app.world.despawn(owner); expect(emitter.disposed).toBe(true); expect(release).toHaveBeenCalledOnce();
    expect(events.getStats().emitters).toBe(0); app.quit(); expect(app.world.getStorageSizes().coreDisconnectCallbacks).toBe(0);
});

it('registry disconnect releases entity event owners and late definition loads cannot cross app quit', async () => {
    const app = build(new AudioPlugin()), owner = app.world.spawn(), release = vi.fn();
    const lease = { key: 'steps', generation: 1, value: parseSoundEvent({ version: 1, clips: [] }), release, retain: () => null };
    let resolve!: (value: typeof lease) => void;
    const acquire = vi.fn().mockResolvedValueOnce(lease).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    app.insertResource(Assets, { acquireTyped: acquire } as unknown as import('../src/asset/Assets').Assets);
    const events = app.getResource(SoundEvents), emitter = (await events.load('steps.esaudioevent', { owner }))!;
    app.world.disconnectCpp(); expect(emitter.disposed).toBe(true); expect(release).toHaveBeenCalledOnce();
    const pending = events.load('later.esaudioevent'); app.quit(); resolve(lease);
    expect(await pending).toBeNull(); expect(release).toHaveBeenCalledTimes(2);
});
