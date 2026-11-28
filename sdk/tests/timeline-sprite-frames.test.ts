// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../src/app/app';
import { Assets, type AssetsData } from '../src/asset/AssetPlugin';
import type { LoadContext } from '../src/asset/AssetLoader';
import { Catalog } from '../src/asset/Catalog';
import { TimelineAssetLoader } from '../src/asset/loaders/TimelineAssetLoader';
import { Sprite } from '../src/ecs/component';
import { Timeline } from '../src/timeline/TimelineControl';
import { TimelinePlayer, TimelinePlugin } from '../src/timeline/TimelinePlugin';
import { serializeTimelineToJson } from '../src/timeline/TimelineSerializer';
import { TrackType, WrapMode, type AnimFramesTrack, type PublishedTimeline, type Track } from '../src/timeline/TimelineTypes';
import type { ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

function track(childPath: string, ...textures: string[]): AnimFramesTrack {
    return { type: TrackType.AnimFrames, name: '', childPath, frames: textures.map(texture => ({ texture })) };
}

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
