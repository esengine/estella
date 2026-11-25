// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { Assets } from '../src/asset/AssetPlugin';
import { Localization } from '../src/i18n/Localization';
import { LocalizationPlugin } from '../src/i18n/LocalizationPlugin';
import { initRuntime, prepareRuntimeScene, publishRuntimeScene } from '../src/runtime/runtimeLoader';
import type { SceneData } from '../src/scene/scene';
import { SceneLoadCancelled, SceneManager } from '../src/scene/sceneManager';
import { sceneManagerPlugin } from '../src/scene/scenePlugin';
import { reservePromise } from '../src/util/reservePromise';

const original = 'i18n/original.eslocale', incoming = 'i18n/incoming.eslocale';
const table = (play: string, locale = 'en') => JSON.stringify({ locale, entries: { play } });

function scene(name: string, shape: string, localized: boolean): SceneData {
    return { name, version: 4, entities: [
        { id: 1, name, children: [], parent: null, components: [{ type: shape, data: {} }] },
        ...(localized ? [{ id: 2, name: 'caption', children: [], parent: null,
            components: [{ type: 'Text', data: { i18nKey: 'play' } }] }] : []),
    ] };
}

async function game(shape: string, localized: boolean,
    fetchText = async (ref: string) => table(ref === original ? 'Playing' : 'Preview')) {
    const app = App.new();
    app.addPlugin(sceneManagerPlugin);
    const read = vi.fn(fetchText);
    let paths = [original];
    const source = {
        backend: { fetchText: read, fetchBinary: async () => new ArrayBuffer(0), resolveUrl: (ref: string) => ref },
        listAssetPaths: () => paths, decodePixels: async () => { throw new Error('unexpected image'); },
    };
    const options = { app, module: null, source };
    await initRuntime({ ...options, firstScene: 'home', scenes: ['home', 'next', 'other'].map(name =>
        ({ name, data: scene(name, shape, name !== 'home' || localized) })) });
    const assets = app.getResource(Assets), scenes = app.getResource(SceneManager);
    return { app, assets, scenes, read, options, discover: (...refs: string[]) => { paths = refs; } };
}

describe.each(['Sprite', 'MeshRenderer'])('%s scene locale preparation', shape => {
    it.each([false, true])('holds decoded tables with the candidate while the active scene is localized=%s', async localized => {
        const { app, assets, scenes, read, discover } = await game(shape, localized);
        const home = scenes.getScene('home'), pins = Number(localized);
        const stillHome = () => {
            expect(scenes.getActive()).toBe('home');
            expect(scenes.getScene('home')).toBe(home);
            expect(app.hasResource(Localization)).toBe(localized);
            if (localized) expect(app.getResource(Localization).t('play')).toBe('Playing');
            expect(assets.appScope.size).toBe(pins);
        };
        try {
            discover(incoming);
            await scenes.prepare('next');
            stillHome();
            expect(read).toHaveBeenCalledWith(incoming);
            expect(assets.sizes().registrySlots).toBe(pins + 1);
            expect(scenes.discardPrepared('next')).toBe(1);
            stillHome();
            expect(assets.sizes().registrySlots).toBe(pins);
            await scenes.prepare('next');
            read.mockClear();
            await scenes.switchTo('next');
            expect(read).not.toHaveBeenCalled();
            expect(app.getResource(Localization).t('play')).toBe('Preview');
            expect([assets.appScope.size, assets.sizes().registrySlots]).toEqual([1, 1]);
        } finally { app.quit(); }
        expect([assets.appScope.size, assets.sizes().registrySlots]).toEqual([0, 0]);
    });
});

it('releases a cancelled preparation promptly while another scene shares its pending read and adopts a late plugin', async () => {
    const slow = 'i18n/slow.eslocale', french = 'i18n/french.eslocale';
    const gate = reservePromise<string>();
    const { app, assets, scenes, read, discover } = await game('Sprite', false, async ref =>
        ref === slow ? gate.promise : ref === french ? table('Jouer', 'fr') : table('Play'));
    try {
        discover(incoming, slow);
        const first = expect(scenes.prepare('next')).rejects.toBeInstanceOf(SceneLoadCancelled);
        const other = scenes.prepare('other');
        await vi.waitFor(() => expect(assets.resolveRegistryAsset('locale', incoming)).toBeDefined());
        expect(scenes.discardPrepared('next')).toBe(1);
        await first;
        expect(app.hasResource(Localization)).toBe(false);
        gate.resolve(table('Ready'));
        await other;
        app.addPlugin(new LocalizationPlugin({ locale: 'fr', tables: [french] }));
        await scenes.switchTo('other');
        expect(app.getResource(Localization).locale).toBe('fr');
        expect(app.getResource(Localization).t('play')).toBe('Jouer');
        expect(read.mock.calls.flat().sort()).toEqual([incoming, slow, french].sort());
        expect([assets.appScope.size, assets.sizes().registrySlots]).toEqual([3, 3]);
    } finally { gate.resolve(table('Ready')); app.quit(); }
});

it('releases the candidate if its new owner retires while a newly configured table is still reading', async () => {
    const declared = 'i18n/declared.eslocale', gate = reservePromise<string>();
    const { app, assets, scenes, read, discover } = await game('MeshRenderer', false, async ref =>
        ref === declared ? gate.promise : table('Play'));
    try {
        discover(incoming);
        await scenes.prepare('next');
        app.addPlugin(new LocalizationPlugin({ locale: 'fr', tables: [declared], catalogs: { fr: { play: 'Accueil' } } }));
        const locale = app.getResource(Localization);
        const loading = expect(scenes.loadAdditive('next')).rejects.toBeInstanceOf(SceneLoadCancelled);
        await vi.waitFor(() => expect(read).toHaveBeenCalledWith(declared));
        await scenes.unload('next');
        await loading;
        expect(locale.t('play')).toBe('Accueil');
        expect(assets.appScope.size).toBe(0);
        gate.resolve(table('Jouer', 'fr'));
        await vi.waitFor(() => expect(assets.sizes().registrySlots).toBe(0));
        expect(locale.t('play')).toBe('Accueil');
        await scenes.switchTo('next');
        expect(locale.t('play')).toBe('Jouer');
        expect(assets.appScope.size).toBe(2);
    } finally { gate.resolve(table('Jouer', 'fr')); app.quit(); }
});

it('uses the current registry revision on publication and leaves a deliberately merged translation intact during speculation', async () => {
    let caption = 'Playing';
    const { app, assets, scenes, read, discover } = await game('MeshRenderer', false, async () => table(caption));
    try {
        discover(incoming);
        await scenes.prepare('next');
        await expect(assets.loadLocaleTable(incoming)).rejects.toThrow('no Localization resource');
        app.addPlugin(new LocalizationPlugin());
        const locale = app.getResource(Localization);
        await assets.loadLocaleTable(incoming);
        expect(locale.t('play')).toBe('Playing');
        expect(scenes.discardPrepared('next')).toBe(1);
        assets.releaseTyped('locale', incoming);
        expect(assets.sizes().registrySlots).toBe(0);
        caption = 'Preview';
        await scenes.prepare('next');
        expect(locale.t('play')).toBe('Playing');
        caption = 'Revised';
        expect(assets.invalidate(incoming)).toBe(true);
        await assets.assetGraphSettled();
        expect(locale.t('play')).toBe('Playing');
        read.mockClear();
        await scenes.switchTo('next');
        expect(locale.t('play')).toBe('Revised');
        expect(read).not.toHaveBeenCalled();
        expect(assets.appScope.size).toBe(1);
    } finally { app.quit(); }
});

it('keeps the outgoing catalog when retirement or the incoming scene asset handoff fails', async () => {
    const { app, assets, scenes, options, discover } = await game('Sprite', true);
    const locale = app.getResource(Localization);
    const fault = new Error('rejected');
    try {
        discover(incoming);
        scenes.setActiveSceneHandler(vi.fn().mockRejectedValueOnce(fault));
        await expect(scenes.switchTo('next')).rejects.toBe(fault);
        expect(locale.t('play')).toBe('Playing');
        expect([assets.appScope.size, assets.sizes().registrySlots]).toEqual([1, 1]);
        const ready = await prepareRuntimeScene({ ...options, sceneName: 'custom', sceneData: scene('custom', 'Sprite', true) }, true);
        scenes.register({ name: 'custom', setup(ctx) {
            vi.spyOn(ctx, 'trackAssetScope').mockImplementation(() => { throw fault; });
            return publishRuntimeScene(ready, { context: ctx });
        } });
        await expect(scenes.loadAdditive('custom')).rejects.toBe(fault);
        expect(locale.t('play')).toBe('Playing');
        expect([assets.appScope.size, assets.sizes().registrySlots, ready.assetResult.scope.size]).toEqual([1, 1, 0]);
        const retry = await prepareRuntimeScene({ ...options, sceneData: scene('retry', 'Sprite', true) });
        await publishRuntimeScene(retry);
        expect(locale.t('play')).toBe('Preview');
        expect([assets.appScope.size, assets.sizes().registrySlots, retry.assetResult.scope.size]).toEqual([1, 1, 0]);
    } finally { app.quit(); }
});

it('prevents a late read from publishing or regaining ownership after an asset reset', async () => {
    const gate = reservePromise<string>();
    const { app, assets, scenes, read, discover } = await game('Sprite', false, async () => gate.promise);
    try {
        discover(incoming);
        const first = expect(scenes.prepare('next')).rejects.toThrow(/released/);
        await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
        assets.releaseAll();
        gate.resolve(table('Play'));
        await first;
        expect(app.hasResource(Localization)).toBe(false);
        expect([assets.appScope.size, assets.sizes().registrySlots]).toEqual([0, 0]);
        await scenes.switchTo('next');
        expect(app.getResource(Localization).t('play')).toBe('Play');
        expect([assets.appScope.size, assets.sizes().registrySlots]).toEqual([1, 1]);
    } finally { gate.resolve(table('Play')); app.quit(); }
});
