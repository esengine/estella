// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const device = vi.hoisted(() => ({ status: 0 }));
vi.mock('../src/render/renderer', async original => ({
    ...await original<typeof import('../src/render/renderer')>(), getDeviceStatus: () => device.status,
}));
import { App } from '../src/app/app';
import { AssetPlugin, Assets, installRuntimeAssets } from '../src/asset/AssetPlugin';
import { Assets as AssetsClass } from '../src/asset/Assets';
import { AssetRefCounter } from '../src/asset/AssetRefCounter';
import type { ESEngineModule } from '../src/wasm';
const apps: App[] = [];
function loader() {
    const counter = new AssetRefCounter();
    return { releaseAll: vi.fn(), getRefCounter: () => counter, setRefCounter: vi.fn(),
        getTextureLoader: () => ({ setTranscoderProvider: vi.fn() }),
        recoverFromDeviceLoss: vi.fn().mockResolvedValue(true) };
}
function build(plugin: AssetPlugin, value: ReturnType<typeof loader>) {
    const app = App.new(); apps.push(app);
    vi.spyOn(app, 'wasmModule', 'get').mockReturnValue({} as ESEngineModule);
    vi.mocked(AssetsClass.create).mockReturnValue(value as unknown as AssetsClass);
    app.addPlugin(plugin); return app;
}
beforeEach(() => { device.status = 0; vi.spyOn(AssetsClass, 'create'); });
afterEach(() => { for (const app of apps.splice(0)) app.quit({ keepRenderer: true }); vi.restoreAllMocks(); });
it('releases the app loader exactly once on shutdown', () => {
    const value = loader(), app = build(new AssetPlugin(), value);
    app.quit({ keepRenderer: true }); app.quit({ keepRenderer: true });
    expect(value.releaseAll).toHaveBeenCalledOnce();
});
it('releases a bare App’s runtime assets before its module host, including on a repeated quit', () => {
    const app = App.new(), assets = loader(), events: string[] = [];
    assets.releaseAll.mockImplementation(() => { events.push('assets'); });
    app.setSideModules({ acquire: async () => null, dispose: () => { events.push('modules'); } }, { owned: true });
    installRuntimeAssets(app, assets as unknown as AssetsClass, () => { events.push('remove settings'); });
    app.quit(); app.quit();
    expect(events).toEqual(['remove settings', 'assets', 'modules']);
});
it('retires each scene loader once across a realm replacement, explicit cleanup and App shutdown', () => {
    const plugin = new AssetPlugin(), initial = loader(), first = loader(), second = loader();
    const app = build(plugin, initial);
    const forgetFirst = vi.fn(), forgetSecond = vi.fn();
    installRuntimeAssets(app, first as unknown as AssetsClass, forgetFirst);
    installRuntimeAssets(app, second as unknown as AssetsClass, forgetSecond);
    expect(first.releaseAll).toHaveBeenCalledOnce();
    expect(second.releaseAll).not.toHaveBeenCalled();
    plugin.cleanup(app);
    app.quit({ keepRenderer: true });
    for (const callback of [initial.releaseAll, first.releaseAll, second.releaseAll, forgetFirst, forgetSecond]) {
        expect(callback).toHaveBeenCalledOnce();
    }
});
it('releases runtime replacement and default loaders while preserving another app', () => {
    const plugin = new AssetPlugin(), firstValue = loader(), secondValue = loader(), replacement = loader();
    const first = build(plugin, firstValue); build(plugin, secondValue);
    first.insertResource(Assets, replacement as unknown as AssetsClass);
    first.quit({ keepRenderer: true });
    expect(firstValue.releaseAll).toHaveBeenCalledOnce(); expect(replacement.releaseAll).toHaveBeenCalledOnce();
    expect(secondValue.releaseAll).not.toHaveBeenCalled();
});
it('parameterless cleanup releases only the latest app, once', () => {
    const plugin = new AssetPlugin(), firstValue = loader(), secondValue = loader();
    build(plugin, firstValue); build(plugin, secondValue);
    plugin.cleanup(); plugin.cleanup();
    expect(secondValue.releaseAll).toHaveBeenCalledOnce(); expect(firstValue.releaseAll).not.toHaveBeenCalled();
});
it('a failing default loader does not prevent the runtime loader from releasing', () => {
    const plugin = new AssetPlugin(), value = loader(), app = build(plugin, value), replacement = loader();
    app.insertResource(Assets, replacement as unknown as AssetsClass);
    value.releaseAll.mockImplementation(() => { throw Error('release failed'); });
    expect(() => plugin.cleanup(app)).toThrow();
    expect(replacement.releaseAll).toHaveBeenCalledOnce(); plugin.cleanup(app);
    expect(value.releaseAll).toHaveBeenCalledOnce();
});
it('replacing a loader during recovery still recovers the active replacement', async () => {
    const old = loader(), app = build(new AssetPlugin(), old), replacement = loader();
    let resolve!: (value: boolean) => void;
    old.recoverFromDeviceLoss.mockImplementation(() => new Promise(done => { resolve = done; }));
    device.status = 1; await app.tick(1 / 60);
    app.insertResource(Assets, replacement as unknown as AssetsClass); resolve(false);
    await vi.waitFor(() => expect(replacement.recoverFromDeviceLoss).toHaveBeenCalledOnce());
});
it('a stopped recovery cannot move on to a later loader', async () => {
    const old = loader(), app = build(new AssetPlugin(), old), replacement = loader();
    let resolve!: (value: boolean) => void;
    old.recoverFromDeviceLoss.mockImplementation(() => new Promise(done => { resolve = done; }));
    device.status = 1; await app.tick(1 / 60); app.quit({ keepRenderer: true });
    app.insertResource(Assets, replacement as unknown as AssetsClass); resolve(false);
    await new Promise(done => setTimeout(done, 0));
    expect(replacement.recoverFromDeviceLoss).not.toHaveBeenCalled();
});
