// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { Assets, type AssetsData } from '../src/asset/AssetPlugin';
import type { LoadContext } from '../src/asset/AssetLoader';
import { Catalog } from '../src/asset/Catalog';
import { TimelineAssetLoader } from '../src/asset/loaders/TimelineAssetLoader';
import { Sprite } from '../src/ecs/component';
import { Timeline } from '../src/timeline/TimelineControl';
import { TimelinePlayer, TimelinePlugin } from '../src/timeline/TimelinePlugin';
import { parseTimelineAsset } from '../src/timeline/TimelineLoader';
import { serializeTimelineToJson } from '../src/timeline/TimelineSerializer';
import { TrackType, WrapMode, type AnimFramesTrack, type PublishedTimeline, type Track } from '../src/timeline/TimelineTypes';
import { sampleTimelineSpriteFrames } from '../src/timeline/timelineSpriteFrames';
import type { SequenceLayer } from '../src/timeline/timelineSequences';
import type { ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

function track(childPath: string, ...textures: string[]): AnimFramesTrack {
    return { type: TrackType.AnimFrames, name: '', childPath, frames: textures.map(texture => ({ texture })) };
}

it('reads long frame timings only after their target can accept the frame', () => {
    const readDuration = vi.fn(() => 0.125);
    const frames = Array.from({ length: 4096 }, (_, i) => ({ texture: String(i), get duration() { return readDuration(); } }));
    const tracks: AnimFramesTrack[] = ['missing', 'non-sprite', 'ready'].map(childPath => ({
        type: TrackType.AnimFrames, name: '', childPath, frames,
    }));
    const asset = { version: '1.3', type: 'timeline' as const, duration: 512, wrapMode: WrapMode.Once, tracks };
    const resolve = (_root: number, path: string) => path === 'missing' ? null : path === 'non-sprite' ? 2 : 3;
    const texture = vi.fn((ref: string) => ({ texture: Number(ref) + 1 }));
    const accepts = (entity: number) => entity === 3;

    expect(sampleTimelineSpriteFrames(asset, 400, 1, resolve, texture, accepts).get(3)?.frame).toBe(3200);
    expect(texture.mock.calls.map(([ref]) => ref)).toEqual(['3200']);
    expect(readDuration).toHaveBeenCalledTimes(3201);

    const rebound = (_root: number, path: string) => path === 'missing' ? 3 : null;
    expect(sampleTimelineSpriteFrames(asset, 400, 1, rebound, texture, accepts).get(3)?.track).toBe(tracks[0]);
    expect(readDuration).toHaveBeenCalledTimes(6402);
});

const spriteTimeline = (tracks: Track[]) => ({ version: '1.3', type: 'timeline' as const, duration: 512, wrapMode: WrapMode.Once, tracks });

it('uses the default timing for invalid frame durations on both sides of a frame boundary', () => {
    const source = spriteTimeline([{ ...track('', 'zero', 'broken', 'long', 'last'), frames: [
        { texture: 'zero', duration: 0 }, { texture: 'broken', duration: NaN },
        { texture: 'long', duration: 0.25 }, { texture: 'last', duration: -1 },
    ] }]);
    const sample = (time: number) => sampleTimelineSpriteFrames(source, time, 1, () => null,
        () => ({ texture: 1 }), () => true).get(1)?.frame;
    expect([sample(0), sample(1 / 12 - 1e-6), sample(1 / 12), sample(1 / 6), sample(1 / 6 + 0.25), sample(3)])
        .toEqual([0, 0, 1, 2, 3, 3]);
});

it('normalizes broken durations when decoding an authored sprite timeline', () => {
    const parsed = parseTimelineAsset({ ...spriteTimeline([]), tracks: [{ type: TrackType.AnimFrames,
        animFrames: [0, -1, '0.125', 0.25].map(duration => ({ texture: 'frame', duration })),
    }] });
    const frames = (parsed.tracks[0] as AnimFramesTrack).frames;
    expect(frames.map(frame => frame.duration)).toEqual([undefined, undefined, undefined, 0.25]);
});

function repeatedLayers(frames: AnimFramesTrack['frames'], count: number): SequenceLayer[] {
    const asset = spriteTimeline([{ ...track(''), frames }]);
    const clip = { start: 0, duration: 512, timeline: 'shared', root: '', speed: 1, loop: true };
    return Array.from({ length: count }, (_, i) => ({ key: `${i}/`, asset, ref: 'shared', time: 400, clip, root: i + 2 }));
}

it('shares timing scans across repeated nested layers while sampling each target and reading edits on the next call', () => {
    let duration = 0.125;
    const readDuration = vi.fn(() => duration);
    const frames = Array.from({ length: 4096 }, (_, i) => ({ texture: String(i), get duration() { return readDuration(); } }));
    const layers = repeatedLayers(frames, 3);
    layers[2]!.time = 100;
    const image = (ref: string, layer?: SequenceLayer) => ({ texture: Number(ref) + layer!.root * 10000 });
    const sample = () => sampleTimelineSpriteFrames(spriteTimeline([]), 400, 1, () => null, image, () => true, layers);
    const first = sample();
    expect([...first.values()].map(row => [row.frame, row.texture])).toEqual([[3200, 23200], [3200, 33200], [800, 40800]]);
    expect(readDuration).toHaveBeenCalledTimes(3201 + 801);

    duration = 0.25;
    const edited = sample();
    expect([...edited.values()].map(row => row.frame)).toEqual([1600, 1600, 400]);
});

describe.skipIf(!HAS_WASM)('timeline sprite frame tracks', () => {
    let engine: ESEngineModule;
    const apps: App[] = [];
    beforeAll(async () => { engine = await loadWasmModule(); });
    afterEach(() => { for (const app of apps.splice(0)) app.quit({ keepRenderer: true }); });

    function scene(plugin = new TimelinePlugin()) {
        const app = App.new().connectCpp(new engine.Registry(), engine, { ownedRegistry: true });
        apps.push(app);
        const publications = new Map<string, PublishedTimeline>();
        app.insertResource(Assets, {
            resolveRegistryAsset: (type: string, ref: string) => type === 'timeline' ? publications.get(ref) : undefined,
        } as unknown as AssetsData);
        app.addPlugin(plugin);
        const world = app.world;
        const player = world.spawn();
        world.insert(player, TimelinePlayer, { timeline: 'intro' });
        function publish(tracks: Track[], textures: [string, number][], ref = 'intro') {
            publications.set(ref, {
                asset: { version: '1.3', type: 'timeline', duration: 2, wrapMode: WrapMode.Once, tracks },
                textureHandles: new Map(textures),
            });
        }
        return { app, world, player, publish, publications };
    }

    it('resolves children and named bindings with the same player as the other tracks', async () => {
        const { app, world, player, publish } = scene();
        const badge = world.spawn('Badge');
        const first = world.spawn();
        const second = world.spawn();
        world.setParent(badge, player);
        for (const target of [badge, first, second]) world.insert(target, Sprite);
        world.update(player, TimelinePlayer, p => { p.bindingNames = ['Portrait']; p.bindings = [first]; });
        publish([track('Badge', 'badge.png'), track('@Portrait', 'face.png')], [['badge.png', 11], ['face.png', 12]]);

        await app.tick(0.01);
        expect(world.get(badge, Sprite).texture).toBe(11);
        expect(world.get(first, Sprite).texture).toBe(12);
        expect(world.has(player, Sprite)).toBe(false);
        world.update(player, TimelinePlayer, p => { p.bindings = [second]; });
        await app.tick(0.01);
        expect(world.get(second, Sprite).texture).toBe(12);
        const revision = world.mutationRevision(Sprite, 'write');
        await app.tick(0.01);
        expect(world.mutationRevision(Sprite, 'write')).toBe(revision);
    });

    it('uses a newly published clip and its texture handles at the current playhead', async () => {
        const { app, world, player, publish, publications } = scene();
        world.insert(player, Sprite, { texture: 4 });
        publish([track('', 'first', 'second')], [['first', 11], ['second', 12]]);
        await app.tick(0.01);
        expect(world.get(player, Sprite).texture).toBe(11);
        app.getResource(Timeline).setTime(player, 1 / 12);
        await app.tick(0.01);
        expect(world.get(player, Sprite).texture).toBe(12);

        publish([track('', 'replacement')], []);
        await app.tick(0.01);
        expect(world.get(player, Sprite).texture).toBe(12);
        const handles = publications.get('intro')!.textureHandles;
        handles.set('replacement', 21);
        await app.tick(0.01);
        expect(world.get(player, Sprite).texture).toBe(21);
        handles.set('replacement', 22);
        await app.tick(0.01);
        expect(world.get(player, Sprite).texture).toBe(22);
    });

    it('applies a held frame to a replacement Sprite and clears its old sheet window', async () => {
        const { app, world, player, publish } = scene();
        const cropped = { texture: 4, uvOffset: { x: .5, y: .5 }, uvScale: { x: .5, y: .5 } };
        const full = { texture: 11, uvOffset: { x: 0, y: 0 }, uvScale: { x: 1, y: 1 } };
        world.insert(player, Sprite, cropped);
        publish([track('', 'still')], [['still', 11]]);
        await app.tick(0.01);
        expect.soft(world.get(player, Sprite)).toMatchObject(full);
        world.remove(player, Sprite);
        world.insert(player, Sprite, cropped);
        await app.tick(0.01);
        expect(world.get(player, Sprite)).toMatchObject(full);
    });

    it('resolves sibling frames and switches atlas regions even when they share a page', async () => {
        const { app, world, player, publications } = scene();
        world.insert(player, Sprite);
        const catalog = Catalog.fromJson({
            version: 1,
            entries: {
                'assets/clip/first.png': {
                    type: 'texture', atlas: 'page.png', frame: { x: 0, y: 0, w: 32, h: 32 },
                    uv: { offset: [0, .5], scale: [.5, .5] },
                },
                'assets/clip/next.png': {
                    type: 'texture', atlas: 'page.png', frame: { x: 32, y: 0, w: 32, h: 32 },
                    uv: { offset: [.5, .5], scale: [.5, .5] },
                },
            },
        });
        const acquired: string[] = [];
        const context = {
            catalog,
            sourceAddressOf: () => 'assets/clip/intro.estimeline',
            loadText: async () => serializeTimelineToJson({
                version: '1.3', type: 'timeline', duration: 2, wrapMode: WrapMode.Once,
                tracks: [track('', './first.png', './next.png')],
            }),
            acquireTexture: async (ref: string) => {
                acquired.push(ref);
                return { value: { handle: 33 } };
            },
        } as unknown as LoadContext;
        const era = await new TimelineAssetLoader().registry.prepare('cooked/intro.estimeline', context);
        expect(acquired).toEqual(['assets/clip/first.png', 'assets/clip/next.png']);
        publications.set('intro', era.published as PublishedTimeline);

        await app.tick(.01);
        expect(world.get(player, Sprite)).toMatchObject({
            texture: 33, uvOffset: { x: 0, y: .5 }, uvScale: { x: .5, y: .5 },
        });
        app.getResource(Timeline).setTime(player, 1 / 12);
        await app.tick(.01);
        expect(world.get(player, Sprite)).toMatchObject({
            texture: 33, uvOffset: { x: .5, y: .5 }, uvScale: { x: .5, y: .5 },
        });
    });

    it('samples a nested clip with its own clock, binding and texture publication', async () => {
        const { app, world, player, publish, publications } = scene();
        const cast = world.spawn('Cast');
        world.setParent(cast, player);
        world.insert(cast, Sprite);
        publish([track('Cast', 'same.png'), { type: TrackType.Sequence, name: '', childPath: '',
            clips: [{ start: .5, duration: .5, timeline: 'child', root: 'Cast', speed: 1, loop: false }],
        }], [['same.png', 11]]);
        publish([track('', 'first.png', 'same.png')], [['first.png', 21], ['same.png', 22]], 'child');
        const seek = async (time: number) => { app.getResource(Timeline).setTime(player, time); await app.tick(0.01); };
        await seek(.25);
        expect(world.get(cast, Sprite).texture).toBe(11);
        await seek(.5);
        expect(world.get(cast, Sprite).texture).toBe(21);
        await seek(.75);
        expect(world.get(cast, Sprite).texture).toBe(22);
        publications.get('child')!.textureHandles.set('same.png', 23);
        await app.tick(0.01);
        expect(world.get(cast, Sprite).texture).toBe(23);
        await seek(1);
        expect(world.get(cast, Sprite).texture).toBe(11);

        const timeline = app.getResource(Timeline);
        timeline.setTime(player, .5);
        timeline.play(player);
        await app.tick(.1);
        expect(world.get(cast, Sprite).texture).toBe(23);
        const revision = world.mutationRevision(Sprite, 'write');
        await app.tick(.1);
        expect(world.mutationRevision(Sprite, 'write')).toBe(revision);
    });

    it('keeps the last track on a shared target when an earlier track changes frames', async () => {
        const { app, world, player, publish } = scene();
        world.insert(player, Sprite);
        publish([track('', 'first', 'second'), track('', 'top')], [['first', 11], ['second', 12], ['top', 21]]);
        await app.tick(0.01);
        expect(world.get(player, Sprite).texture).toBe(21);
        const revision = world.mutationRevision(Sprite, 'write');
        app.getResource(Timeline).setTime(player, .2);
        await app.tick(0.01);
        expect(world.get(player, Sprite).texture).toBe(21);
        expect(world.mutationRevision(Sprite, 'write')).toBe(revision);
    });

    it('keeps a code timeline independent of a file with the same clip and frame names', async () => {
        const { app, world, player, publish, publications } = scene();
        world.insert(player, Sprite, { texture: 4 });
        publish([track('', 'frame')], [['frame', 11]]);
        const timeline = app.getResource(Timeline);
        timeline.registerAsset('intro', { ...publications.get('intro')!.asset, tracks: [track('', 'frame')] });
        await app.tick(0.01);
        expect(world.get(player, Sprite).texture).toBe(4);
        timeline.unregisterAsset('intro');
        await app.tick(0.01);
        expect(world.get(player, Sprite).texture).toBe(11);
    });

    it('clears only the requested app frame cache and preserves a steady frame between transitions', async () => {
        const plugin = new TimelinePlugin();
        const first = scene(plugin);
        const second = scene(plugin);
        for (const s of [first, second]) {
            s.world.insert(s.player, Sprite);
            s.publish([track('', 'still')], [['still', 31]]);
            await s.app.tick(0.01);
            s.world.update(s.player, Sprite, sprite => { sprite.texture = 7; });
        }
        plugin.clearHandles(first.app);
        await first.app.tick(0.01);
        await second.app.tick(0.01);
        expect(first.world.get(first.player, Sprite).texture).toBe(31);
        expect(second.world.get(second.player, Sprite).texture).toBe(7);
    });
});
