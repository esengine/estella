// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { HOST_PAGE } from '../launchers/minigameHost.mjs';
import { ROOT } from '../lib/repo.mjs';
import { serveDir } from '../lib/staticServer.mjs';

async function asset(project, ref, type, data, uuid = randomUUID()) {
    const file = path.join(project, ref);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(data));
    await fs.writeFile(file + '.meta', JSON.stringify({ version: '2.0', uuid, type, importer: {} }));
}

async function fixture(project) {
    const entity = (id, name, components) => ({ id, name, parent: null, children: [], visible: true, components });
    for (const [scene, shape] of [['hud', { type: 'Sprite', data: {} }], ['world', { type: 'MeshRenderer', data: { mesh: 'builtin:cube' } }]]) {
        await asset(project, 'assets/scenes/' + scene + '.esscene', 'scene', { version: 4, name: scene, entities: [
            entity(1, 'Caption', [{ type: 'Transform', data: {} }, { type: 'UIRect', data: {} }, { type: 'Text', data: { i18nKey: 'start' } }]),
            entity(2, scene, [{ type: 'Transform', data: {} }, shape]),
        ] });
    }
    // Exercise a registered but unreadable destination through each target's scene loader.
    await asset(project, 'assets/scenes/future.esscene', 'scene', { version: 999, name: 'future', entities: [] });
    // The UUIDs sort in the opposite order to the two English filenames.
    for (const [file, locale, text, uuid] of [
        ['z-overlay', 'en', 'Start game', '00000000-0000-4000-8000-000000000001'],
        ['a-base', 'en', 'Start', 'ffffffff-ffff-4fff-bfff-fffffffffff2'],
        ['fr', 'fr', 'Commencer', '77777777-7777-4777-8777-777777777773'],
    ]) {
        await asset(project, 'assets/i18n/' + file + '.eslocale', 'locale', { locale, entries: { start: text } }, uuid);
    }
    await fs.writeFile(path.join(project, 'project.esproject'), JSON.stringify({
        formatVersion: '1', name: 'Localized scenes', defaultScene: 'assets/scenes/hud.esscene',
    }));
    await fs.mkdir(path.join(project, 'src'));
    await fs.writeFile(path.join(project, 'src/main.ts'), `
import { addPlugin, Assets, defineSystem, Input, Localization, Res, SceneManager, Text } from 'esengine';
addPlugin({ name: 'ReadSceneCaption', build(app) {
    let inputCaption = null;
    app.addSystem(defineSystem([Res(Input)], input => {
        if (input.isKeyDown('KeyK')) inputCaption = app.world.findEntityByName('Caption');
    }));
    globalThis.captionReceivedInput = () => inputCaption != null && inputCaption === app.world.findEntityByName('Caption');
    globalThis.readCaption = () => {
        const entity = app.world.findEntityByName('Caption');
        if (entity == null || !app.hasResource(Localization)) return null;
        const pins = app.getResource(Assets).appScope.leases().filter(lease => typeof lease.value?.locale === 'string').length;
        return { text: app.world.get(entity, Text).content, pins, scenes: app.getResource(SceneManager).getActiveScenes() };
    };
    globalThis.setCaptionLocale = locale => app.getResource(Localization).setLocale(locale);
    globalThis.openCaptionScene = name => app.getResource(SceneManager).switchTo(name);
    globalThis.tryFutureScene = async transition => {
        inputCaption = null;
        const scenes = app.getResource(SceneManager);
        const name = scenes.getActive();
        const original = scenes.getScene(name);
        const caption = app.world.findEntityByName('Caption');
        try { await scenes.switchTo('future', { transition, duration: 0.05 }); }
        catch (error) {
            return {
                error: error.message,
                sameScene: scenes.getActive() === name && scenes.getScene(name) === original && !original.signal.aborted,
                sameCaption: app.world.valid(caption) && app.world.findEntityByName('Caption') === caption,
            };
        }
        throw new Error('Unsupported scene unexpectedly loaded');
    };
} });
`);
}

async function check(browser, project, dir, platform) {
    execFileSync(process.execPath, ['pipeline/bin/estella.mjs', 'export', project, '--platform', platform,
        '--out', dir, '--no-aot', ...(platform === 'playable' ? ['--all-scenes'] : [])], { cwd: ROOT, windowsHide: true });
    const mini = platform === 'wechat' || platform === 'douyin';
    const shell = mini ? HOST_PAGE('game.js', null, { hostGlobal: platform === 'wechat' ? 'wx' : 'tt' }) : null;
    const server = await serveDir(dir, {
        route: rel => shell && !rel ? { body: shell } : null,
        shape: ({ rel }) => rel.endsWith('.br') ? { headers: { 'content-encoding': 'br' } } : null,
    });
    const page = await browser.newPage({ locale: 'en-US' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const caption = (scene, text) => page.waitForFunction(([scene, text]) => {
        const state = globalThis.readCaption?.();
        return state?.text === text && state.pins === 3 && state.scenes.join() === scene;
    }, [scene, text], { timeout: 30_000 });
    try {
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await caption('hud', 'Start game');
        await page.evaluate(() => globalThis.setCaptionLocale('fr'));
        for (const scene of ['world', 'hud', 'world', 'hud']) {
            const previous = scene === 'world' ? 'hud' : 'world';
            const failure = await page.evaluate(transition => globalThis.tryFutureScene(transition), scene === 'world' ? 'none' : 'fade');
            assert.match(failure.error, /newer than this engine/);
            assert.equal(failure.sameScene, true);
            assert.equal(failure.sameCaption, true);
            await caption(previous, 'Commencer');
            await page.keyboard.down('k');
            try { await page.waitForFunction(() => globalThis.captionReceivedInput(), null, { timeout: 10_000 }); }
            finally { await page.keyboard.up('k'); }
            await page.evaluate(name => globalThis.openCaptionScene(name), scene);
            await caption(scene, 'Commencer');
        }
        await page.evaluate(() => globalThis.setCaptionLocale('en'));
        await caption('hud', 'Start game');
        assert.deepEqual(errors, []);
        console.log(platform + ': input and captions survived rejected cuts and fades, four successful switches, three table receipts');
    } catch (error) {
        const state = await page.evaluate(() => globalThis.readCaption?.()).catch(() => null);
        throw new Error(`${platform}: ${JSON.stringify({ state, errors })}`, { cause: error });
    } finally {
        await page.close();
        await new Promise(resolve => server.close(resolve));
    }
}

const root = await fs.mkdtemp(path.join(tmpdir(), 'estella-scene-locales-'));
let browser;
try {
    const project = path.join(root, 'project');
    await fixture(project);
    browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--enable-unsafe-swiftshader', '--mute-audio'] });
    for (const platform of ['web', 'playable', 'wechat', 'douyin']) await check(browser, project, path.join(root, platform), platform);
} finally {
    await browser?.close();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
