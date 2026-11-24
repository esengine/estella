// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, expect, it, vi } from 'vitest';
import { bootMockApp } from './helpers/mockApp';
import { connectFakeCpp } from './helpers/fakeEngine';
import { RenderPipeline } from '../src/render/renderPipeline';
import { Transform } from '../src/ecs/component';
import { serializeScene } from '../src/scene/scene';
import { UINode } from '../src/ui/core/ui-node';
import { Text } from '../src/ui/core/text';
import { UIVisual } from '../src/ui/core/ui-visual';
import { InlineImagePlugin } from '../src/ui/text/inline-image-plugin';
import { installHotUpdateRebind } from '../src/hotUpdateRebind';
import { Assets } from '../src/asset/Assets';
import { Assets as AssetsResource } from '../src/asset/AssetPlugin';
import { EmbeddedBackend } from '../src/asset/Backend';
import { bindAssetReferenceTracking } from '../src/asset/assetReferenceTracking';
import { Catalog, atlasCatalogFields } from '../src/asset/Catalog';

let nextHandle = 0;
const pool = { createTextureFromBytes: () => ++nextHandle, adoptTextureContent: () => true, releaseTexture: vi.fn() };
vi.mock('../src/wasm/resourceManager', async original => ({
    ...await original<typeof import('../src/wasm/resourceManager')>(), getResourceManager: () => pool, requireResourceManager: () => pool,
}));

const renderers = vi.hoisted(() => [] as Array<{ dispose: ReturnType<typeof vi.fn> }>);
vi.mock('../src/ui/util/helpers', async original => ({
    ...await original<typeof import('../src/ui/util/helpers')>(),
    getUINodeWidth: () => 320,
    getUINodeHeight: () => 48,
}));
vi.mock('../src/ui/text/text-renderer', async original => ({
    ...await original<typeof import('../src/ui/text/text-renderer')>(),
    SdfTextRenderer: class {
        atlas = {
            pixelSizeFor: () => 64,
            getGlyph: () => ({
                pageId: 1, u0: 0, v0: 0, u1: 1, v1: 1,
                width: 16, height: 32, advance: 16, bearingX: 0, bearingY: 24,
            }),
        };
        dispose = vi.fn();
        constructor() { renderers.push(this); }
    },
}));
const apps: ReturnType<typeof bootMockApp>['app'][] = [];
afterEach(() => {
    for (const app of apps.splice(0)) app.quit();
    renderers.length = 0;
    pool.releaseTexture.mockClear();
});

function imageApp(catalog = Catalog.empty(), bind = true) {
    const { app } = bootMockApp();
    connectFakeCpp(app.world);
    apps.push(app);
    app.setPipeline(new RenderPipeline());
    const assets = Assets.create({ module: null, backend: new EmbeddedBackend({}), catalog });
    assets.setAssetRefResolver(ref => catalog.getAtlasFrame(ref)?.atlas ?? ref);
    assets.getTextureLoader().setPixelDecoder(async (_path, _flip, edge) => {
        const width = edge || 256;
        return { width, height: 1, pixels: new Uint8Array(width * 4) };
    });
    app.insertResource(AssetsResource, assets);
    if (bind) bindAssetReferenceTracking(app.world, assets, () => app.getResource(AssetsResource));
    const plugin = new InlineImagePlugin();
    app.addPlugin(plugin);
    const label = app.world.spawn();
    app.world.insert(label, Transform, {});
    app.world.insert(label, UINode, {});
    const labelText = (content: string) => app.world.insert(label, Text, { content, richText: true });
    const tick = () => app.tick(1 / 60);
    const images = () => app.world.getEntitiesWithComponents([UIVisual]).map(e => app.world.get(e, UIVisual));
    const shown = async (count: number) => vi.waitFor(async () => {
        await tick();
        expect(images().filter(image => image.enabled && image.texture)).toHaveLength(count);
    });
    return { app, assets, plugin, label, labelText, images, tick, shown };
}

const icon = (src: string) => `<img src="${src}" width="16" height="16"/>`;

it('releases a shared image when the last inline occurrence leaves the layout', async () => {
    const { app, assets, labelText, shown, tick } = imageApp();
    try {
        labelText(icon('first.png') + icon('first.png'));
        await shown(2);
        expect(serializeScene(app.world).entities).toMatchObject([{ children: [], components: expect.arrayContaining([
            expect.objectContaining({ type: 'Text' }),
        ]) }]);
        const first = assets.getTexture('first.png')!.handle;
        labelText(icon('first.png') + icon('second.png'));
        await vi.waitFor(async () => { await tick(); expect(assets.getTexture('second.png')).toBeDefined(); });
        labelText(icon('second.png'));
        await shown(1);
        expect(assets.getTexture('first.png')).toBeUndefined();
        expect(pool.releaseTexture).toHaveBeenCalledWith(first);
        labelText('plain text');
        await tick();
        expect(assets.sizes().refRows).toBe(0);
    } finally { assets.releaseAll(); }
});

it('draws only the authored atlas frame and resets its UVs when the source changes', async () => {
    const frame = (x: number) => ({ type: 'texture', ...atlasCatalogFields({
        frame: { x, y: 0, width: 4, height: 4 }, pageWidth: 8, pageHeight: 4,
    }, 'page.png') });
    const { assets, labelText, images, shown, tick } = imageApp(Catalog.fromJson({ version: 1, entries: {
        'left.png': frame(0), 'right.png': frame(4),
    } }));
    try {
        labelText(icon('right.png') + icon('left.png'));
        await shown(2);
        const page = assets.getTexture('page.png')?.handle;
        expect(page).toBeGreaterThan(0);
        expect(images()[0]).toMatchObject({ texture: page, uvOffset: { x: 0.5, y: 0 }, uvScale: { x: 0.5, y: 1 } });
        labelText(icon('left.png') + icon('left.png'));
        await vi.waitFor(async () => {
            await tick();
            expect(images()[0]).toMatchObject({ enabled: true, texture: page, uvOffset: { x: 0, y: 0 }, uvScale: { x: 0.5, y: 1 } });
        });
        labelText(icon('loose.png') + icon('left.png'));
        await vi.waitFor(async () => {
            await tick();
            expect(images()[0]).toMatchObject({ enabled: true, texture: assets.getTexture('loose.png')!.handle,
                uvOffset: { x: 0, y: 0 }, uvScale: { x: 1, y: 1 } });
        });
    } finally { assets.releaseAll(); }
});

it('moves surviving inline text to the replacement Assets and frees the old image', async () => {
    const { app, assets, labelText, images, shown, tick } = imageApp(Catalog.empty(), false);
    const next = Assets.create({ module: null, backend: new EmbeddedBackend({}) });
    next.getTextureLoader().setPixelDecoder(async () => ({ width: 1, height: 1, pixels: new Uint8Array(4) }));
    try {
        labelText(icon('badge.png'));
        await shown(1);
        const old = images()[0].texture;
        app.insertResource(AssetsResource, next);
        await shown(1);
        expect(images()[0].texture).not.toBe(old);
        expect(images()[0].texture).toBe(next.getTexture('badge.png')!.handle);
        expect(assets.getTexture('badge.png')).toBeUndefined();
        labelText('');
        await tick();
        expect(next.sizes().refRows).toBe(0);
    } finally { assets.releaseAll(); next.releaseAll(); }
});

it('keeps a hot-reloaded image and reacquires it after an asset reset', async () => {
    const { app, assets, label, labelText, images, tick, shown } = imageApp();
    installHotUpdateRebind(app, assets);
    try {
        labelText(icon('badge.png'));
        await shown(1);
        const first = images()[0].texture;
        assets.invalidate('badge.png');
        await vi.waitFor(async () => {
            await tick();
            const loaded = assets.getTexture('badge.png');
            expect(loaded).toBeDefined();
            expect(loaded!.handle).not.toBe(first);
            expect(images()[0].texture).toBe(loaded!.handle);
        });
        await tick();
        const second = assets.getTexture('badge.png')!.handle;
        expect(images()[0].texture).toBe(second);
        assets.releaseAll();
        await shown(1);
        expect(images()[0].texture).not.toBe(second);
        app.world.despawn(label);
        await tick();
        expect(images()).toEqual([]);
        expect(assets.sizes().refRows).toBe(0);
    } finally { assets.releaseAll(); }
});

it('discards a late image after its source changes or its plugin is removed', async () => {
    const { app, assets, plugin, labelText, images, tick, shown } = imageApp(Catalog.empty(), false);
    const pending = new Map<string, () => void>();
    assets.getTextureLoader().setPixelDecoder(path => new Promise(resolve => {
        pending.set(path, () => resolve({ width: 1, height: 1, pixels: new Uint8Array(4) }));
    }));
    try {
        labelText(icon('late.png'));
        await tick();
        await vi.waitFor(() => expect(pending.has('late.png')).toBe(true));
        labelText(icon('now.png'));
        await tick();
        await vi.waitFor(() => expect(pending.has('now.png')).toBe(true));
        pending.get('now.png')!();
        await shown(1);
        const current = images()[0].texture;
        pending.get('late.png')!();
        await vi.waitFor(() => expect(pool.releaseTexture).toHaveBeenCalled());
        expect(assets.sizes().refRows).toBe(1);
        await tick();
        expect(images()[0].texture).toBe(current);
        labelText(icon('after.png'));
        await tick();
        await vi.waitFor(() => expect(pending.has('after.png')).toBe(true));
        plugin.cleanup(app);
        const released = pool.releaseTexture.mock.calls.length;
        pending.get('after.png')!();
        await vi.waitFor(() => expect(pool.releaseTexture.mock.calls.length).toBeGreaterThan(released));
        await vi.waitFor(async () => { await tick(); expect(assets.sizes().refRows).toBe(0); });
        expect(images()).toEqual([]);
        plugin.build(app);
        labelText(icon('rebuilt.png'));
        await tick();
        await vi.waitFor(() => expect(pending.has('rebuilt.png')).toBe(true));
        pending.get('rebuilt.png')!();
        await shown(1);
    } finally { assets.releaseAll(); }
});

it('keeps inline measurement pages scoped to the App being closed', async () => {
    const plugin = new InlineImagePlugin();
    const prepare = async () => {
        const { app } = bootMockApp();
        apps.push(app);
        app.setPipeline(new RenderPipeline());
        app.addPlugin(plugin);
        const label = app.world.spawn();
        app.world.insert(label, Transform, {});
        app.world.insert(label, UINode, {});
        app.world.insert(label, Text, {
            content: 'A<img src="icon.png" width="16" height="16">Ω', richText: true,
        });
        await app.tick(1 / 60);
        return app;
    };
    const first = await prepare(), second = await prepare();
    expect(renderers).toHaveLength(2);
    first.quit();
    expect(renderers[0].dispose).toHaveBeenCalledOnce();
    expect(renderers[1].dispose).not.toHaveBeenCalled();
    second.quit();
    plugin.cleanup();
    expect(renderers[1].dispose).toHaveBeenCalledOnce();
});
