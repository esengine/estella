// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { Audio, type AudioAPI } from '../src/audio/Audio';
import { CameraDirector, createDirectorState } from '../src/camera/CameraDirector';
import { EntityEvents } from '../src/ecs/entityEvents';
import { Prefabs, type PrefabServer } from '../src/prefab/prefabServer';
import { Timeline } from '../src/timeline/TimelineControl';
import { TimelinePlayer, TimelinePlugin, timelineSignalType } from '../src/timeline/TimelinePlugin';
import { TrackType, WrapMode, type TimelineAsset } from '../src/timeline/TimelineTypes';
import { connectFakeCpp } from './helpers/fakeEngine';

const apps: App[] = [];
const asset: TimelineAsset = {
    version: '1.3', type: 'timeline', duration: 5, wrapMode: WrapMode.Once,
    tracks: [
        { type: TrackType.Camera, name: '', childPath: '', clips: [
            { start: 0, duration: 5, camera: '@View' },
        ] },
        { type: TrackType.Audio, name: '', childPath: '', events: [
            { time: 0, duration: 5, clip: 'dialogue.wav', volume: 1 },
        ] },
        { type: TrackType.Spawn, name: '', childPath: '', clips: [
            { start: 0, duration: 5, prefab: 'actor.esprefab', name: '' },
        ] },
    ],
};

function playerIn(plugin: TimelinePlugin, withHierarchy = false) {
    const app = App.new();
    apps.push(app);
    if (withHierarchy) connectFakeCpp(app.world);
    app.addPlugin(plugin);
    const voice = { stop: vi.fn(), setVolume: vi.fn() };
    const playClip = vi.fn(() => voice);
    app.insertResource(Audio, { playClip } as unknown as AudioAPI);
    const spawn = vi.fn(() => ({ root: app.world.spawn() }));
    const release = vi.fn();
    const instantiate = vi.fn(async () => spawn());
    app.insertResource(Prefabs, { instantiate, prepare: async () => ({ spawn, release }) } as unknown as PrefabServer);
    const timeline = app.getResource(Timeline);
    timeline.registerAsset('intro', asset);
    const player = app.world.spawn();
    const camera = app.world.spawn();
    const director = createDirectorState();
    app.insertResource(CameraDirector, director);
    app.world.insert(player, TimelinePlayer, { timeline: 'intro', playing: true, bindingNames: ['View'], bindings: [camera] });
    return { app, player, timeline, voice, playClip, spawn, release, camera, director };
}

afterEach(() => {
    for (const app of apps.splice(0)) app.quit();
});

it.each(['stop', 'unpublish', 'remove', 'cleanup'] as const)('gives back the camera on %s after a pause', async action => {
    const plugin = new TimelinePlugin();
    const { app, player, timeline, director, camera, voice, release } = playerIn(plugin);
    await app.tick(0.1);
    expect(director.timelineShot?.to).toBe(camera);
    timeline.pause(player);
    await app.tick(0.1);
    expect(director.timelineShot?.to).toBe(camera);

    if (action === 'stop') timeline.stop(player);
    if (action === 'unpublish') timeline.unregisterAsset('intro');
    if (action === 'remove') app.world.remove(player, TimelinePlayer);
    if (action === 'cleanup') plugin.cleanup(app);
    await app.tick(0.1);

    expect(director.timelineShot).toBeNull();
    expect(director.timelineOwner).toBe(-1);
    expect(app.world.valid(player)).toBe(true);
    if (action === 'remove') {
        expect(timeline.getState(player)).toBeUndefined();
        expect(voice.stop).toHaveBeenCalledOnce();
        expect(release).toHaveBeenCalledOnce();
    }
});

it('updates the view when the paused player seeks into and out of a nested shot', async () => {
    const { app, player, timeline, director, camera } = playerIn(new TimelinePlugin());
    const close = app.world.spawn();
    const flags = app.world.get(player, TimelinePlayer);
    app.world.insert(player, TimelinePlayer, { ...flags, bindingNames: ['View', 'Close'], bindings: [camera, close] });
    timeline.registerAsset('intro', { ...asset, tracks: [{
        type: TrackType.Camera, name: '', childPath: '', clips: [{ start: 0, duration: 1, camera: '@View' }],
    }, {
        type: TrackType.Sequence, name: '', childPath: '', clips: [
            { start: 1, duration: 2, timeline: 'close', root: '', speed: 1, loop: false },
        ],
    }] });
    timeline.registerAsset('close', { ...asset, duration: 2, tracks: [{
        type: TrackType.Camera, name: '', childPath: '', clips: [{ start: 0, duration: 2, camera: '@Close' }],
    }] });
    await app.tick(0.5);
    expect(director.timelineShot?.to).toBe(camera);
    timeline.pause(player);
    timeline.setTime(player, 2);
    await app.tick(0.5);
    expect(director.timelineShot?.to).toBe(close);
    expect(timeline.getCurrentTime(player)).toBe(2);
    timeline.setTime(player, 3.5);
    await app.tick(0.5);
    expect(director.timelineShot).toBeNull();
    expect(timeline.isPlaying(player)).toBe(false);
    timeline.setTime(player, 2);
    timeline.stop(player);
    await app.tick(0.5);
    expect(director.timelineShot).toBeNull();
});

it('dispatches nested markers and events from the nested root while retaining the original player', async () => {
    const { app, player, timeline, camera } = playerIn(new TimelinePlugin(), true);
    const panel = app.world.spawn('Panel');
    app.world.setParent(panel, camera);
    timeline.registerAsset('intro', { ...asset, tracks: [{
        type: TrackType.Sequence, name: '', childPath: '', clips: [
            { start: 0.5, duration: 3, timeline: 'scene', root: '@View', speed: 1, loop: true },
        ],
    }] });
    timeline.registerAsset('scene', { ...asset, duration: 1, tracks: [
        { type: TrackType.Marker, name: '', childPath: '', markers: [{ time: 0, name: 'enter' }] },
        { type: TrackType.CustomEvent, name: '', childPath: 'Panel', events: [{ time: 0.25, name: 'show', payload: { layer: 2 } }] },
    ] });
    const events = app.getResource(EntityEvents);
    const entered = vi.fn(), shown = vi.fn(), bubbled = vi.fn();
    events.on(camera, timelineSignalType('enter'), entered);
    events.on(panel, timelineSignalType('show'), shown);
    events.on(player, timelineSignalType('show'), bubbled);

    await app.tick(0.5);
    expect(entered.mock.calls).toEqual([[expect.objectContaining({
        target: camera, data: expect.objectContaining({ kind: 'marker', player, time: 0 }),
    })]]);
    timeline.pause(player);
    timeline.setTime(player, 1.5);
    await app.tick(0.1);
    expect(entered).toHaveBeenCalledOnce();
    expect(shown).not.toHaveBeenCalled();

    timeline.play(player);
    await app.tick(0.25);
    expect(entered).toHaveBeenCalledOnce();
    expect(shown.mock.calls).toEqual([[expect.objectContaining({
        target: panel, data: expect.objectContaining({ kind: 'event', player, time: 0.25, payload: { layer: 2 } }),
    })]]);
    expect(bubbled).toHaveBeenCalledOnce();
});

it('does not restore a shot or player removed by its own timeline marker', async () => {
    const { app, player, timeline, director } = playerIn(new TimelinePlugin());
    timeline.registerAsset('intro', { ...asset, duration: 1, tracks: [asset.tracks[0]!, {
        type: TrackType.Marker, childPath: '', name: '', markers: [{ time: 0.75, name: 'retire' }],
    }] });
    app.getResource(EntityEvents).on(player, timelineSignalType('retire'), () => app.world.remove(player, TimelinePlayer));
    await app.tick(0.5);
    expect(director.timelineOwner).toBe(player);
    await app.tick(0.5);
    expect(app.world.has(player, TimelinePlayer)).toBe(false);
    expect(timeline.getState(player)).toBeUndefined();
    expect(director.timelineShot).toBeNull();
});

it('does not take back a shot after a marker stops its player', async () => {
    const { app, player, timeline, director } = playerIn(new TimelinePlugin());
    timeline.registerAsset('intro', { ...asset, tracks: [asset.tracks[0]!, {
        type: TrackType.Marker, childPath: '', name: '', markers: [{ time: 0.75, name: 'stop' }],
    }] });
    app.getResource(EntityEvents).on(player, timelineSignalType('stop'), () => timeline.stop(player));
    await app.tick(0.5);
    expect(director.timelineOwner).toBe(player);
    await app.tick(0.5);
    expect(director.timelineShot).toBeNull();
    expect(timeline.getCurrentTime(player)).toBe(0);
    expect(app.world.get(player, TimelinePlayer).playing).toBe(false);
});

it.each([0.25, 1])('drops remaining cues when a marker at the end of a clip seeks to %s', async destination => {
    const { app, player, timeline } = playerIn(new TimelinePlugin());
    timeline.registerAsset('intro', { ...asset, duration: 1, tracks: [{
        type: TrackType.Marker, name: '', childPath: '', markers: [{ time: 0.75, name: 'seek' }, { time: 0.9, name: 'stale' }],
    }] });
    const events = app.getResource(EntityEvents), stale = vi.fn();
    events.on(player, timelineSignalType('seek'), () => timeline.setTime(player, destination));
    events.on(player, timelineSignalType('stale'), stale);

    await app.tick(1);
    expect(stale).not.toHaveBeenCalled();
    expect(timeline.getCurrentTime(player)).toBe(destination);
    expect(app.world.get(player, TimelinePlayer)).toMatchObject({ playing: true, finished: false });
});

it('drops later nested cues and state when a nested marker stops playback', async () => {
    const { app, player, timeline } = playerIn(new TimelinePlugin());
    const nested = (name: string): TimelineAsset => ({ ...asset, duration: 1, tracks: [{
        type: TrackType.Marker, name: '', childPath: '', markers: [{ time: 0.25, name }],
    }] });
    timeline.registerAsset('stopper', nested('stop'));
    timeline.registerAsset('sibling', nested('stale'));
    timeline.registerAsset('intro', { ...asset, tracks: [{
        type: TrackType.Sequence, name: '', childPath: '', clips: ['stopper', 'sibling'].map(ref => ({
            start: 0, duration: 1, timeline: ref, root: '', speed: 1, loop: false,
        })),
    }] });
    const events = app.getResource(EntityEvents), stale = vi.fn();
    events.on(player, timelineSignalType('stop'), () => timeline.stop(player));
    events.on(player, timelineSignalType('stale'), stale);

    await app.tick(0.5);
    expect(stale).not.toHaveBeenCalled();
    expect(timeline.getState(player)).toMatchObject({ time: 0, playing: false });
    expect(timeline.getState(player)?.nested).toEqual({});
});

it('plays the same entity ID independently in two apps sharing a timeline plugin', async () => {
    const plugin = new TimelinePlugin();
    const first = playerIn(plugin);
    const second = playerIn(plugin);
    expect(first.player).toBe(second.player);
    await first.app.tick(0.1);
    await second.app.tick(0.1);

    expect(first.playClip).toHaveBeenCalledOnce();
    expect(second.playClip).toHaveBeenCalledOnce();
    expect(first.spawn).toHaveBeenCalledOnce();
    expect(second.spawn).toHaveBeenCalledOnce();

    first.app.quit();
    expect(first.voice.stop).toHaveBeenCalledOnce();
    expect(first.release).toHaveBeenCalledOnce();
    expect(second.voice.stop).not.toHaveBeenCalled();
    expect(second.release).not.toHaveBeenCalled();
    expect(second.app.world.valid(second.spawn.mock.results[0]!.value.root)).toBe(true);

    await second.app.tick(0.1);
    expect(second.timeline.getCurrentTime(second.player)).toBeCloseTo(0.2);
    second.app.world.despawn(second.player);
    expect(second.timeline.getState(second.player)).toBeUndefined();
    expect(second.director.timelineShot).toBeNull();
    expect(second.voice.stop).toHaveBeenCalledOnce();
    expect(second.release).toHaveBeenCalledOnce();
});

it('a failed installation leaves the playing app and its despawn listener intact', async () => {
    const plugin = new TimelinePlugin();
    const main = playerIn(plugin);
    await main.app.tick(0.1);
    const preview = App.new();
    apps.push(preview);
    vi.spyOn(preview, 'insertResource').mockImplementationOnce(() => { throw Error('installation failed'); });
    expect(() => preview.addPlugin(plugin)).toThrow('installation failed');

    expect(main.voice.stop).not.toHaveBeenCalled();
    main.app.world.despawn(main.player);
    expect(main.timeline.getState(main.player)).toBeUndefined();
    expect(main.voice.stop).toHaveBeenCalledOnce();
});

it('parameterless cleanup releases the latest installation once', async () => {
    const plugin = new TimelinePlugin();
    const first = playerIn(plugin);
    await first.app.tick(0.1);
    const latest = playerIn(plugin);
    await latest.app.tick(0.1);
    plugin.cleanup();
    plugin.cleanup();
    expect(first.voice.stop).not.toHaveBeenCalled();
    expect(latest.voice.stop).toHaveBeenCalledOnce();
    await latest.app.tick(0.1);
    expect(latest.playClip).toHaveBeenCalledTimes(1);
    latest.app.quit();
    expect(latest.release).toHaveBeenCalledOnce();
    first.app.world.despawn(first.player);
    expect(first.voice.stop).toHaveBeenCalledOnce();
});
