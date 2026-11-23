// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../src/app/app';
import { Assets, type AssetsData } from '../src/asset/AssetPlugin';
import { Sprite } from '../src/ecs/component';
import { Timeline } from '../src/timeline/TimelineControl';
import { TimelinePlayer, TimelinePlugin } from '../src/timeline/TimelinePlugin';
import { TrackType, WrapMode, type AnimFramesTrack, type PublishedTimeline } from '../src/timeline/TimelineTypes';
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
        function publish(tracks: AnimFramesTrack[], textures: [string, number][]) {
            publications.set('intro', {
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
