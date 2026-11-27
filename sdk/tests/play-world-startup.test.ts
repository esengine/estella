// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expect, it, vi } from 'vitest';
import { setPlatform } from '../src/platform/base';
import { webAdapter } from '../src/platform/web';
import { initPlayRealmRuntime } from '../src/runtime/playRealmRuntime';
import type { SceneData } from '../src/scene/scene';
import { SceneManager } from '../src/scene/sceneManager';
import { sceneManagerPlugin } from '../src/scene/scenePlugin';
import { bootMockApp } from './helpers/mockApp';

it('reuses prefab reads within one Play load and fetches fresh copies on reload', async () => {
    const { app, module } = bootMockApp();
    const paths = Array.from({ length: 24 }, (_, index) => `assets/prop-${index}.esprefab`);
    const entries = paths.map((prefab, index) => ({ id: index + 1, prefab, parent: null, overrides: [], removed: [], added: [] }));
    const sceneData = { name: 'Props', version: 4, entities: entries } as unknown as SceneData;
    const prefabText = JSON.stringify({ version: '1.0', name: 'Prop', rootEntityId: 'r', entities: [
        { prefabEntityId: 'r', name: 'Prop', parent: null, children: [], components: [] },
    ] });
    const pending = vi.fn(async (url: string) => {
        const path = new URL(url).pathname.slice(1);
        if (!paths.includes(path)) throw new Error(`Unexpected asset ${url}`);
        await new Promise(resolve => setTimeout(resolve, 5));
        return new Response(prefabText);
    });
    setPlatform(webAdapter);
    module.transform_update = vi.fn();
    vi.stubGlobal('fetch', pending);
    vi.spyOn(app, 'run').mockResolvedValue();
    app.addPlugin(sceneManagerPlugin);
    try {
        await initPlayRealmRuntime({ app, module, sceneData, assetManifest: {}, assetBaseUrl: 'https://play.invalid',
            canvas: { width: 320, height: 180 } as HTMLCanvasElement });
        expect(app.world.getAllEntities()).toHaveLength(paths.length);
        expect(pending).toHaveBeenCalledTimes(paths.length);
        expect(new Set(pending.mock.calls.map(([url]) => new URL(url).pathname.slice(1)))).toEqual(new Set(paths));
        pending.mockClear();
        await app.getResource(SceneManager).reload();
        expect(pending).toHaveBeenCalledTimes(paths.length);
        expect(app.world.getAllEntities()).toHaveLength(paths.length);
    } finally {
        app.quit({ keepRenderer: true });
        vi.unstubAllGlobals();
    }
});
