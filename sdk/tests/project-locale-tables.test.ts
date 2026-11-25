// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { Assets as AssetsResource, AssetPlugin } from '../src/asset/AssetPlugin';
import { Assets } from '../src/asset/Assets';
import { Localization, LocalizationAPI } from '../src/i18n/Localization';
import { LocalizationPlugin } from '../src/i18n/LocalizationPlugin';
import { loadRuntimeScene, type RuntimeAssetSource } from '../src/runtime/runtimeLoader';
import type { SceneData } from '../src/scene/scene';
import { reservePromise } from '../src/util/reservePromise';

const base = 'assets/i18n/base.eslocale';
const overlay = 'assets/i18n/overlay.eslocale';
const alias = '@uuid:ece86aa7-b45f-4f86-b654-7dea3ee93301';
const scene: SceneData = { version: 4, name: 'Labels', entities: [
    { id: 1, name: 'label', parent: null, children: [], components: [{ type: 'Text', data: { i18nKey: 'play' } }] },
] };
const table = (entries: Record<string, string>, locale = 'en') => JSON.stringify({ locale, entries });
function backend(fetchText: (ref: string) => Promise<string>) {
    return { fetchText, fetchBinary: async () => new ArrayBuffer(0), resolveUrl: (ref: string) => ref };
}

describe('project locale table ownership', () => {
    it('loads declared tables at startup on a headless App with no scenes or WASM', async () => {
        const app = App.new();
        app.addPlugin(new AssetPlugin());
        const assets = app.getResource(AssetsResource);
        const read = vi.spyOn(assets.backend, 'fetchText').mockImplementation(async ref => table({ play: ref }));
        app.addPlugin(new LocalizationPlugin({ tables: [overlay, base] }));
        try {
            await app.tick(0);
            await vi.waitFor(() => expect(assets.appScope.size).toBe(2));
            const locale = app.getResource(Localization);
            expect(locale.t('play')).toBe(base);
            expect(read).toHaveBeenCalledTimes(2);
        } finally { app.quit(); }
        expect(assets.appScope.size).toBe(0);
    });

    it.each([base, overlay])('reads concurrently and retains each table once across scene loads with %s delayed', async delayed => {
        const gate = reservePromise<void>();
        const read = vi.fn(async (ref: string) => {
            if (ref === delayed) await gate.promise;
            return table({ play: ref });
        });
        const app = App.new();
        app.addPlugin(new AssetPlugin());
        let paths = [overlay, base, overlay];
        const source: RuntimeAssetSource = {
            backend: backend(read), listAssetPaths: () => paths,
            decodePixels: async () => { throw new Error('unexpected texture'); },
        };
        const load = () => loadRuntimeScene({ app, module: null, source, sceneData: scene });
        try {
            const first = load();
            await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
            gate.resolve();
            await first;
            const assets = app.getResource(AssetsResource);
            const locale = app.getResource(Localization);
            for (let visit = 0; visit < 5; visit++) {
                paths = [...paths].reverse();
                await load();
                expect(locale.t('play')).toBe(overlay);
                expect(assets.appScope.size).toBe(2);
                expect(assets.sizes()).toMatchObject({ refRows: 0, registrySlots: 2 });
            }
            expect(read).toHaveBeenCalledTimes(2);
            paths = [base];
            await load();
            expect([locale.t('play'), assets.appScope.size, assets.sizes().registrySlots]).toEqual([base, 1, 1]);
            paths = [];
            await load();
            expect([locale.t('play'), assets.appScope.size, assets.sizes().registrySlots]).toEqual(['play', 0, 0]);
        } finally { gate.resolve(); app.quit(); }
    });

    it('joins startup and scene reads, deduplicates UUID aliases, and honors the configured order', async () => {
        const gate = reservePromise<void>();
        const read = vi.fn(async (ref: string) => { await gate.promise; return table({ play: ref }); });
        const app = App.new();
        app.addPlugin(new AssetPlugin());
        app.addPlugin(new LocalizationPlugin({ tables: [overlay, alias], locale: 'en' }));
        const source: RuntimeAssetSource = {
            backend: backend(read), listAssetPaths: () => [base, overlay],
            resolveRef: ref => ref === alias ? base : ref,
            decodePixels: async () => { throw new Error('unexpected texture'); },
        };
        try {
            const first = loadRuntimeScene({ app, module: null, source, sceneData: scene });
            await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
            await app.tick(0);
            gate.resolve();
            await first;
            const assets = app.getResource(AssetsResource);
            expect(app.getResource(Localization).t('play')).toBe(base);
            expect(assets.appScope.size).toBe(2);
            expect(read.mock.calls.map(([ref]) => ref).sort()).toEqual([base, overlay]);
        } finally { gate.resolve(); app.quit(); }
        const assets = app.getResource(AssetsResource);
        expect(assets.sizes().registrySlots).toBe(0);
        expect(assets.appScope.size).toBe(0);
    });

    it('retries a missing base table in its original position, refreshes atomically and preserves later code overrides', async () => {
        const files = new Map([[overlay, table({ play: 'overlay', subtitle: 'overlay subtitle' })]]);
        const i18n = new LocalizationAPI();
        const assets = Assets.create({ module: null, getLocalization: () => i18n, backend: backend(async ref => {
            const content = files.get(ref);
            if (content === undefined) throw new Error('table temporarily unavailable');
            return content;
        }) });
        try {
            i18n.addCatalog('en', { play: 'initial', subtitle: 'initial subtitle' });
            await assets.installProjectLocaleTables([], [overlay, base]);
            expect(assets.appScope.size).toBe(1);
            files.set(base, table({ play: 'base', subtitle: 'base subtitle' }));
            await assets.installProjectLocaleTables([], [base, overlay]);
            expect([i18n.t('play'), assets.appScope.size]).toEqual(['overlay', 2]);
            i18n.addCatalog('en', { play: 'game override' });
            files.set(overlay, '{');
            assets.invalidate(overlay);
            await assets.assetGraphSettled();
            expect(i18n.t('subtitle')).toBe('overlay subtitle');
            files.set(overlay, table({ play: 'updated override', other: 'new text' }));
            assets.invalidate(overlay);
            await assets.assetGraphSettled();
            expect([i18n.t('play'), i18n.t('subtitle'), i18n.t('other')]).toEqual(['game override', 'base subtitle', 'new text']);
            expect(assets.appScope.size).toBe(2);
        } finally { assets.releaseAll(); }
    });

    it('discards a late table when its asset realm resets and can acquire it again', async () => {
        const late = reservePromise<string>();
        const read = vi.fn<(_: string) => Promise<string>>().mockReturnValueOnce(late.promise)
            .mockResolvedValue(table({ play: 'fresh' }));
        const locale = new LocalizationAPI();
        const assets = Assets.create({ module: null, getLocalization: () => locale, backend: backend(read) });
        const first = assets.installProjectLocaleTables([], [base]);
        await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
        assets.releaseAll();
        const next = assets.installProjectLocaleTables([], [base]);
        await next;
        late.resolve(table({ play: 'stale' }));
        await first;
        expect([locale.t('play'), assets.sizes().registrySlots, assets.appScope.size]).toEqual(['fresh', 1, 1]);
        assets.releaseAll();
    });

    it('preserves direct load order and only publishes the newest overlapping hot update', async () => {
        const slowBase = reservePromise<string>();
        const slowRefresh = reservePromise<string>();
        const read = vi.fn<(_: string) => Promise<string>>().mockReturnValueOnce(slowBase.promise)
            .mockResolvedValueOnce(table({ play: 'overlay' })).mockResolvedValueOnce(table({ play: 'refreshed base' }))
            .mockReturnValueOnce(slowRefresh.promise)
            .mockResolvedValueOnce(table({ play: 'newest' }));
        const locale = new LocalizationAPI();
        const assets = Assets.create({ module: null, getLocalization: () => locale, backend: backend(read) });
        try {
            const first = assets.loadLocaleTable(base);
            await assets.loadLocaleTable(overlay);
            assets.invalidate(base);
            slowBase.resolve(table({ play: 'base' }));
            await first;
            expect(locale.t('play')).toBe('overlay');
            assets.invalidate(overlay);
            assets.invalidate(overlay);
            await vi.waitFor(() => expect(locale.t('play')).toBe('newest'));
            slowRefresh.resolve(table({ play: 'stale refresh' }));
            await assets.assetGraphSettled();
            expect(locale.t('play')).toBe('newest');
        } finally { slowBase.resolve(table({})); slowRefresh.resolve(table({})); assets.releaseAll(); }
    });

    it.each(['old bytes', 'old error'])('invalidates the first in-flight read before publishing a table (%s)', async previous => {
        const incoming = reservePromise<string>();
        const read = vi.fn<(_: string) => Promise<string>>().mockReturnValueOnce(incoming.promise)
            .mockResolvedValueOnce(table({ play: 'current' }));
        const locale = new LocalizationAPI();
        const assets = Assets.create({ module: null, getLocalization: () => locale, backend: backend(read) });
        try {
            const install = assets.installProjectLocaleTables([], [base]);
            await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
            expect(assets.invalidate(base)).toBe(true);
            assets.invalidate(base);
            const settled = assets.assetGraphSettled();
            expect(locale.has('play')).toBe(false);
            if (previous === 'old error') incoming.reject(new Error('revision removed'));
            else incoming.resolve(table({ play: 'outdated' }));
            await Promise.all([install, settled]);
            expect([locale.t('play'), read.mock.calls.length, assets.appScope.size]).toEqual(['current', 2, 1]);
        } finally { incoming.resolve(table({})); assets.releaseAll(); }
    });

    it.each(['loadLocaleTable', 'load'])('keeps a table merged by %s after its scene drops it and adopts cached files into a replacement service', async entry => {
        let locale = new LocalizationAPI();
        const read = vi.fn(async (ref: string) => table({ play: ref }));
        const assets = Assets.create({ module: null, getLocalization: () => locale, backend: backend(read) });
        try {
            await assets.installProjectLocaleTables([], [base, overlay]);
            if (entry === 'loadLocaleTable') await assets.loadLocaleTable(overlay);
            else await assets.load('locale', overlay);
            await assets.installProjectLocaleTables([], [base]);
            expect(locale.t('play')).toBe(overlay);
            assets.releaseTyped('locale', overlay);
            expect([assets.sizes().registrySlots, assets.appScope.size]).toEqual([1, 1]);
            const old = locale;
            locale = new LocalizationAPI();
            await assets.installProjectLocaleTables([], [base]);
            expect(old.t('play')).toBe(overlay);
            expect(locale.t('play')).toBe(base);
            expect(read).toHaveBeenCalledTimes(2);
        } finally { assets.releaseAll(); }
    });

    it('honors a language the player chooses while the first localized scene is still loading', async () => {
        const gate = reservePromise<string>();
        const read = vi.fn(() => gate.promise);
        const app = App.new();
        const source: RuntimeAssetSource = {
            backend: backend(read), listAssetPaths: () => [base],
            decodePixels: async () => { throw new Error('unexpected texture'); },
        };
        try {
            const loading = loadRuntimeScene({ app, module: null, source, sceneData: scene });
            await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
            const locale = app.getResource(Localization);
            locale.setLocale('fr');
            gate.resolve(table({ play: 'Start' }, 'en'));
            await loading;
            expect(locale.locale).toBe('fr');
            expect(locale.t('play')).toBe('Start');
        } finally { gate.resolve(table({})); app.quit(); }
    });
});
