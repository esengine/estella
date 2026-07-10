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
      wechatOrientation: 'landscape',
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
    writeFileSync(
      path.join(root, 'scenes', 'spine.esscene'),
      JSON.stringify({ version: '1.0', name: 'Spine', entities: [{ id: 0, components: [{ type: 'SpineSkeleton', data: { skeleton: `@uuid:${SPINE}` } }] }] }),
    );
    writeFileSync(path.join(root, 'scenes', 'spine.esscene.meta'), meta(SPINESCN, 'scene'));
    const wxDir = path.join(root, '_wxwasm-spine');
    mkdirSync(wxDir, { recursive: true });
    writeFileSync(path.join(wxDir, 'esengine.js'), 'module.exports = () => Promise.resolve({});');
    writeFileSync(path.join(wxDir, 'esengine.wasm'), 'wasmbytes');
    writeFileSync(path.join(wxDir, 'spine42.js'), 'module.exports = () => {};');
    writeFileSync(path.join(wxDir, 'spine42.wasm'), 'wasmbytes');

    const outSpine = path.join(root, 'dist-wechat-spine');
    const res = await exportGame({
      root,
      entryScene: 'scenes/spine.esscene',
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
    const spcfg = JSON.parse(readFileSync(path.join(outSpine, 'project.config.json'), 'utf8'));
    expect(spcfg.packOptions.include).toContainEqual({ type: 'suffix', value: '.esscene' });
    // Native types stay out of the include list — it exists for the custom ones.
    expect(spcfg.packOptions.include).not.toContainEqual({ type: 'suffix', value: '.json' });
    // The manifest keeps the real addressable type, not a 'binary' downgrade.
    const manifest = JSON.parse(readFileSync(path.join(outSpine, 'asset-manifest.json'), 'utf8'));
    expect(manifest.groups.main.assets[SPINE].type).toBe('spine');
  }, 60_000);

  it('a needed spine module missing from the runtime dir fails the export', async () => {
    const outBroken = path.join(root, 'dist-wechat-spine-missing');
    const res = await exportGame({
      root,
      entryScene: 'scenes/spine.esscene',
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
    writeFileSync(
      path.join(root, 'scenes', 'ktx2.esscene'),
      JSON.stringify({ version: '1.0', name: 'Ktx', entities: [{ id: 0, components: [{ type: 'Sprite', data: { texture: `@uuid:${KTX}` } }] }] }),
    );
    writeFileSync(path.join(root, 'scenes', 'ktx2.esscene.meta'), meta(KTXSCN, 'scene'));
    const wxDir = path.join(root, '_wxwasm-basis');
    mkdirSync(wxDir, { recursive: true });
    writeFileSync(path.join(wxDir, 'esengine.js'), 'module.exports = () => Promise.resolve({});');
    writeFileSync(path.join(wxDir, 'esengine.wasm'), 'wasmbytes');
    writeFileSync(path.join(wxDir, 'basis.js'), 'module.exports = () => {};');
    writeFileSync(path.join(wxDir, 'basis.wasm'), 'wasmbytes');

    const outKtx = path.join(root, 'dist-wechat-ktx2');
    const res = await exportGame({
      root,
      entryScene: 'scenes/ktx2.esscene',
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
      entryScene: 'scenes/ktx2.esscene',
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
    // Scenes keep their logical path and carry no address.
    expect(manifest.groups.main.assets[SCN].address).toBeUndefined();
  }, 60_000);
});
