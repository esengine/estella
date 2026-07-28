// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A video ref must come out of the scene loader as something the video
 *        backend can OPEN, which is two steps: the realm's logical→staged mapping
 *        (`resolveRef`), then that path through the realm's asset backend. Installing
 *        `resolveRef` alone shipped a single-file playable whose <video> pointed at a
 *        sibling path the package does not contain — it played on the web (where the
 *        staged path IS the URL) and drew a blank white quad everywhere else.
 */
import { describe, it, expect } from 'vitest';
import { loadRuntimeScene } from '../src/runtime/runtimeLoader';
import { VideoPlayer } from '../src/video/VideoAPI';
import { World } from '../src/ecs/world';
import type { App } from '../src/app/app';
import type { Backend } from '../src/asset/Backend';
import type { ESEngineModule } from '../src/wasm';
import type { SceneData } from '../src/scene/scene';

const fakeModule = { _malloc: () => 0, _free: () => {} } as unknown as ESEngineModule;

const CLIP_DATA_URL = 'data:video/mp4;base64,AAAA';

/** Stands in for EmbeddedBackend: a known path resolves to its inlined data URL. */
const embeddedBackend: Backend = {
    resolveUrl: (p: string) => (p === 'assets/video/clip.mp4' ? CLIP_DATA_URL : p),
    fetchText: async () => '',
    fetchBinary: async () => new ArrayBuffer(0),
} as unknown as Backend;

function makeFakeApp(): { app: App; resources: Map<unknown, unknown> } {
    const resources = new Map<unknown, unknown>();
    const app = {
        world: new World(),
        hasResource: (r: unknown) => resources.has(r),
        getResource: (r: unknown) => resources.get(r),
        insertResource: (r: unknown, v: unknown) => { resources.set(r, v); },
        getPlugin: () => null,
        sideModules: undefined,
    } as unknown as App;
    return { app, resources };
}

describe('video ref resolution (scene load)', () => {
    it('composes the realm ref mapping with the backend URL', async () => {
        const { app, resources } = makeFakeApp();
        let resolver: ((ref: string) => string) | null = null;
        resources.set(VideoPlayer, { setRefResolver: (f: (ref: string) => string) => { resolver = f; } });

        await loadRuntimeScene({
            app,
            module: fakeModule,
            sceneData: { version: '1.0', name: 'main', entities: [] } as SceneData,
            source: {
                backend: embeddedBackend,
                decodePixels: () => Promise.reject(new Error('no textures in this test')),
                resolveRef: (ref) => (ref === '@uuid:clip' ? 'assets/video/clip.mp4' : ref),
            },
            spineManager: null,
        });

        expect(resolver).toBeTruthy();
        const resolve = resolver as unknown as (ref: string) => string;
        expect(resolve('@uuid:clip')).toBe(CLIP_DATA_URL);
        expect(resolve('assets/video/clip.mp4')).toBe(CLIP_DATA_URL);
        // An unknown ref passes through untouched, so the audio-sibling probe
        // (`<source>.m4a`) still reads as "no cooked track" rather than a bogus URL.
        expect(resolve('assets/video/clip.mp4.m4a')).toBe('assets/video/clip.mp4.m4a');
    });
});
