// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { chromium } from 'playwright';
import { HOST_PAGE } from '../launchers/minigameHost.mjs';
import { ROOT } from '../lib/repo.mjs';
import { serveDir } from '../lib/staticServer.mjs';

const FUTURE_SCENE = version => ({ version, name: 'future', entities: [] });

async function asset(project, ref, type, data, uuid = randomUUID()) {
    const file = path.join(project, ref);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, Buffer.isBuffer(data) ? data : JSON.stringify(data));
    await fs.writeFile(file + '.meta', JSON.stringify({ version: '2.0', uuid, type, importer: {} }));
}

async function fixture(project) {
    const image = 'assets/art/star.png', uuid = '6e5b6002-9bc4-4f60-a446-94ac83023a8c', texture = '@uuid:' + uuid;
    await asset(project, image, 'texture', await fs.readFile(path.join(ROOT, 'templates/wechat-minigame/assets/textures/star_tiny.png')), uuid);
    const clip = 'assets/art/pulse.esanim', timeline = 'assets/art/motion.estimeline', prefab = 'assets/art/effect.esprefab';
    const alternate = 'assets/art/alternate.estimeline', alternatePrefab = 'assets/art/alternate.esprefab';
    const alternatePrefabId = randomUUID();
    const frameTrack = { type: 'animFrames', name: 'Frame', childPath: '', animFrames: [{ texture }] };
    await asset(project, clip, 'animclip', { name: 'pulse', fps: 12, loop: true, frames: [{ texture }] });
    await asset(project, timeline, 'animation', { type: 'timeline', version: '1.3', duration: 2, wrapMode: 'loop', tracks: [
        { type: 'spawn', name: 'Effect', childPath: '', clips: [{ start: 0, duration: 1, prefab, name: 'Live effect' }] },
        { type: 'sequence', name: 'Alternate', childPath: '', clips: [{ start: 1, duration: 1, timeline: alternate }] },
        frameTrack,
        { type: 'property', name: 'Depth', childPath: '', component: 'Transform', channels: [
            { property: 'position.z', keyframes: [{ time: 0, value: 7, interpolation: 'linear', inTangent: 0, outTangent: 0 }] },
        ] },
    ] });
    await asset(project, alternate, 'animation', { type: 'timeline', version: '1.3', duration: 1, wrapMode: 'loop', tracks: [
        { type: 'spawn', name: 'Effect', childPath: '', clips: [{ start: 0, duration: 1, prefab: '@uuid:' + alternatePrefabId, name: 'Alternate effect' }] },
        frameTrack,
    ] });
    const entity = (id, name, components) => ({ id, name, parent: null, children: [], visible: true, components });
    const graph = 'assets/logic/agent.esgraph', callee = 'assets/logic/effect.esgraph';
    const wire = (from, to) => ({ id: from + '-' + to, from, fromPort: 'then', to, toPort: '' });
    await asset(project, graph, 'scriptgraph', { version: '1.0', nodes: [
        { id: 'event', kind: 'event.on', literals: { type: 'spawn-effect' } },
        { id: 'call', kind: 'graph.call', literals: { graph: callee } },
    ], edges: [wire('event', 'call')] });
    await asset(project, callee, 'scriptgraph', { version: '1.0', nodes: [
        { id: 'in', kind: 'graph.input' }, { id: 'make', kind: 'entity.spawn', literals: { prefab } },
    ], edges: [wire('in', 'make')] });
    const effect = { version: '2', name: 'Effect', rootEntityId: 'sprite', entities: [
        { prefabEntityId: 'sprite', name: 'Spark', parent: null, children: ['mesh'], visible: true,
            components: [{ type: 'Transform', data: {} }, { type: 'Sprite', data: { texture } }] },
        { prefabEntityId: 'mesh', name: 'Shard', parent: 'sprite', children: [], visible: true,
            components: [{ type: 'Transform', data: {} }, { type: 'MeshRenderer', data: { mesh: 'builtin:cube', texture } }] },
    ] };
    await asset(project, prefab, 'prefab', effect);
    await asset(project, alternatePrefab, 'prefab', effect, alternatePrefabId);
    for (const [scene, shape, sampler] of [
        ['hud', { type: 'Sprite', data: { texture } }, { [image]: { filterMode: 'nearest', wrapMode: 'repeat', mipmaps: false } }],
        ['world', { type: 'MeshRenderer', data: { mesh: 'builtin:cube', texture } }, { [texture]: { filterMode: 'linear', wrapMode: 'mirror', mipmaps: true } }],
    ]) {
        await asset(project, 'assets/scenes/' + scene + '.esscene', 'scene', { version: 4, name: scene, textureImporterSettings: sampler, entities: [
            entity(1, 'Caption', [{ type: 'Transform', data: {} }, { type: 'UIRect', data: {} }, { type: 'Text', data: { i18nKey: 'start' } }]),
            entity(2, scene, [{ type: 'Transform', data: {} }, shape, { type: 'ScriptGraphAgent', data: { graph } }]),
            entity(3, scene + '-clip', [{ type: 'Transform', data: {} }, { type: 'Sprite', data: {} },
                { type: 'SpriteAnimator', data: { clip, playing: true } }]),
            entity(4, scene + '-motion', [{ type: 'Transform', data: {} }, { type: 'Sprite', data: {} },
                { type: 'TimelinePlayer', data: { timeline, playing: true, rangeEnd: 1 } },
                ...(scene === 'world' ? [shape] : [])]),
        ] });
    }
    await asset(project, 'assets/scenes/boot.esscene', 'scene', { version: 4, name: 'boot', entities: [
        entity(1, 'Boot', [{ type: 'Transform', data: {} }]),
    ] });
    // Registered so every target ships it; plantFutureScene swaps in a newer document after export.
    await asset(project, 'assets/scenes/future.esscene', 'scene', FUTURE_SCENE(4));
    // The UUIDs sort in the opposite order to the two English filenames.
    for (const [file, locale, text, uuid] of [
        ['z-overlay', 'en', 'Start game', '00000000-0000-4000-8000-000000000001'],
        ['a-base', 'en', 'Start', 'ffffffff-ffff-4fff-bfff-fffffffffff2'],
        ['fr', 'fr', 'Commencer', '77777777-7777-4777-8777-777777777773'],
    ]) {
        await asset(project, 'assets/i18n/' + file + '.eslocale', 'locale', { locale, entries: { start: text } }, uuid);
    }
    await fs.writeFile(path.join(project, 'project.esproject'), JSON.stringify({
        formatVersion: '1', name: 'Localized scenes', defaultScene: 'assets/scenes/boot.esscene',
    }));
    await fs.mkdir(path.join(project, 'src'));
    await fs.writeFile(path.join(project, 'src/main.ts'), `
import { addPlugin, Assets, defineSystem, EntityEvents, Input, Localization, MeshRenderer, Name, Parent, Res, SceneManager, SceneOwner, Sprite, Text, Timeline, TimelinePlayer, Transform } from 'esengine';
addPlugin({ name: 'ReadSceneCaption', build(app) {
    let inputCaption = null;
    let ticks = 0;
    app.addSystem(defineSystem([Res(Input)], input => {
        ticks++;
        if (input.isKeyDown('KeyK')) inputCaption = app.world.findEntityByName('Caption');
    }));
    globalThis.captionReceivedInput = () => inputCaption != null && inputCaption === app.world.findEntityByName('Caption');
    globalThis.packageTicks = () => ticks;
    const localePins = () => app.getResource(Assets).appScope.leases().filter(lease => typeof lease.value?.locale === 'string').length;
    function sampling(handle) {
        const module = app.wasmModule, table = module.GL, rm = module.getResourceManager();
        const gl = table.currentContext?.GLctx ?? table.contexts.find(ctx => ctx?.GLctx)?.GLctx;
        const texture = table.textures[rm.getTextureNativeId(handle)];
        if (!gl || !texture) throw new Error('Missing WebGL texture for handle ' + handle);
        const previous = gl.getParameter(gl.TEXTURE_BINDING_2D);
        try {
            gl.bindTexture(gl.TEXTURE_2D, texture);
            return [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER, gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]
                .map(p => gl.getTexParameter(gl.TEXTURE_2D, p));
        } finally { gl.bindTexture(gl.TEXTURE_2D, previous); }
    }
    globalThis.sceneSampling = async () => {
        const name = app.getResource(SceneManager).getActive();
        if (name === 'boot') return null;
        const entity = app.world.findEntityByName(name);
        const visible = app.world.get(entity, name === 'hud' ? Sprite : MeshRenderer).texture;
        const raw = await app.getResource(Assets).acquireTexture('${texture}', false);
        try { return { visible: sampling(visible), raw: sampling(raw.value.handle) }; }
        finally { raw.release(); }
    };
    globalThis.playingSamples = name => {
        const clip = app.world.findEntityByName(name + '-clip'), motion = app.world.findEntityByName(name + '-motion');
        if (clip == null || motion == null) return null;
        return {
            clip: sampling(app.world.get(clip, Sprite).texture), timeline: sampling(app.world.get(motion, Sprite).texture),
            z: app.world.get(motion, Transform).position.z, mesh: name === 'world' && !!app.world.get(motion, MeshRenderer).mesh,
        };
    };
    const effects = new Map();
    const edited = new Map();
    globalThis.assignTextures = name => {
        const entity = app.getResource(SceneManager).getScene(name).spawn();
        edited.set(name, entity);
        app.world.insert(entity, Sprite, { texture: '${texture}' });
        app.world.insert(entity, MeshRenderer, { texture: '${image}' });
        return ticks;
    };
    globalThis.assignedSamples = name => {
        const entity = edited.get(name);
        const sprite = app.world.get(entity, Sprite).texture, mesh = app.world.get(entity, MeshRenderer).texture;
        return sprite && mesh ? [sampling(sprite), sampling(mesh)] : null;
    };
    globalThis.playEffects = playing => {
        const timeline = app.getResource(Timeline);
        for (const name of ['hud', 'world']) {
            const player = app.world.findEntityByName(name + '-motion');
            if (playing) timeline.play(player); else timeline.stop(player);
        }
        return ticks;
    };
    globalThis.changeEffects = () => {
        for (const name of ['hud', 'world']) {
            const player = app.world.findEntityByName(name + '-motion');
            const current = app.world.get(player, TimelinePlayer);
            app.world.set(player, TimelinePlayer, { ...current, timeline: '${alternate}', playing: true });
        }
        return ticks;
    };
    globalThis.timelineEffect = (name, label) => {
        const world = app.world, player = world.findEntityByName(name + '-motion');
        const childOf = (parent, component, label) => world.getEntitiesWithComponents([component, Parent])
            .find(e => world.get(e, Parent).entity === parent && (!label || world.tryGet(e, Name)?.value === label));
        const sprite = childOf(player, Sprite, label), mesh = sprite == null ? null : childOf(sprite, MeshRenderer);
        if (mesh == null) return null;
        return { owners: [sprite, mesh].map(e => world.tryGet(e, SceneOwner)?.scene ?? null),
            sprite: sampling(world.get(sprite, Sprite).texture), mesh: sampling(world.get(mesh, MeshRenderer).texture) };
    };
    globalThis.spawnGraphEffect = name => {
        const scene = app.getResource(SceneManager).getScene(name), before = new Set(scene.entities);
        app.getResource(EntityEvents).emit(app.world.findEntityByName(name), 'spawn-effect');
        const created = [...scene.entities].filter(entity => !before.has(entity));
        const sprite = created.find(entity => app.world.has(entity, Sprite)), mesh = created.find(entity => app.world.has(entity, MeshRenderer));
        if (created.length !== 2 || sprite == null || mesh == null || app.world.get(mesh, Parent).entity !== sprite)
            throw new Error(name + ' did not receive the sprite and its mesh child');
        effects.set(name, created);
        return [sampling(app.world.get(sprite, Sprite).texture), sampling(app.world.get(mesh, MeshRenderer).texture)];
    };
    globalThis.liveEffectParts = name => effects.get(name).filter(entity => app.world.valid(entity)).length;
    globalThis.addCaptionScene = name => app.getResource(SceneManager).loadAdditive(name).then(() => ticks);
    globalThis.removeCaptionScene = name => app.getResource(SceneManager).unload(name).then(() => ticks);
    globalThis.bootReady = () => {
        const scenes = app.getResource(SceneManager);
        return scenes.getActive() === 'boot' && scenes.getSceneStatus('boot') === 'running';
    };
    globalThis.probeCaptionPreload = async name => {
        const assets = app.getResource(Assets), scenes = app.getResource(SceneManager);
        const active = scenes.getActive(), original = scenes.getScene(active);
        const state = async () => ({
            sameScene: scenes.getActive() === active && scenes.getScene(active) === original && !original.signal.aborted,
            text: globalThis.readCaption()?.text ?? null,
            service: app.hasResource(Localization), pins: localePins(), decoded: assets.publishedRegistryAssets('locale').length,
            sampling: await globalThis.sceneSampling(),
        });
        await scenes.prepare(name);
        const prepared = await state();
        const released = scenes.discardPrepared(name);
        return { prepared, released, discarded: await state() };
    };
    globalThis.readCaption = () => {
        const entity = app.world.findEntityByName('Caption');
        if (entity == null || !app.hasResource(Localization)) return null;
        return { text: app.world.get(entity, Text).content, pins: localePins(), scenes: app.getResource(SceneManager).getActiveScenes() };
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

// Export refuses to package a scene newer than the engine, so a newer document only reaches a game that way from content
// delivered after the build. Put one in each package where that target's scene loader reads it, to exercise a registered
// but unreadable destination at runtime.
async function plantFutureScene(dir, platform) {
    const future = JSON.stringify(FUTURE_SCENE(999));
    if (platform === 'playable') {
        const file = path.join(dir, 'index.html');
        const html = await fs.readFile(file, 'utf8');
        const marker = /window\.__GAME_SCENES__=(\{[^}]*\});/;
        const packed = JSON.parse(html.match(marker)?.[1] ?? 'null');
        assert.ok(packed, 'playable scene table');
        const scenes = JSON.parse(inflateRawSync(Buffer.from(packed.z, 'base64')).toString('utf8'));
        const entry = scenes.find(scene => scene.name === 'future');
        assert.ok(entry, 'playable carries the future scene');
        entry.data = JSON.parse(future);
        const bytes = Buffer.from(JSON.stringify(scenes), 'utf8');
        const table = JSON.stringify({ z: deflateRawSync(bytes, { level: 9 }).toString('base64'), n: bytes.length });
        await fs.writeFile(file, html.replace(marker, () => `window.__GAME_SCENES__=${table};`));
        return;
    }
    const file = path.join(dir, platform === 'web' ? 'assets/scenes/future.esscene' : 'scenes/future.json');
    assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), FUTURE_SCENE(4), platform + ' packaged future scene');
    await fs.writeFile(file, future);
}

async function check(browser, project, dir, platform) {
    execFileSync(process.execPath, ['pipeline/bin/estella.mjs', 'export', project, '--platform', platform,
        '--out', dir, '--no-aot', ...(platform === 'playable' ? ['--all-scenes'] : [])], { cwd: ROOT, windowsHide: true });
    await plantFutureScene(dir, platform);
    const mini = platform === 'wechat' || platform === 'douyin';
    const shell = mini ? HOST_PAGE('game.js', null, { hostGlobal: platform === 'wechat' ? 'wx' : 'tt' }) : null;
    const server = await serveDir(dir, {
        route: rel => shell && !rel ? { body: shell } : null,
        shape: ({ rel }) => rel.endsWith('.br') ? { headers: { 'content-encoding': 'br' } } : null,
    });
    const page = await browser.newPage({ locale: 'en-US' });
    const errors = [];
    // WebGL NEAREST / REPEAT and LINEAR_MIPMAP_LINEAR / MIRRORED_REPEAT, read back from both axes.
    const samplers = { hud: [9728, 9728, 10497, 10497], world: [9987, 9729, 33648, 33648] };
    const sampling = scene => ({ visible: samplers[scene], raw: samplers[scene] });
    page.on('pageerror', error => errors.push(error.message));
    const caption = (scene, text) => page.waitForFunction(([scene, text]) => {
        const state = globalThis.readCaption?.();
        return state?.text === text && state.pins === 3 && state.scenes.join() === scene;
    }, [scene, text], { timeout: 30_000 });
    try {
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.waitForFunction(() => globalThis.bootReady?.(), null, { timeout: 30_000 });
        for (const name of ['hud', 'world']) {
            const result = await page.evaluate(name => globalThis.probeCaptionPreload(name), name);
            const boot = { sameScene: true, text: null, service: false, pins: 0, sampling: null };
            assert.deepEqual(result.prepared, { ...boot, decoded: 3 }, name);
            assert.ok(result.released >= 3, `${name} must release all its table references`);
            assert.deepEqual(result.discarded, { ...boot, decoded: 0 }, name);
        }
        await page.evaluate(() => globalThis.openCaptionScene('hud'));
        await caption('hud', 'Start game');
        await page.evaluate(() => globalThis.setCaptionLocale('fr'));
        await caption('hud', 'Commencer');
        const active = await page.evaluate(() => globalThis.probeCaptionPreload('world'));
        const playing = { sameScene: true, text: 'Commencer', service: true, pins: 3, decoded: 3, sampling: sampling('hud') };
        assert.deepEqual(active.prepared, playing);
        assert.ok(active.released >= 3);
        assert.deepEqual(active.discarded, playing);
        for (const scene of ['world', 'hud', 'world', 'hud']) {
            const previous = scene === 'world' ? 'hud' : 'world';
            const failure = await page.evaluate(transition => globalThis.tryFutureScene(transition), scene === 'world' ? 'none' : 'fade');
            assert.match(failure.error, /newer than this engine/);
            assert.equal(failure.sameScene, true);
            assert.equal(failure.sameCaption, true);
            await caption(previous, 'Commencer');
            assert.deepEqual(await page.evaluate(() => globalThis.sceneSampling()), sampling(previous));
            await page.keyboard.down('k');
            try { await page.waitForFunction(() => globalThis.captionReceivedInput(), null, { timeout: 10_000 }); }
            finally { await page.keyboard.up('k'); }
            await page.evaluate(name => globalThis.openCaptionScene(name), scene);
            await caption(scene, 'Commencer');
            assert.deepEqual(await page.evaluate(() => globalThis.sceneSampling()), sampling(scene));
        }
        await page.evaluate(() => globalThis.setCaptionLocale('en'));
        await caption('hud', 'Start game');
        const advance = after => page.waitForFunction(tick => globalThis.packageTicks() >= tick + 3, after);
        const expected = name => ({ clip: samplers[name], timeline: samplers[name], z: 7, mesh: name === 'world' });
        await advance(await page.evaluate(() => globalThis.addCaptionScene('world')));
        for (const name of ['hud', 'world']) {
            assert.deepEqual(await page.evaluate(name => globalThis.playingSamples(name), name), expected(name), platform + ' additive ' + name);
            assert.deepEqual(await page.evaluate(name => globalThis.spawnGraphEffect(name), name), [samplers[name], samplers[name]], platform + ' graph ' + name);
        }
        const checkTimelineEffects = async label => {
            await page.waitForFunction(label => ['hud', 'world'].every(name => globalThis.timelineEffect(name, label)), label);
            for (const name of ['hud', 'world']) assert.deepEqual(await page.evaluate(([name, label]) => globalThis.timelineEffect(name, label), [name, label]),
                { owners: [name, name], sprite: samplers[name], mesh: samplers[name] }, platform + ' ' + label + ' ' + name);
        };
        await checkTimelineEffects('Live effect');
        await advance(await page.evaluate(() => globalThis.playEffects(false)));
        assert.deepEqual(await page.evaluate(() => ['hud', 'world'].map(name => globalThis.timelineEffect(name))), [null, null]);
        await advance(await page.evaluate(() => globalThis.playEffects(true)));
        await checkTimelineEffects('Live effect');
        await advance(await page.evaluate(() => globalThis.changeEffects()));
        await checkTimelineEffects('Alternate effect');
        for (const name of ['hud', 'world']) {
            await advance(await page.evaluate(name => globalThis.assignTextures(name), name));
            await page.waitForFunction(name => globalThis.assignedSamples(name), name);
            assert.deepEqual(await page.evaluate(name => globalThis.assignedSamples(name), name),
                [samplers[name], samplers[name]], platform + ' live texture assignment ' + name);
        }
        await advance(await page.evaluate(() => globalThis.removeCaptionScene('world')));
        assert.deepEqual(await page.evaluate(() => ['hud', 'world'].map(name => globalThis.liveEffectParts(name))), [2, 0]);
        assert.deepEqual(await page.evaluate(() => globalThis.playingSamples('hud')), expected('hud'));
        assert.deepEqual(errors, []);
        console.log(platform + ' passed preload/discard, four switches, scene-owned graph and timeline spawns, and live sprite and mesh texture assignments');
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
