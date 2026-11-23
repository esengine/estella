// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { Audio, type AudioAPI } from '../src/audio/Audio';
import { Prefabs, type PrefabServer } from '../src/prefab/prefabServer';
import { Timeline } from '../src/timeline/TimelineControl';
import { TimelinePlayer, TimelinePlugin } from '../src/timeline/TimelinePlugin';
import { TrackType, WrapMode, type TimelineAsset } from '../src/timeline/TimelineTypes';

const apps: App[] = [];
const asset: TimelineAsset = {
    version: '1.3', type: 'timeline', duration: 5, wrapMode: WrapMode.Once,
    tracks: [
        { type: TrackType.Audio, name: '', childPath: '', events: [
            { time: 0, duration: 5, clip: 'dialogue.wav', volume: 1 },
        ] },
        { type: TrackType.Spawn, name: '', childPath: '', clips: [
            { start: 0, duration: 5, prefab: 'actor.esprefab', name: '' },
        ] },
    ],
};

function playerIn(plugin: TimelinePlugin) {
    const app = App.new();
    apps.push(app);
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
    app.world.insert(player, TimelinePlayer, { timeline: 'intro', playing: true });
    return { app, player, timeline, voice, playClip, spawn, release };
}

afterEach(() => {
    for (const app of apps.splice(0)) app.quit();
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
