// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  WeChat MiniGame export — structure / contract alignment. Asserts the
 *        output matches what initWeChatRuntime consumes: AddressableManifest
 *        (asset-manifest.json), @uuid:-stripped scenes/<name>.json, the single
 *        CJS game-bundle (esengine aliased so project scripts share one instance),
 *        the game.js entry, the wasm copy, and game.json/project.config.json.
 *        (Runtime correctness is validated by the user in WeChat devtools — no
 *        simulator here.)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportGame } from '../electron/exportGame';

let root: string;
let out: string;
const TEX = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SCN = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SUBTEX = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const meta = (uuid: string, type: string) => JSON.stringify({ uuid, version: '2.0', type, importer: {} });

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-export-wechat-'));
  mkdirSync(path.join(root, 'assets'), { recursive: true });
  writeFileSync(path.join(root, 'assets', 'hero.png'), 'PNGDATA');
  writeFileSync(path.join(root, 'assets', 'hero.png.meta'), meta(TEX, 'texture'));
  mkdirSync(path.join(root, 'scenes'), { recursive: true });
  writeFileSync(
    path.join(root, 'scenes', 'main.esscene'),
    JSON.stringify({ version: '1.0', name: 'Main', entities: [{ id: 0, components: [{ type: 'Sprite', data: { texture: `@uuid:${TEX}` } }] }] }),
  );
  writeFileSync(path.join(root, 'scenes', 'main.esscene.meta'), meta(SCN, 'scene'));
  // A lazy-subpackage asset (folder convention): NOT referenced by the entry
  // scene, so it exercises force-include + grouping.
  mkdirSync(path.join(root, 'subpackages', 'level2'), { recursive: true });
  writeFileSync(path.join(root, 'subpackages', 'level2', 'extra.png'), 'PNG2DATA');
  writeFileSync(path.join(root, 'subpackages', 'level2', 'extra.png.meta'), meta(SUBTEX, 'texture'));
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'main.ts'), `import { defineComponent } from 'esengine';\ndefineComponent('SpawnMarker', { rate: 1 });\n`);
  // Stub SDK dist (the bundle aliases `esengine` → <sdkDir>/index.wechat.js) + stub -t wechat runtime.
  mkdirSync(path.join(root, '_sdk'), { recursive: true });
  writeFileSync(path.join(root, '_sdk', 'index.wechat.js'), `export function initWeChatRuntime(){return Promise.resolve();}\nexport function defineComponent(){}\n`);
  mkdirSync(path.join(root, '_wxwasm'), { recursive: true });
  writeFileSync(path.join(root, '_wxwasm', 'esengine.js'), 'module.exports = () => Promise.resolve({});');
  writeFileSync(path.join(root, '_wxwasm', 'esengine.wasm'), 'wasmbytes');

  out = path.join(root, 'dist-wechat');
}, 60_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('exportGame (wechat)', () => {
  it('assembles a MiniGame matching the initWeChatRuntime contract', async () => {
    const res = await exportGame({
      root,
      entryScene: 'scenes/main.esscene',
      gameHostEntry: 'unused-for-wechat',
      scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'),
      wasmDir: path.join(root, '_wxwasm'),
      outDir: out,
      title: 'My Game',
      platform: 'wechat',
      wechatAppid: 'wxTEST0123456789',
      orientation: 'landscape',
      screenFit: { designWidth: 1280, designHeight: 720, scaleMode: 2, matchWidthOrHeight: 0.5 },
    });

    expect(res.ok).toBe(true);
    expect(res.platform).toBe('wechat');

    // AddressableManifest (asset-manifest.json), web flat manifest removed.
    expect(existsSync(path.join(out, 'assets.manifest.json'))).toBe(false);
    const manifest = JSON.parse(readFileSync(path.join(out, 'asset-manifest.json'), 'utf8'));
    expect(manifest.version).toBe('2.0');
    expect(manifest.groups.main.assets[TEX].path).toBe('assets/hero.png');
    expect(manifest.groups.main.assets[TEX].type).toBe('texture');

    // Scene at scenes/<name>.json with @uuid: stripped to the bare uuid.
    const scene = JSON.parse(readFileSync(path.join(out, 'scenes', 'main.json'), 'utf8'));
    expect(scene.entities[0].components[0].data.texture).toBe(TEX); // no @uuid: prefix

    // One CJS bundle (SDK aliased + project scripts) exposing boot(), + the entry.
    const bundle = readFileSync(path.join(out, 'game-bundle.js'), 'utf8');
    expect(bundle).toContain('boot');
    expect(bundle).toContain('SpawnMarker'); // project script inlined into the one bundle
    const entry = readFileSync(path.join(out, 'game.js'), 'utf8');
    expect(entry).toContain("require('./game-bundle.js')");
    expect(entry).toContain("require('./wasm/esengine.js')");
    // The boot config names the staged glue's .wasm twin — WXWebAssembly
    // instantiates by package-relative path, so the runtime must not guess.
    expect(bundle).toContain('wasm/esengine.wasm');
    // The project camera fit rides the boot config into initWeChatRuntime.
    expect(bundle).toContain('screenFit');
    expect(bundle).toMatch(/"scaleMode":\s*2/);

    // Config + runtime copy.
    const pcfg = JSON.parse(readFileSync(path.join(out, 'project.config.json'), 'utf8'));
    expect(pcfg.compileType).toBe('game');
    expect(pcfg.projectname).toBe('My Game');
    expect(pcfg.appid).toBe('wxTEST0123456789'); // from Project Settings → Packaging
    const gjson = JSON.parse(readFileSync(path.join(out, 'game.json'), 'utf8'));
    expect(gjson.deviceOrientation).toBe('landscape');
    expect(existsSync(path.join(out, 'wasm', 'esengine.js'))).toBe(true);
    expect(existsSync(path.join(out, 'wasm', 'esengine.wasm'))).toBe(true);

    // 分包: the subpackages/level2 asset forms a lazy group, registered as a
    // WeChat subPackage, with its file staged under the subpackage root.
    expect(manifest.groups.level2.bundleMode).toBe('lazy');
    expect(manifest.groups.main.bundleMode).toBe('local');
    expect(manifest.groups.level2.assets[SUBTEX].path).toBe('subpackages/level2/extra.png');
    expect(gjson.subPackages).toContainEqual({ name: 'level2', root: 'subpackages/level2' });
    expect(existsSync(path.join(out, 'subpackages', 'level2', 'extra.png'))).toBe(true);
  }, 60_000);

  it('requires the glue by its actual -t wechat name; unneeded side modules stay out (4MB budget)', async () => {
    const wxDir = path.join(root, '_wxwasm-wxgame');
    mkdirSync(wxDir, { recursive: true });
    writeFileSync(path.join(wxDir, 'esengine.wxgame.js'), 'module.exports = () => Promise.resolve({});');
    writeFileSync(path.join(wxDir, 'esengine.wxgame.wasm'), 'wasmbytes');
    // Present in the runtime dir but not needed by the scene — must not ship.
    writeFileSync(path.join(wxDir, 'physics.js'), 'module.exports = () => {};');
    writeFileSync(path.join(wxDir, 'physics.wasm'), 'wasmbytes');
    const outWx = path.join(root, 'dist-wechat-wxgame');
    const res = await exportGame({
      root,
      entryScene: 'scenes/main.esscene',
      gameHostEntry: 'unused-for-wechat',
      scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'),
      wasmDir: wxDir,
      outDir: outWx,
      platform: 'wechat',
    });
    expect(res.ok).toBe(true);
    expect(readFileSync(path.join(outWx, 'game.js'), 'utf8')).toContain("require('./wasm/esengine.wxgame.js')");
    expect(readFileSync(path.join(outWx, 'game-bundle.js'), 'utf8')).toContain('wasm/esengine.wxgame.wasm');
    expect(existsSync(path.join(outWx, 'wasm', 'esengine.wxgame.wasm'))).toBe(true);
    expect(existsSync(path.join(outWx, 'wasm', 'physics.js'))).toBe(false);
    expect(existsSync(path.join(outWx, 'wasm', 'physics.wasm'))).toBe(false);

    // …and the budget in that title is now MEASURED, not just a motive. WeChat's
    // two limits ride the mini-game path the same way they ride every other one,
    // and the main-package figure counts the engine and the bundle — the bytes a
    // player downloads before anything runs, which is what the 4MB applies to.
    const initial = res.size?.verdicts.find((v) => v.budget.scope === 'initial');
    const total = res.size?.verdicts.find((v) => v.budget.scope === 'total');
    expect(initial?.budget.maxBytes).toBe(4 * 1024 * 1024);
    expect(total?.budget.maxBytes).toBe(20 * 1024 * 1024);
    expect(initial?.status).toBe('ok');
    expect(res.size?.byKind.find((k) => k.kind === 'engine')?.bytes).toBeGreaterThan(0);
    // The fixture's subpackage asset (`subpackages/level2/extra.png`, 8 bytes of
    // "PNG2DATA") is in the package but NOT in the main one — the distinction the
    // 4MB limit is judged on, measured end-to-end on the real mini-game path.
    expect(res.size?.lazyBytes).toBe(8);
    expect(res.size?.packageBytes).toBe(res.size!.initialBytes + 8);
    expect(initial?.measuredBytes).toBe(res.size?.initialBytes);
  }, 60_000);

  it('fails fast when the -t wechat engine runtime is missing', async () => {
    const outMissing = path.join(root, 'dist-wechat-missing');
    const res = await exportGame({
      root,
      entryScene: 'scenes/main.esscene',
      gameHostEntry: 'unused-for-wechat',
      scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'),
      wasmDir: path.join(root, '_no-such-wasm'),
      outDir: outMissing,
      platform: 'wechat',
    });
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toContain('build -t wechat');
    // Failed before cooking — no half-assembled package left behind.
    expect(existsSync(outMissing)).toBe(false);
  }, 60_000);

  it('detects a spine skeleton (authored meta type "spine") and ships exactly its module', async () => {
    const SPINE = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    const SPINESCN = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
    writeFileSync(path.join(root, 'assets', 'boy.json'), JSON.stringify({ skeleton: { spine: '4.2.22' } }));
    writeFileSync(path.join(root, 'assets', 'boy.json.meta'), meta(SPINE, 'spine'));
    // Own scenes dir: scene discovery walks the entry's dir, and this test's
    // scene must not leak into the other exports (nor theirs into this one).
    mkdirSync(path.join(root, 'scenes-spine'), { recursive: true });
    writeFileSync(
      path.join(root, 'scenes-spine', 'spine.esscene'),
      JSON.stringify({ version: '1.0', name: 'Spine', entities: [{ id: 0, components: [{ type: 'SpineSkeleton', data: { skeleton: `@uuid:${SPINE}` } }] }] }),
    );
    writeFileSync(path.join(root, 'scenes-spine', 'spine.esscene.meta'), meta(SPINESCN, 'scene'));
    const wxDir = path.join(root, '_wxwasm-spine');
    mkdirSync(wxDir, { recursive: true });
    writeFileSync(path.join(wxDir, 'esengine.js'), 'module.exports = () => Promise.resolve({});');
    writeFileSync(path.join(wxDir, 'esengine.wasm'), 'wasmbytes');
    writeFileSync(path.join(wxDir, 'spine42.js'), 'module.exports = () => {};');
    writeFileSync(path.join(wxDir, 'spine42.wasm'), 'wasmbytes');

    const outSpine = path.join(root, 'dist-wechat-spine');
    const res = await exportGame({
      root,
      entryScene: 'scenes-spine/spine.esscene',
      gameHostEntry: 'unused-for-wechat',
      scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'),
      wasmDir: wxDir,
      outDir: outSpine,
      platform: 'wechat',
    });
    expect(res.ok).toBe(true);
    const entry = readFileSync(path.join(outSpine, 'game.js'), 'utf8');
    expect(entry).toContain("\"spine:4.2\": asFactory(require('./wasm/spine42.js'))");
    expect(existsSync(path.join(outSpine, 'wasm', 'spine42.wasm'))).toBe(true);
    // Scenes restage as scenes/<name>.json, so no .esscene ships — and native
    // types stay out of the include list; it exists for the custom ones.
    const spcfg = JSON.parse(readFileSync(path.join(outSpine, 'project.config.json'), 'utf8'));
    expect(spcfg.packOptions?.include ?? []).not.toContainEqual({ type: 'suffix', value: '.esscene' });
    expect(spcfg.packOptions?.include ?? []).not.toContainEqual({ type: 'suffix', value: '.json' });
    // The manifest keeps the real addressable type, not a 'binary' downgrade.
    const manifest = JSON.parse(readFileSync(path.join(outSpine, 'asset-manifest.json'), 'utf8'));
    expect(manifest.groups.main.assets[SPINE].type).toBe('spine');
  }, 60_000);

  it('a needed spine module missing from the runtime dir fails the export', async () => {
    const outBroken = path.join(root, 'dist-wechat-spine-missing');
    const res = await exportGame({
      root,
      entryScene: 'scenes-spine/spine.esscene',
      gameHostEntry: 'unused-for-wechat',
      scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'),
      wasmDir: path.join(root, '_wxwasm'), // engine only — no spine42
      outDir: outBroken,
      platform: 'wechat',
    });
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes('spine-wechat'))).toBe(true);
  }, 60_000);

  it('a staged .ktx2 texture ships the Basis transcoder module', async () => {
    const KTX = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    const KTXSCN = 'abababab-abab-abab-abab-abababababab';
    writeFileSync(path.join(root, 'assets', 'pre.ktx2'), 'KTX2BYTES');
    writeFileSync(path.join(root, 'assets', 'pre.ktx2.meta'), meta(KTX, 'texture'));
    mkdirSync(path.join(root, 'scenes-ktx2'), { recursive: true });
    writeFileSync(
      path.join(root, 'scenes-ktx2', 'ktx2.esscene'),
      JSON.stringify({ version: '1.0', name: 'Ktx', entities: [{ id: 0, components: [{ type: 'Sprite', data: { texture: `@uuid:${KTX}` } }] }] }),
    );
    writeFileSync(path.join(root, 'scenes-ktx2', 'ktx2.esscene.meta'), meta(KTXSCN, 'scene'));
    const wxDir = path.join(root, '_wxwasm-basis');
    mkdirSync(wxDir, { recursive: true });
    writeFileSync(path.join(wxDir, 'esengine.js'), 'module.exports = () => Promise.resolve({});');
    writeFileSync(path.join(wxDir, 'esengine.wasm'), 'wasmbytes');
    writeFileSync(path.join(wxDir, 'basis.js'), 'module.exports = () => {};');
    writeFileSync(path.join(wxDir, 'basis.wasm'), 'wasmbytes');

    const outKtx = path.join(root, 'dist-wechat-ktx2');
    const res = await exportGame({
      root,
      entryScene: 'scenes-ktx2/ktx2.esscene',
      gameHostEntry: 'unused-for-wechat',
      scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'),
      wasmDir: wxDir,
      outDir: outKtx,
      platform: 'wechat',
    });
    expect(res.ok).toBe(true);
    expect(readFileSync(path.join(outKtx, 'game.js'), 'utf8')).toContain("\"basis\": asFactory(require('./wasm/basis.js'))");
    expect(existsSync(path.join(outKtx, 'wasm', 'basis.wasm'))).toBe(true);
    // WeChat's code-package suffix whitelist has no `ktx2` — the container is
    // re-staged as .ktx2.bin (whitelisted), and the manifest tracks the rename
    // while the logical identity stays on the source path.
    expect(existsSync(path.join(outKtx, 'assets', 'pre.ktx2.bin'))).toBe(true);
    expect(existsSync(path.join(outKtx, 'assets', 'pre.ktx2'))).toBe(false);
    const manifest = JSON.parse(readFileSync(path.join(outKtx, 'asset-manifest.json'), 'utf8'));
    const ktxAsset = manifest.groups.main.assets['ffffffff-ffff-ffff-ffff-ffffffffffff'];
    expect(ktxAsset.path).toBe('assets/pre.ktx2.bin');
    const pcfg = JSON.parse(readFileSync(path.join(outKtx, 'project.config.json'), 'utf8'));
    expect(pcfg.packOptions.include).toContainEqual({ type: 'suffix', value: '.bin' });
    expect(pcfg.packOptions.include).not.toContainEqual({ type: 'suffix', value: '.ktx2' });
  }, 60_000);

  it('a .ktx2 texture without a wechat basis build fails the export', async () => {
    const outNoBasis = path.join(root, 'dist-wechat-ktx2-missing');
    const res = await exportGame({
      root,
      entryScene: 'scenes-ktx2/ktx2.esscene',
      gameHostEntry: 'unused-for-wechat',
      scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'),
      wasmDir: path.join(root, '_wxwasm'), // engine only — no basis
      outDir: outNoBasis,
      platform: 'wechat',
    });
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes('basis-wechat'))).toBe(true);
  }, 60_000);

  it('re-exporting into a populated dir rematerializes wasm/, dropping a stale side module', async () => {
    // A prior export shipped the Basis transcoder (KTX2 was on then), including
    // a glue file an older pipeline emitted with un-down-leveled es2020 syntax —
    // the mini-game packer compiles EVERY .js in the package, so a leftover
    // `wasm/basis.js` with `?.` fails real-device compile. This project needs no
    // basis (plain texture scene); the re-export must wipe wasm/ and repopulate
    // it with exactly the engine glue, so the stale module cannot ride along.
    const outStale = path.join(root, 'dist-wechat-stale');
    mkdirSync(path.join(outStale, 'wasm'), { recursive: true });
    writeFileSync(path.join(outStale, 'wasm', 'basis.js'), 'var s = globalThis.document?.currentScript?.src;');
    writeFileSync(path.join(outStale, 'wasm', 'basis.wasm'), 'stalebytes');
    const res = await exportGame({
      root,
      entryScene: 'scenes/main.esscene',
      gameHostEntry: 'unused-for-wechat',
      scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'),
      wasmDir: path.join(root, '_wxwasm'),
      outDir: outStale,
      platform: 'wechat',
    });
    expect(res.ok).toBe(true);
    expect(existsSync(path.join(outStale, 'wasm', 'esengine.js'))).toBe(true);
    expect(existsSync(path.join(outStale, 'wasm', 'basis.js'))).toBe(false);
    expect(existsSync(path.join(outStale, 'wasm', 'basis.wasm'))).toBe(false);
  }, 60_000);

  it('content-addressed export carries the logical path as the asset address', async () => {
    const outCa = path.join(root, 'dist-wechat-ca');
    const res = await exportGame({
      root,
      entryScene: 'scenes/main.esscene',
      gameHostEntry: 'unused-for-wechat',
      scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'),
      wasmDir: path.join(root, '_wxwasm'),
      outDir: outCa,
      title: 'My Game',
      platform: 'wechat',
      contentAddressed: true,
    });
    expect(res.ok).toBe(true);

    const manifest = JSON.parse(readFileSync(path.join(outCa, 'asset-manifest.json'), 'utf8'));
    const tex = manifest.groups.main.assets[TEX];
    // Physical file renamed; the logical identity rides as the address —
    // the runtime's ManifestModel + catalog resolve path refs through it.
    expect(tex.path).toMatch(/^assets\/[0-9a-f]{16}\.png$/);
    expect(tex.address).toBe('assets/hero.png');
    // The scene restaged to scenes/<name>.json keeps its logical path as the
    // address, so scene refs resolve to the WeChat-readable file.
    expect(manifest.groups.main.assets[SCN].path).toBe('scenes/main.json');
    expect(manifest.groups.main.assets[SCN].address).toBe('scenes/main.esscene');
  }, 60_000);

  it('ships every scene in the scenes dir as a switchable SceneManager target', async () => {
    const LV2TEX = '99999999-9999-9999-9999-999999999999';
    const LV2SCN = '88888888-8888-8888-8888-888888888888';
    mkdirSync(path.join(root, 'scenes-multi'), { recursive: true });
    writeFileSync(
      path.join(root, 'scenes-multi', 'main.esscene'),
      JSON.stringify({ version: '1.0', name: 'Main', entities: [{ id: 0, components: [{ type: 'Sprite', data: { texture: `@uuid:${TEX}` } }] }] }),
    );
    writeFileSync(path.join(root, 'scenes-multi', 'main.esscene.meta'), meta('12121212-1212-1212-1212-121212121212', 'scene'));
    writeFileSync(path.join(root, 'assets', 'lv2.png'), 'PNG3DATA');
    writeFileSync(path.join(root, 'assets', 'lv2.png.meta'), meta(LV2TEX, 'texture'));
    writeFileSync(
      path.join(root, 'scenes-multi', 'level2.esscene'),
      JSON.stringify({ version: '1.0', name: 'Level2', entities: [{ id: 0, components: [{ type: 'Sprite', data: { texture: `@uuid:${LV2TEX}` } }] }] }),
    );
    writeFileSync(path.join(root, 'scenes-multi', 'level2.esscene.meta'), meta(LV2SCN, 'scene'));

    const outMulti = path.join(root, 'dist-wechat-multi');
    const res = await exportGame({
      root,
      entryScene: 'scenes-multi/main.esscene',
      gameHostEntry: 'unused-for-wechat',
      scriptsEntry: 'src/main.ts',
      sdkDistDir: path.join(root, '_sdk'),
      wasmDir: path.join(root, '_wxwasm'),
      outDir: outMulti,
      platform: 'wechat',
    });
    expect(res.ok).toBe(true);

    // Both scenes transformed; the staged .esscene sources (not in WeChat's
    // suffix whitelist) are gone, their manifest entries following the move.
    expect(existsSync(path.join(outMulti, 'scenes', 'main.json'))).toBe(true);
    expect(existsSync(path.join(outMulti, 'scenes', 'level2.json'))).toBe(true);
    expect(existsSync(path.join(outMulti, 'scenes-multi', 'main.esscene'))).toBe(false);
    expect(existsSync(path.join(outMulti, 'scenes-multi', 'level2.esscene'))).toBe(false);
    const manifest = JSON.parse(readFileSync(path.join(outMulti, 'asset-manifest.json'), 'utf8'));
    expect(manifest.groups.main.assets[LV2SCN].path).toBe('scenes/level2.json');
    // The second scene is a cook root: its assets ship even though the entry
    // scene never references them.
    expect(manifest.groups.main.assets[LV2TEX].path).toBe('assets/lv2.png');
    // Boot registers every scene, booting into the entry.
    const bundle = readFileSync(path.join(outMulti, 'game-bundle.js'), 'utf8');
    expect(bundle).toContain('"main"');
    expect(bundle).toContain('"level2"');
    expect(bundle).toContain('firstScene: "main"');
    // No .esscene rides in packOptions — nothing ships under that suffix.
    const pcfg = JSON.parse(readFileSync(path.join(outMulti, 'project.config.json'), 'utf8'));
    expect(pcfg.packOptions?.include ?? []).not.toContainEqual({ type: 'suffix', value: '.esscene' });
  }, 60_000);
});

/**
 * The open data context — a SECOND bundle for a second JS runtime, which is the
 * only place a player's friends can be read. Its own project roots: the presence
 * of an `open-data/` directory changes the emitted config, so a case that adds
 * one must not be able to leak into a case that asserts its absence.
 */
describe('exportGame (wechat) — open data context', () => {
  const roots: string[] = [];

  /** A minimal exportable project: one scene, one texture, stub SDK + runtime.
   *  `builtIn` puts the engine's own context bundle in the stub SDK dir, the way
   *  a real `dist/` carries it. */
  function scaffold(openDataSource?: string, builtIn?: string): { root: string; out: string } {
    const dir = mkdtempSync(path.join(tmpdir(), 'estella-export-opendata-'));
    roots.push(dir);
    mkdirSync(path.join(dir, 'assets'), { recursive: true });
    writeFileSync(path.join(dir, 'assets', 'hero.png'), 'PNGDATA');
    writeFileSync(path.join(dir, 'assets', 'hero.png.meta'), meta(TEX, 'texture'));
    mkdirSync(path.join(dir, 'scenes'), { recursive: true });
    writeFileSync(
      path.join(dir, 'scenes', 'main.esscene'),
      JSON.stringify({ version: '1.0', name: 'Main', entities: [{ id: 0, components: [{ type: 'Sprite', data: { texture: `@uuid:${TEX}` } }] }] }),
    );
    writeFileSync(path.join(dir, 'scenes', 'main.esscene.meta'), meta(SCN, 'scene'));
    mkdirSync(path.join(dir, '_sdk'), { recursive: true });
    writeFileSync(path.join(dir, '_sdk', 'index.wechat.js'), 'export function initWeChatRuntime(){return Promise.resolve();}\n');
    if (builtIn !== undefined) writeFileSync(path.join(dir, '_sdk', 'open-data.js'), builtIn);
    mkdirSync(path.join(dir, '_wxwasm'), { recursive: true });
    writeFileSync(path.join(dir, '_wxwasm', 'esengine.js'), 'module.exports = () => Promise.resolve({});');
    writeFileSync(path.join(dir, '_wxwasm', 'esengine.wasm'), 'wasmbytes');
    if (openDataSource !== undefined) {
      mkdirSync(path.join(dir, 'open-data'), { recursive: true });
      writeFileSync(path.join(dir, 'open-data', 'index.ts'), openDataSource);
    }
    return { root: dir, out: path.join(dir, 'dist-wechat') };
  }

  const exportIt = (root: string, out: string) => exportGame({
    root,
    entryScene: 'scenes/main.esscene',
    gameHostEntry: 'unused-for-wechat',
    sdkDistDir: path.join(root, '_sdk'),
    wasmDir: path.join(root, '_wxwasm'),
    outDir: out,
    platform: 'wechat',
  });

  afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

  it('a project without one declares no context — an absent directory would fail the host compile', async () => {
    const { root: r, out: o } = scaffold();
    const res = await exportIt(r, o);
    expect(res.ok).toBe(true);
    expect(existsSync(path.join(o, 'open-data'))).toBe(false);
    expect(JSON.parse(readFileSync(path.join(o, 'game.json'), 'utf8'))).not.toHaveProperty('openDataContext');
  }, 60_000);

  it('a project with one is bundled beside the game and named in game.json', async () => {
    const { root: r, out: o } = scaffold(
      'const draw = (n?: { rows?: string[] }) => n?.rows?.length ?? 0;\n'
      + 'wx.onMessage((m: { rows?: string[] }) => { draw(m); });\n'
      + 'declare const wx: { onMessage(cb: (m: unknown) => void): void };\n',
    );
    const res = await exportIt(r, o);
    expect(res.ok).toBe(true);

    const bundled = path.join(o, 'open-data', 'index.js');
    expect(existsSync(bundled)).toBe(true);
    expect(JSON.parse(readFileSync(path.join(o, 'game.json'), 'utf8')).openDataContext).toBe('open-data');

    // Down-levelled to the vendor's syntax floor like every other .js in the
    // package: the host compiles this file too, and real-device WeChat rejects
    // the optional chaining the source is written with.
    const code = readFileSync(bundled, 'utf8');
    expect(code).not.toContain('?.');
  }, 60_000);

  it('ships the engine\'s built-in board when the project wrote none', async () => {
    // The context is the hardest part of a mini-game to write, and a game that
    // just wants a friends board should not have to. So the capability arrives
    // working rather than as a directory you are expected to fill.
    const { root: r, out: o } = scaffold(undefined, '/* built-in board */ globalThis.__ESTELLA_BOARD__ = 1;\n');
    const res = await exportIt(r, o);
    expect(res.ok).toBe(true);
    expect(readFileSync(path.join(o, 'open-data', 'index.js'), 'utf8')).toContain('__ESTELLA_BOARD__');
    expect(JSON.parse(readFileSync(path.join(o, 'game.json'), 'utf8')).openDataContext).toBe('open-data');
  }, 60_000);

  it('the project\'s own context wins over the built-in', async () => {
    const { root: r, out: o } = scaffold(
      'declare const wx: { onMessage(cb: (m: unknown) => void): void };\nwx.onMessage(() => { (globalThis as Record<string, unknown>).__MINE__ = 1; });\n',
      '/* built-in board */ globalThis.__ESTELLA_BOARD__ = 1;\n',
    );
    const res = await exportIt(r, o);
    expect(res.ok).toBe(true);
    const code = readFileSync(path.join(o, 'open-data', 'index.js'), 'utf8');
    expect(code).toContain('__MINE__');
    expect(code).not.toContain('__ESTELLA_BOARD__');
  }, 60_000);

  it('a context that imports the engine fails the export, not the device', async () => {
    const { root: r, out: o } = scaffold("import { Assets } from 'esengine';\nAssets.toString();\n");
    const res = await exportIt(r, o);
    expect(res.ok).toBe(false);
    expect(res.errors.join('\n')).toMatch(/esengine/);
    // And a failed context leaves the config pointing at nothing.
    expect(JSON.parse(readFileSync(path.join(o, 'game.json'), 'utf8'))).not.toHaveProperty('openDataContext');
  }, 60_000);
});
