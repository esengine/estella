// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { Transform } from '../src/ecs/component';
import { RenderPipeline } from '../src/render/renderPipeline';
import { Text } from '../src/ui/core/text';
import { TextPlugin } from '../src/ui/text/plugin';
import { SdfTextRenderer } from '../src/ui/text/text-renderer';
import { initResourceManager, shutdownResourceManager } from '../src/wasm/resourceManager';
import { createMockModule } from './mocks/wasm';

vi.mock('../src/platform', async (original) => ({
    ...await original<typeof import('../src/platform')>(),
    platformDevicePixelRatio: () => 1,
    platformHasGlyphRasterizer: () => false,
    platformCreateCanvas: (width: number, height: number) => ({ width, height, getContext: () => null }),
}));

it('reuploads an identical label after a population reset and releases the borrowed registry before detaching', async () => {
    const core = createMockModule(), registry = core.getRegistry();
    let epoch = 0;
    const clear = vi.fn(), collect = vi.fn();
    Object.assign(core, {
        HEAPU8: new Uint8Array(4096), _malloc: () => 8, _free: () => {},
        renderer_retainedTextBeginInWorld: vi.fn(), renderer_retainedTextBatchInWorld: vi.fn(),
        renderer_retainedTextClearInWorld: clear, renderer_setRetainedTextCollectedInWorld: collect,
        renderer_retainedTextStale: () => 0, renderer_retainedTextSubmit: vi.fn(),
        ui_isScreenDomain: () => false, registry_entityChangeResetEpoch: () => epoch,
    });
    const retain = vi.spyOn(SdfTextRenderer.prototype, 'retain').mockReturnValue(12);
    const app = App.new();
    try {
        initResourceManager(core.getResourceManager());
        app.connectCpp(registry, core);
        app.setPipeline(new RenderPipeline());
        app.addPlugin(new TextPlugin());
        const entity = app.world.spawn();
        app.world.insert(entity, Transform);
        app.world.insert(entity, Text, { content: 'Same label' });
        await app.tick(1 / 60);
        await app.tick(1 / 60);
        expect(retain).toHaveBeenCalledTimes(1);
        expect(retain.mock.calls[0]!.at(-1) === registry).toBe(true);
        ++epoch;
        await app.tick(1 / 60);
        expect(retain).toHaveBeenCalledTimes(2);
        app.world.disconnectCpp();
        expect(clear.mock.calls.map(([owner, id]) => [owner === registry, id])).toEqual([[true, entity]]);
        expect(collect.mock.calls.map(([owner, enabled]) => [owner === registry, enabled])).toEqual([[true, true], [true, false]]);
    } finally {
        app.quit({ keepRenderer: true });
        shutdownResourceManager();
        retain.mockRestore();
    }
});

it('draws only the selected app on a shared pipeline when the core only has a global glyph store', async () => {
    const core = createMockModule();
    const registry = core.getRegistry();
    const peer = createMockModule().getRegistry();
    const globalWrite = vi.fn();
    Object.assign(core, {
        HEAPU8: new Uint8Array(4096), _malloc: () => 8, _free: () => {},
        renderer_retainedTextBegin: globalWrite, renderer_retainedTextBatch: globalWrite,
        renderer_retainedTextClear: globalWrite, renderer_setRetainedTextCollected: globalWrite,
        renderer_retainedTextStale: () => 0, renderer_retainedTextSubmit: globalWrite,
        ui_isScreenDomain: () => false,
    });
    const draw = vi.spyOn(SdfTextRenderer.prototype, 'drawText').mockImplementation(() => {});
    const pipeline = new RenderPipeline(), app = App.new();
    try {
        initResourceManager(core.getResourceManager());
        app.connectCpp(registry, core);
        app.setPipeline(pipeline);
        app.addPlugin(new TextPlugin());
        const label = app.world.spawn();
        app.world.insert(label, Transform);
        app.world.insert(label, Text, { content: 'From this app' });
        await app.tick(1 / 60);
        pipeline.runPreFlushCallbacks({ _cpp: peer });
        expect(draw).not.toHaveBeenCalled();
        pipeline.runPreFlushCallbacks({ _cpp: registry });
        expect(draw).toHaveBeenCalledOnce();
        expect(draw.mock.calls[0]![0].text).toBe('From this app');
    } finally {
        app.quit({ keepRenderer: true });
        shutdownResourceManager();
        draw.mockRestore();
    }
    expect(globalWrite).not.toHaveBeenCalled();
});
