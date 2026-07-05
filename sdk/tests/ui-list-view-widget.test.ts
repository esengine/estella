// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui-list-view-widget.test.ts
 * @brief   Integration tests for the createListView widget factory over the real
 *          WASM module + full uiPlugin — virtualization, scroll re-mount, dispose.
 *
 * Requires pre-built WASM at desktop/public/wasm/esengine.wasm.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { App } from '../src/app';
import { UICameraInfo } from '../src/ui/core/ui-camera-info';
import { uiPlugin } from '../src/ui/ui-plugin';
import { createListView } from '../src/ui/widgets/list-view';
import { spawnUIEntity } from '../src/ui/widgets/helpers';
import { arrayDataSource } from '../src/ui/collection/data-source';
import { px } from '../src/ui/core/dimension';
import type { ESEngineModule, CppRegistry } from '../src/wasm';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('createListView (WASM integration)', () => {
    let module: ESEngineModule;
    beforeAll(async () => { module = await loadWasmModule(); });

    function createApp(): { app: App; registry: CppRegistry } {
        const app = App.new();
        const registry = new module.Registry() as unknown as CppRegistry;
        app.connectCpp(registry, module);
        app.insertResource(UICameraInfo, {
            viewProjection: new Float32Array(16),
            vpX: 0, vpY: 0, vpW: 0, vpH: 0, screenW: 0, screenH: 0,
            worldLeft: 0, worldBottom: 0, worldRight: 800, worldTop: 600,
            worldMouseX: 0, worldMouseY: 0, valid: true,
        });
        // No inputPlugin: it binds platform input (unavailable in tests). The Input
        // resource has a default InputState, so the ScrollWheelSystem still resolves.
        app.addPlugin(uiPlugin);
        return { app, registry };
    }

    function disposeApp(app: App, registry: CppRegistry): void {
        const world = app.world;
        for (const e of world.getAllEntities()) { try { world.despawn(e); } catch (_) {} }
        world.disconnectCpp();
        (registry as unknown as { delete(): void }).delete();
    }

    const bigList = (n: number) =>
        arrayDataSource(Array.from({ length: n }, (_, i) => i));

    const numberRow = {
        create: (w: import('../src/world').World, parent: import('../src/types').Entity) =>
            spawnUIEntity({ world: w, parent, node: { height: px(40) } }),
        bind: () => {},
    };

    it('virtualizes: a 1000-item list mounts only items near the viewport', async () => {
        const { app, registry } = createApp();
        const list = createListView<number>({
            world: app.world,
            viewportSize: { x: 200, y: 200 },   // 5 rows visible @ 40px
            data: bigList(1000),
            layout: { itemHeight: 40 },
            item: numberRow,
        });

        await app.tick(1 / 60);

        const mounted = list.mountedCount();
        expect(mounted).toBeGreaterThan(0);
        expect(mounted).toBeLessThanOrEqual(12);   // ~5 visible + buffer, NEVER 1000

        list.dispose();
        disposeApp(app, registry);
    });

    it('re-mounts a new window on scroll without growing the mount set', async () => {
        const { app, registry } = createApp();
        const list = createListView<number>({
            world: app.world,
            viewportSize: { x: 200, y: 200 },
            data: bigList(1000),
            layout: { itemHeight: 40 },
            item: numberRow,
        });

        await app.tick(1 / 60);
        const before = list.mountedCount();

        list.scroll.setOffset({ x: 0, y: 4000 });   // jump ~100 rows down
        await app.tick(1 / 60);

        expect(list.mountedCount()).toBeGreaterThan(0);
        expect(list.mountedCount()).toBeLessThanOrEqual(before + 4);   // stable, not accumulating

        list.dispose();
        disposeApp(app, registry);
    });

    it('grows the mount set when the data source grows, and dispose clears it', async () => {
        const { app, registry } = createApp();
        const data = bigList(3);
        const list = createListView<number>({
            world: app.world,
            viewportSize: { x: 200, y: 400 },   // fits ~10 rows → all 3 visible
            data,
            layout: { itemHeight: 40 },
            item: numberRow,
        });

        await app.tick(1 / 60);
        expect(list.mountedCount()).toBe(3);

        (data as ReturnType<typeof bigList>).append([3, 4, 5, 6]);
        await app.tick(1 / 60);
        expect(list.mountedCount()).toBe(7);

        list.dispose();
        expect(list.mountedCount()).toBe(0);
        disposeApp(app, registry);
    });

    it('grid layout mounts a virtualized subset of a large tile set', async () => {
        const { app, registry } = createApp();
        const list = createListView<number>({
            world: app.world,
            viewportSize: { x: 300, y: 200 },
            data: bigList(1000),
            layout: { columns: 3, itemSize: { x: 96, y: 96 } },
            item: {
                create: (w, parent) => spawnUIEntity({ world: w, parent, node: { width: px(96), height: px(96) } }),
                bind: () => {},
            },
        });

        await app.tick(1 / 60);
        expect(list.mountedCount()).toBeGreaterThan(0);
        expect(list.mountedCount()).toBeLessThan(60);   // a few rows of 3, not 1000

        list.dispose();
        disposeApp(app, registry);
    });
});
