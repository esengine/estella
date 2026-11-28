// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it, vi } from 'vitest';
import { SoundEventAssetLoader } from '../src/asset/loaders/SoundEventAssetLoader';
import type { LoadContext } from '../src/asset/AssetLoader';
import { Assets } from '../src/asset/Assets';
import { getAssetTypeEntry, getCustomExtensions } from '../src/assetTypes';
import { SoundEventSelector, type SoundEventAsset } from '../src/audio/SoundEvent';
import { SoundEventSource } from '../src/audio/AudioComponents';
import type { SceneData } from '../src/scene/scene';

const document = { version: 1, mode: 'sequence', clips: [{ clip: 'a.wav' }, { clip: 'b.wav' }] };
const makeContext = (text: string) => ({ catalog: { getBuildPath: () => 'cooked/hash.esaudioevent' },
    loadText: vi.fn(async () => text), acquireAsset: vi.fn(), getAudio: vi.fn() }) as unknown as LoadContext;

describe('sound event asset loading', () => {
    it('preloads a component definition through scene scope without decoding its candidates', async () => {
        expect(SoundEventSource.assetFields).toEqual([{ field: 'event', type: 'sound-event' }]);
        const fetchText = vi.fn(async () => JSON.stringify(document)), fetchBinary = vi.fn();
        const assets = Assets.create({ module: null, backend: { fetchText, fetchBinary,
            resolveUrl: (path: string) => path } as unknown as import('../src/asset/Backend').Backend });
        const scene: SceneData = { version: '1.0', name: 'sound events', entities: [{ id: 1, name: 'Step', parent: null, children: [],
            components: [{ type: 'SoundEventSource', data: { event: 'steps.esaudioevent' } }] }] };
        const result = await assets.preloadSceneAssets(scene, undefined, { skipSpine: true });
        expect(result.missing).toEqual([]); expect(fetchText).toHaveBeenCalledOnce();
        expect(result.acquisitions?.map(receipt => receipt.type)).toEqual(['sound-event']);
        assets.resolveSceneAssetPaths(scene, result);
        expect(scene.entities[0].components[0].data.event).toBe('steps.esaudioevent');
        expect(fetchBinary).not.toHaveBeenCalled(); result.scope.releaseAll(); assets.releaseAll();
    });
    it('reads the cooked path, validates the definition, and leaves clips unloaded', async () => {
        const ctx = makeContext(JSON.stringify(document));
        const data = await new SoundEventAssetLoader().load('steps.esaudioevent', ctx);
        expect(ctx.loadText).toHaveBeenCalledWith('cooked/hash.esaudioevent');
        expect(ctx.acquireAsset).not.toHaveBeenCalled(); expect(ctx.getAudio).not.toHaveBeenCalled();
        const selector = new SoundEventSelector(data);
        expect(selector.next().selection?.clip).toBe('a.wav'); expect(selector.next().selection?.clip).toBe('b.wav');
    });

    it('reports both the event path and the broken candidate slot', async () => {
        const ctx = makeContext(JSON.stringify({ version: 1, clips: [{ clip: 'a.wav' }, {}] }));
        await expect(new SoundEventAssetLoader().load('steps.esaudioevent', ctx)).rejects.toThrow('steps.esaudioevent: soundEvent.clips[1].clip');
        await expect(new SoundEventAssetLoader().load('steps.esaudioevent', makeContext('{'))).rejects.toThrow('steps.esaudioevent:');
    });

    it('resolves relative clips from the authored event and preserves indexed project-first names', async () => {
        const ctx = makeContext(JSON.stringify({ version: 1, clips: ['../audio/impact.wav', 'common.wav', 'local', '@uuid:other'].map(clip => ({ clip })) }));
        ctx.sourceAddressOf = () => 'assets/events/hit.esaudioevent';
        ctx.assetTypeOf = ref => ['common.wav', 'assets/events/common.wav', 'assets/events/local'].includes(ref) ? 'audio' : undefined;
        const loaded = await new SoundEventAssetLoader().load('blobs/a.esaudioevent', ctx);
        expect(loaded.clips.map(slot => slot.clip)).toEqual(['assets/audio/impact.wav', 'common.wav', 'assets/events/local', '@uuid:other']);
    });

    it('loads through the registered Assets lifetime and cache', async () => {
        const fetchText = vi.fn(async () => JSON.stringify(document));
        const backend = { fetchText, fetchBinary: async () => new ArrayBuffer(0), resolveUrl: (path: string) => path,
            setBaseUrl: () => {} } as unknown as import('../src/asset/Backend').Backend;
        const assets = Assets.create({ backend, module: null });
        expect(assets.getLoader('sound-event')).toBeInstanceOf(SoundEventAssetLoader);
        const first = await assets.load<SoundEventAsset>('sound-event', 'steps.esaudioevent');
        const second = await assets.load<SoundEventAsset>('sound-event', 'steps.esaudioevent');
        expect(first).toBe(second); expect(fetchText).toHaveBeenCalledOnce();
        expect(first.mode).toBe('sequence');
    });

    it('declares JSON dependencies and the minigame package read whitelist', () => {
        expect(getAssetTypeEntry('steps.esaudioevent')).toMatchObject({ contentType: 'json', hasTransitiveDeps: true });
        expect(getCustomExtensions()).toContain('.esaudioevent');
    });
});
