// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/wasm/resourceManager', () => ({ requireResourceManager: () => ({}), getResourceManager: () => null, evictTextureDimensions: vi.fn() }));
import { AudioAPI } from '../src/audio/Audio';
import type { AudioHandle, AudioBufferHandle, PlatformAudioBackend, PlayConfig } from '../src/audio/PlatformAudioBackend';
import { Assets } from '../src/asset/Assets';
import type { Backend } from '../src/asset/Backend';
import { SoundEventPlayback } from '../src/audio/SoundEventPlayback';
import { MiniGameAudioBackend } from '../src/audio/MiniGameAudioBackend';
import type { MiniGameGlobal, MiniGameInnerAudioContext } from '../src/platform/minigame/api';
import type { Entity } from '../src/types';
import { World } from '../src/ecs/world';
import { SoundEventSource } from '../src/audio/AudioComponents';
import { SoundEventSourceController, triggerSoundEventSource, stopSoundEventSource } from '../src/audio/SoundEventSource';
import { aiRegistry, noInput } from '../src/ai/fsm/AiContext';
import { ensureBuiltinAiRegistrations } from '../src/ai/builtins';
import { Blackboard } from '../src/ai/fsm/Blackboard';
import { compileScriptGraph, createScriptRunState, stepScriptGraph } from '../src/logic/ScriptGraphRunner';
import { scriptCatalog } from '../src/logic/nodes';
import { SCRIPT_GRAPH_VERSION } from '../src/logic/types';

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0)) close(); vi.restoreAllMocks(); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

function fixture(extra: Record<string, unknown> = {}, actualBackend?: PlatformAudioBackend) {
    let id = 0;
    const voices: Array<{ handle: AudioHandle; end(): void; config: PlayConfig }> = [];
    const backend = {
        name: 'counting', mixer: null, isReady: true, delivery: 'bytes' as const,
        initialize: vi.fn(async () => {}), ensureResumed: vi.fn(async () => {}),
        loadBuffer: vi.fn(async () => ({ id: ++id, bytes: 4, duration: 1 })),
        loadBufferFromData: vi.fn(async () => ({ id: ++id, bytes: 4, duration: 1 })), unloadBuffer: vi.fn(),
        suspend: vi.fn(), resume: vi.fn(), dispose: vi.fn(),
        play: vi.fn((_buffer: AudioBufferHandle, config: PlayConfig = {}): AudioHandle => {
            let playing = true, stopped = false;
            const handle: AudioHandle = { id: ++id, currentTime: 0, duration: 1,
                get isPlaying() { return playing; },
                stop: vi.fn(() => { playing = false; stopped = true; }), pause: vi.fn(() => { playing = false; }),
                resume: vi.fn(() => { if (!stopped) playing = true; }), setVolume: vi.fn(), setPan: vi.fn(),
                setLoop: vi.fn(), setPlaybackRate: vi.fn(),
            };
            voices.push({ handle, config, end() { playing = false; handle.onEnd?.(); } }); return handle;
        }),
    } satisfies PlatformAudioBackend;
    const audio = new AudioAPI(actualBackend ?? backend); audio.setBufferBudget(0);
    let document: Record<string, unknown> = { version: 1, mode: 'sequence', clips: [{ clip: 'a.wav' }, { clip: 'b.wav' }], ...extra };
    const fetchText = vi.fn(async () => JSON.stringify(document));
    const fetchBinary = vi.fn(async () => new ArrayBuffer(4));
    const resources = Assets.create({ module: null, getAudio: () => audio, backend: { fetchText, fetchBinary,
        resolveUrl: (ref: string) => ref, setBaseUrl() {} } as unknown as Backend });
    const alive = new Set<Entity>(), positions = new Map<Entity, { x: number; y: number; z: number }>();
    const events = new SoundEventPlayback(audio, () => resources, owner => alive.has(owner), owner => positions.get(owner) ?? null);
    cleanup.push(() => { events.dispose(); resources.releaseAll(); audio.dispose(); });
    return { events, audio, backend, voices, resources, alive, positions, fetchText, fetchBinary,
        setDocument: (next: typeof document) => { document = next; } };
}

function sourceFixture(extra: Record<string, unknown> = {}) {
    const f = fixture(extra), world = new World(), entity = world.spawn();
    f.alive.add(entity); world.insert(entity, SoundEventSource, { event: 'steps.esaudioevent', seed: 9 });
    const controller = new SoundEventSourceController(world, f.events, f.audio);
    cleanup.unshift(() => controller.dispose());
    return { ...f, world, entity, controller, trigger: () => triggerSoundEventSource(world, entity) };
}

it('excludes every spelling of the last clip from the next event trigger', async () => {
    const id = 'abcdfed0-1111-4222-8333-444455556666';
    const step = 'assets/audio/step.wav', tap = 'assets/audio/tap.wav';
    const { resources, events } = fixture({ mode: 'no-repeat',
        clips: [{ clip: step }, { clip: `@uuid:${id}` }, { clip: id.toUpperCase() }, { clip: tap }] });
    resources.setAssetRefResolver(ref => ref.toLowerCase().replace(/^@uuid:/, '') === id ? step : ref);
    const emitter = (await events.load('steps.esaudioevent', { seed: 12 }))!;
    expect(emitter.getVariantShares().map(row => row.share)).toEqual([.75, null, null, .25]);
    const slots: number[] = [];
    for (let i = 0; i < 20; ++i) {
        const voice = emitter.trigger();
        expect(await voice.ready).toBe('playing');
        slots.push(voice.selection!.slot);
        voice.stop();
    }
    expect(new Set(slots)).toEqual(new Set([0, 3]));
    expect(slots.every((slot, i) => i === 0 || slot !== slots[i - 1])).toBe(true);
});

it('keeps two authored audio records independently selectable when the build shares their cooked bytes', async () => {
    const key = 'abcdfed0-1111-4222-8333-444455556666';
    const { resources, events, fetchBinary } = fixture({ mode: 'no-repeat',
        clips: [{ clip: '@uuid:' + key }, { clip: 'step.wav' }, { clip: 'echo.wav' }] });
    const file = { path: 'assets/shared.wav', type: 'audio' as const, labels: [], size: 4 };
    resources.setManifest({ version: '2.0', groups: { sound: { bundleMode: 'local', labels: [], assets: {
        [key]: { ...file, address: 'step.wav' }, echo: { ...file, address: 'echo.wav' },
    } } } });
    const emitter = (await events.load('steps.esaudioevent', { seed: 7 }))!;
    expect(emitter.getVariantShares().map(row => row.share)).toEqual([2 / 3, null, 1 / 3]);
    expect(fetchBinary).not.toHaveBeenCalled();
    const voice = emitter.trigger();
    expect(await voice.ready).toBe('playing');
    expect(emitter.getVariantShares().map(row => row.share)).toEqual(voice.selection?.slot === 0 ? [0, null, 1] : [1, null, 0]);
});

describe('component-owned event intents', () => {
    it('keeps same-frame cold triggers in FIFO order with one definition load', async () => {
        const { trigger, fetchText, backend } = sourceFixture();
        const handles = (await Promise.all([trigger(), trigger(), trigger()]))!;
        expect(handles.map(handle => handle?.selection?.clip)).toEqual(['a.wav', 'b.wav', 'a.wav']);
        await Promise.all(handles.map(handle => handle?.ready));
        expect(fetchText).toHaveBeenCalledOnce(); expect(backend.play).toHaveBeenCalledTimes(3);
    });

    it('bounds cold intent storage and applies event limits only through shared playback', async () => {
        const { trigger, fetchText, events, backend } = sourceFixture({ maxInstances: 1 });
        const text = deferred<string>(); fetchText.mockReturnValue(text.promise);
        const pending = Array.from({ length: 256 }, trigger);
        expect(await trigger()).toBeNull();
        text.resolve(JSON.stringify({ version: 1, clips: [{ clip: 'a.wav' }], maxInstances: 1 }));
        const handles = await Promise.all(pending); await handles[0]!.ready;
        expect(handles.filter(handle => handle?.reason === 'event-limit')).toHaveLength(255);
        expect(events.getStats()).toMatchObject({ active: 1, admitted: 1, rejected: 255 });
        expect(backend.play).toHaveBeenCalledOnce();
    });

    it.each(['stop', 'global-stop', 'remove', 'disable', 'replace', 'reinsert', 'dispose'])(
        'cancels a cold definition on %s and resolves every waiter', async mode => {
            const { world, entity, trigger, fetchText, backend, controller, audio, events } = sourceFixture();
            const text = deferred<string>(); fetchText.mockReturnValueOnce(text.promise);
            const pending = [trigger(), trigger()];
            if (mode === 'stop') stopSoundEventSource(world, entity);
            if (mode === 'global-stop') audio.stopAll();
            if (mode === 'remove') world.remove(entity, SoundEventSource);
            if (mode === 'disable') world.update(entity, SoundEventSource, data => { data.enabled = false; });
            if (mode === 'replace') world.update(entity, SoundEventSource, data => { data.event = 'other.esaudioevent'; });
            if (mode === 'reinsert') { world.remove(entity, SoundEventSource); world.insert(entity, SoundEventSource, { event: 'steps.esaudioevent' }); }
            if (mode === 'dispose') controller.dispose();
            controller.update();
            expect(await Promise.all(pending)).toEqual([null, null]);
            text.resolve(JSON.stringify({ version: 1, clips: [{ clip: 'a.wav' }] }));
            await new Promise(done => setTimeout(done, 0));
            expect(backend.play).not.toHaveBeenCalled(); expect(events.getStats().pendingDefinitions).toBe(0);
            expect(events.getStats().active).toBe(0);
        });

    it('does not start a late clip after same-frame component removal, even before update', async () => {
        const { world, entity, trigger, fetchBinary, backend, audio } = sourceFixture();
        const clip = deferred<ArrayBuffer>(); fetchBinary.mockReturnValueOnce(clip.promise);
        const handle = (await trigger())!;
        world.remove(entity, SoundEventSource);
        clip.resolve(new ArrayBuffer(4));
        expect(await handle.ready).toBe('rejected'); expect(handle.reason).toBe('owner-gone');
        expect(backend.play).not.toHaveBeenCalled(); expect(audio.getBufferStats().bufferCount).toBe(0);
    });

    it('keeps new-generation cold triggers created by a reentrant Stop All observer', async () => {
        const f = sourceFixture(); f.controller.dispose();
        let next!: Promise<import('../src/audio/SoundEventPlayback').SoundEventHandle | null>;
        const off = f.audio.onPlaybackStop(() => { next = f.trigger(); });
        const controller = new SoundEventSourceController(f.world, f.events, f.audio);
        cleanup.unshift(() => { off(); controller.dispose(); });
        const text = deferred<string>(); f.fetchText.mockReturnValueOnce(text.promise);
        const previous = f.trigger(); f.audio.stopAll(); expect(await previous).toBeNull();
        text.resolve(JSON.stringify({ version: 1, clips: [{ clip: 'a.wav' }] }));
        expect(await (await next)!.ready).toBe('playing'); expect(f.backend.play).toHaveBeenCalledOnce();
    });

    it('cancels definitions made stale before the next controller update', async () => {
        const { trigger, fetchText, world, entity, backend, events } = sourceFixture();
        const text = deferred<string>(); fetchText.mockReturnValueOnce(text.promise);
        const pending = trigger(); world.remove(entity, SoundEventSource);
        text.resolve(JSON.stringify({ version: 1, clips: [{ clip: 'a.wav' }] }));
        expect(await pending).toBeNull(); expect(backend.play).not.toHaveBeenCalled();
        expect(events.getStats()).toMatchObject({ emitters: 0, pendingDefinitions: 0 });
    });

    it('stops only source-owned emitters and can trigger again without replaying awake', async () => {
        const { entity, world, trigger, events, controller, backend } = sourceFixture();
        world.update(entity, SoundEventSource, data => { data.playOnAwake = true; });
        const independent = (await events.load('steps.esaudioevent', { owner: entity }))!;
        const other = independent.trigger(); await other.ready;
        const owned = (await trigger())!; await owned.ready;
        stopSoundEventSource(world, entity); controller.update();
        expect(owned.status).toBe('stopped'); expect(other.status).toBe('playing');
        expect(backend.play).toHaveBeenCalledTimes(2);
        const next = (await trigger())!; expect(await next.ready).toBe('playing');
        expect(next.selection?.clip).toBe('a.wav');
    });

    it('plays awake once per incarnation and invalidates an old loading clip after seed changes', async () => {
        const { world, entity, controller, backend, fetchBinary } = sourceFixture();
        world.update(entity, SoundEventSource, data => { data.playOnAwake = true; });
        controller.update(); await new Promise(done => setTimeout(done, 0));
        controller.update(); expect(backend.play).toHaveBeenCalledOnce();
        world.remove(entity, SoundEventSource);
        world.insert(entity, SoundEventSource, { event: 'steps.esaudioevent', seed: 9, playOnAwake: true });
        const clip = deferred<ArrayBuffer>(); fetchBinary.mockReturnValue(clip.promise);
        controller.update(); await new Promise(done => setTimeout(done, 0));
        world.update(entity, SoundEventSource, data => { data.seed = 10; });
        clip.resolve(new ArrayBuffer(4)); await new Promise(done => setTimeout(done, 0));
        expect(backend.play).toHaveBeenCalledOnce();
        controller.update(); await new Promise(done => setTimeout(done, 0));
        expect(backend.play).toHaveBeenCalledTimes(2);
    });

    it('uses the same entry through graph/FSM actions and preserves other worlds on disposal', async () => {
        const a = sourceFixture(), b = sourceFixture();
        ensureBuiltinAiRegistrations();
        const ctx = { world: a.world, entity: a.entity, dt: 1 / 60, input: noInput(), blackboard: new Blackboard(),
            commands: {} as never, has: (c: typeof SoundEventSource) => a.world.has(a.entity, c),
            get: (c: typeof SoundEventSource) => a.world.get(a.entity, c), set: () => {} };
        const compiled = compileScriptGraph({ version: SCRIPT_GRAPH_VERSION,
            nodes: [{ id: 'start', kind: 'event.start' }, { id: 'a', kind: 'call', ref: 'soundEvent.trigger' },
                { id: 'b', kind: 'call', ref: 'soundEvent.trigger' }],
            edges: [{ id: 'one', from: 'start', fromPort: 'then', to: 'a', toPort: '' },
                { id: 'two', from: 'a', fromPort: 'then', to: 'b', toPort: '' }],
        }, scriptCatalog(aiRegistry));
        expect(compiled.problems).toEqual([]);
        stepScriptGraph(compiled, createScriptRunState(compiled), { ctx: ctx as never,
            bb: ctx.blackboard, registry: aiRegistry, dt: ctx.dt });
        await new Promise(done => setTimeout(done, 0)); expect(a.backend.play).toHaveBeenCalledTimes(2);
        aiRegistry.getAction('soundEvent.stop')!(ctx as never, ctx.blackboard);
        expect(a.events.getStats().active).toBe(0);
        a.controller.dispose(); expect(await a.trigger()).toBeNull();
        expect(await (await b.trigger())!.ready).toBe('playing');
    });
});

describe('event admission and owned playback', () => {
    it('loads definitions without fetching clips and releases its definition on emitter disposal', async () => {
        const { events, fetchBinary } = fixture(); const emitter = (await events.load('steps.esaudioevent', { seed: 1 }))!;
        expect(fetchBinary).not.toHaveBeenCalled(); expect(events.getStats().emitters).toBe(1);
        emitter.dispose(); emitter.dispose(); expect(events.getStats()).toMatchObject({ definitions: 0, emitters: 0, active: 0 });
        expect(emitter.trigger().reason).toBe('disposed');
    });

    it('holds one event slot through loading and pause, then frees it on natural completion', async () => {
        const { events, fetchBinary, voices, audio } = fixture({ maxInstances: 1 });
        const load = deferred<ArrayBuffer>(); fetchBinary.mockReturnValue(load.promise);
        const emitter = (await events.load('steps.esaudioevent'))!, first = emitter.trigger(); first.pause();
        expect(emitter.trigger().reason).toBe('event-limit'); expect(events.getStats().pendingClips).toBe(1);
        load.resolve(new ArrayBuffer(4)); expect(await first.ready).toBe('paused');
        expect(emitter.trigger().reason).toBe('event-limit'); first.resume(); expect(first.status).toBe('playing');
        const ended = vi.fn(); first.onEnd = ended; voices[0].end();
        expect(first.status).toBe('ended'); expect(ended).toHaveBeenCalledOnce();
        expect(audio.getBufferStats().bufferCount).toBe(0);
        expect(await emitter.trigger().ready).toBe('playing');
    });

    it('shares event limits and cooldown across emitters without advancing rejected choices', async () => {
        const { events, backend } = fixture({ maxInstances: 1, cooldown: .5 });
        const a = (await events.load('steps.esaudioevent', { seed: 4 }))!, b = (await events.load('steps.esaudioevent', { seed: 4 }))!;
        const first = a.trigger(); await first.ready;
        expect(b.trigger().reason).toBe('cooldown'); first.stop(); expect(a.trigger().reason).toBe('cooldown');
        events.update(.5); const second = a.trigger(); expect(second.selection?.clip).toBe('b.wav'); await second.ready;
        events.update(.5); expect(b.trigger().reason).toBe('event-limit'); expect(backend.play).toHaveBeenCalledTimes(2);
    });

    it('uses global priority admission and releases clips after refusal or stealing a paused voice', async () => {
        const { events, audio, backend } = fixture({ maxInstances: 1, priority: 2 }); audio.setMaxVoices(1);
        const buffer = { id: 900, duration: 1 }; const high = audio.playBuffer(buffer, { priority: 9 });
        const emitter = (await events.load('steps.esaudioevent'))!;
        const rejected = emitter.trigger(); expect(await rejected.ready).toBe('rejected'); expect(rejected.reason).toBe('global-limit');
        expect(events.getStats().active).toBe(0); high.stop();
        const first = emitter.trigger(); await first.ready; first.pause();
        audio.playBuffer(buffer, { priority: 9 }); expect(first.status).toBe('stopped');
        expect(events.getStats().active).toBe(0); expect(backend.play).toHaveBeenCalledTimes(3);
    });

    it('cancels pending clips synchronously on Audio.stopAll and cannot resume them later', async () => {
        const { events, audio, fetchBinary, backend } = fixture({ maxInstances: 1 });
        const load = deferred<ArrayBuffer>(); fetchBinary.mockReturnValue(load.promise);
        const emitter = (await events.load('steps.esaudioevent'))!, pending = emitter.trigger();
        audio.stopAll(); expect(await pending.ready).toBe('stopped'); expect(events.getStats().active).toBe(0);
        pending.resume(); load.resolve(new ArrayBuffer(4)); await new Promise(done => setTimeout(done, 0));
        expect(backend.play).not.toHaveBeenCalled(); expect(audio.getBufferStats().bufferCount).toBe(0);
        expect(await emitter.trigger().ready).toBe('playing');
    });

    it('cancels owner definition and clip loads and returns every late lease', async () => {
        const { events, fetchText, fetchBinary, alive, backend } = fixture(); const owner = 123 as Entity; alive.add(owner);
        const definition = deferred<string>(); fetchText.mockReturnValueOnce(definition.promise);
        const loading = events.load('steps.esaudioevent', { owner }); events.stopOwner(owner); alive.delete(owner);
        definition.resolve(JSON.stringify({ version: 1, clips: [] })); expect(await loading).toBeNull();
        alive.add(owner); const emitter = (await events.load('other.esaudioevent', { owner }))!;
        const clip = deferred<ArrayBuffer>(); fetchBinary.mockReturnValueOnce(clip.promise);
        const pending = emitter.trigger(); events.stopOwner(owner); expect(await pending.ready).toBe('stopped');
        clip.resolve(new ArrayBuffer(4)); await new Promise(done => setTimeout(done, 0));
        expect(backend.play).not.toHaveBeenCalled(); expect(events.getStats()).toMatchObject({ definitions: 0, emitters: 0, active: 0 });
    });

    it('reports a missing selected resource by event, slot and clip without leaking an event slot', async () => {
        const { events, fetchBinary } = fixture({ clips: [{ clip: 'missing.wav' }], maxInstances: 1 });
        fetchBinary.mockRejectedValue(new Error('404'));
        const emitter = (await events.load('steps.esaudioevent'))!, request = emitter.trigger();
        expect(await request.ready).toBe('rejected'); expect(request.reason).toBe('load-failed');
        expect(request.error).toContain('steps.esaudioevent: clips[0].clip (missing.wav)');
        expect(events.getStats()).toMatchObject({ active: 0, played: 0, rejected: 1, reasons: { 'load-failed': 1 } });
    });

    it('applies bus gain and sampled rates through the existing AudioAPI', async () => {
        const { events, audio, voices } = fixture({ bus: 'ui', volume: [.4, .4], playbackRate: [1.3, 1.3], priority: 7 });
        audio.setUIVolume(.5); const emitter = (await events.load('click.esaudioevent'))!, request = emitter.trigger();
        await request.ready; expect(voices[0].config).toMatchObject({ bus: 'ui', playbackRate: 1.3, priority: 7, volume: 0 });
        expect(voices[0].handle.setVolume).toHaveBeenLastCalledWith(.2);
        request.setVolume(.8); expect(voices[0].handle.setVolume).toHaveBeenLastCalledWith(.4);
    });

    it('updates spatial attenuation from the owning entity and refuses absent world positions', async () => {
        const { events, alive, positions, voices } = fixture({ spatial: { model: 1, refDistance: 10, maxDistance: 1000, rolloff: 1 } });
        const owner = 9 as Entity; alive.add(owner); positions.set(owner, { x: 20, y: 0, z: 0 });
        const unowned = (await events.load('space.esaudioevent'))!; expect(unowned.trigger().reason).toBe('missing-position');
        const emitter = (await events.load('space.esaudioevent', { owner }))!; await emitter.trigger().ready;
        expect(voices[0].handle.setVolume).toHaveBeenLastCalledWith(.5);
        positions.set(owner, { x: 40, y: 0, z: 0 }); events.update(.1);
        expect(voices[0].handle.setVolume).toHaveBeenLastCalledWith(.25);
        alive.delete(owner); events.update(.1); expect(emitter.disposed).toBe(true);
        expect(events.getStats().active).toBe(0);
    });

    it.each([{ clips: [] }, { clips: [{ clip: 'a.wav', weight: 0 }] }])('does no clip IO for unavailable pools %j', async ({ clips }) => {
        const { events, fetchBinary } = fixture({ clips }); const emitter = (await events.load('empty.esaudioevent'))!;
        expect(await emitter.trigger().ready).toBe('rejected'); expect(fetchBinary).not.toHaveBeenCalled();
        expect(events.getStats().active).toBe(0);
    });

    it('does not resurrect a voice when Stop All runs synchronously inside backend play', async () => {
        const { events, backend, audio, voices } = fixture(); const play = backend.play.getMockImplementation()!;
        backend.play.mockImplementation((buffer, config) => { const handle = play(buffer, config); audio.stopAll(); return handle; });
        const emitter = (await events.load('steps.esaudioevent'))!, request = emitter.trigger();
        expect(await request.ready).toBe('stopped'); await new Promise(done => setTimeout(done, 0));
        expect(voices[0].handle.isPlaying).toBe(false); expect(events.getStats().active).toBe(0);
    });

    it('shares admission across hot-reloaded generations while each emitter keeps its own definition', async () => {
        const { events, resources, setDocument } = fixture({ maxInstances: 1 });
        const old = (await events.load('steps.esaudioevent'))!, first = old.trigger(); await first.ready;
        setDocument({ version: 1, clips: [{ clip: 'new.wav' }], maxInstances: 1 }); resources.invalidate('steps.esaudioevent');
        const next = (await events.load('steps.esaudioevent'))!;
        expect(events.getStats().definitions).toBe(1); expect(next.trigger().reason).toBe('event-limit');
        first.stop(); const changed = next.trigger(); expect(changed.selection?.clip).toBe('new.wav'); await changed.ready;
        old.dispose(); expect(events.getStats().active).toBe(1); next.dispose(); expect(events.getStats().definitions).toBe(0);
    });

    it('drains every receipt and count even if one release fails', async () => {
        const { events, resources, audio } = fixture();
        const acquire = resources.acquireTyped.bind(resources);
        resources.acquireTyped = async <T>(type: string, ref: string) => {
            const lease = await acquire<T>(type, ref);
            return type !== 'audio' ? lease : { ...lease, release() { lease.release(); throw new Error('release failed'); } };
        };
        const emitter = (await events.load('steps.esaudioevent'))!;
        await Promise.all([emitter.trigger().ready, emitter.trigger().ready]);
        expect(() => events.stopAll()).toThrow('release failed');
        expect(events.getStats().active).toBe(0); expect(audio.getBufferStats().bufferCount).toBe(0);
    });

    it('withdraws all event ownership when a backend stop throws', async () => {
        const { events, voices, audio } = fixture(); const emitter = (await events.load('steps.esaudioevent'))!;
        const requests = [emitter.trigger(), emitter.trigger()]; await Promise.all(requests.map(request => request.ready));
        vi.mocked(voices[0].handle.stop).mockImplementation(() => { throw new Error('stop failed'); });
        expect(() => audio.stopAll()).toThrow('stop failed');
        expect(requests.map(request => request.status)).toEqual(['stopped', 'stopped']);
        expect(voices[1].handle.isPlaying).toBe(false); expect(events.getStats().active).toBe(0);
        expect(audio.getBufferStats().bufferCount).toBe(0);
    });

    it('cancels a dense pending burst without starting late audio or retaining decoded buffers', async () => {
        const { events, fetchBinary, backend, audio } = fixture(); const clip = deferred<ArrayBuffer>(); fetchBinary.mockReturnValue(clip.promise);
        const emitter = (await events.load('steps.esaudioevent'))!;
        for (let i = 0; i < 512; ++i) emitter.trigger();
        await new Promise(done => setTimeout(done, 0));
        expect(events.getStats()).toMatchObject({ active: 512, pendingClips: 512 }); expect(fetchBinary).toHaveBeenCalledTimes(2);
        events.stopAll(); clip.resolve(new ArrayBuffer(4)); await new Promise(done => setTimeout(done, 0));
        expect(events.getStats()).toMatchObject({ active: 0, pendingClips: 0, stopped: 512 });
        expect(backend.play).not.toHaveBeenCalled(); expect(audio.getBufferStats().bufferCount).toBe(0);
    });

    it('uses real minigame streaming and rate controls without fetching PCM bytes', async () => {
        let ended: (() => void) | undefined, paused = true;
        const context = { src: '', loop: false, volume: 1, playbackRate: 1, startTime: 0, obeyMuteSwitch: true,
            get paused() { return paused; }, duration: 1, currentTime: 0,
            play() { paused = false; }, pause() { paused = true; }, stop() { paused = true; },
            destroy: vi.fn(), onEnded(callback: () => void) { ended = callback; }, onError() {},
        } satisfies MiniGameInnerAudioContext;
        const actual = new MiniGameAudioBackend({ createInnerAudioContext: () => context } as unknown as MiniGameGlobal);
        const { events, fetchBinary, audio } = fixture({ volume: [.4, .4], playbackRate: [1.25, 1.25], maxInstances: 1 }, actual);
        const emitter = (await events.load('steps.esaudioevent', { seed: 5 }))!, request = emitter.trigger();
        expect(await request.ready).toBe('playing'); expect(context.src).toBe('a.wav');
        expect(context.playbackRate).toBe(1.25); expect(context.volume).toBe(.4); expect(fetchBinary).not.toHaveBeenCalled();
        audio.suspend(); events.update(.1); expect(emitter.trigger().reason).toBe('event-limit');
        audio.resume(); expect(request.isPlaying).toBe(true);
        paused = true; ended?.(); expect(request.status).toBe('ended'); expect(events.getStats().active).toBe(0);
    });
});
