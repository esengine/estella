// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Douyin MiniGame export — that a second vendor needed no second pipeline.
 *        Asserts the four things that are Douyin's and not WeChat's: the config
 *        file it writes, the host it names, the entry that installs a platform
 *        rather than assuming one, and the caps it is judged against — plus the
 *        one thing it shares with WeChat and got wrong: which engine build a
 *        mini-game host can load at all.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runtimeConfigOf } from '../src/project/runtimeConfig';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import path from 'node:path';
import { exportGame } from '../src/export/exportGame';
import { builtinSizeBudgets } from '../src/project/sizeBudget';
import { engineBuildFor } from '../src/project/platforms';
import { douyinExportProfile } from '../src/export/miniGameExportProfile';
import { OFFICIAL_PACKAGES } from './officialPackagesDir';

let root: string;
let out: string;
const TEX = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SCN = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const meta = (uuid: string, type: string) => JSON.stringify({ uuid, version: '2.0', type, importer: {} });

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-export-douyin-'));
  mkdirSync(path.join(root, 'assets'), { recursive: true });
  writeFileSync(path.join(root, 'assets', 'hero.png'), 'PNGDATA');
  writeFileSync(path.join(root, 'assets', 'hero.png.meta'), meta(TEX, 'texture'));
  mkdirSync(path.join(root, 'scenes'), { recursive: true });
  writeFileSync(
    path.join(root, 'scenes', 'main.esscene'),
    JSON.stringify({ version: '1.0', name: 'Main', entities: [{ id: 0, components: [{ type: 'Sprite', data: { texture: `@uuid:${TEX}` } }] }] }),
  );
  writeFileSync(path.join(root, 'scenes', 'main.esscene.meta'), meta(SCN, 'scene'));
  // Douyin bundles the vendor-neutral entry, so the stub is that one — a stub of
  // index.wechat.js would still satisfy a test that only counted files.
  mkdirSync(path.join(root, '_sdk'), { recursive: true });
  writeFileSync(path.join(root, '_sdk', 'index.minigame.js'),
    'let platform;\n'
    + 'export function installMiniGamePlatform(p){ platform=p; globalThis.trace.push("host:"+p.id); }\n'
    + 'export function getPlatform(){ if (!platform) throw Error("platform not installed"); return platform; }\n'
    + 'export function captureProjectRegistrations(){ globalThis.trace.push("capture"); return {build(){ globalThis.trace.push("install"); }}; }\n'
    + 'export function initMiniGameRuntime(config){ config.projectPlugin.build(); globalThis.trace.push("runtime"); return Promise.resolve(); }\n');
  writeFileSync(path.join(root, 'player.ts'),
    'import { getPlatform } from "esengine";\n'
    + 'globalThis.trace.push("project:"+getPlatform().id);\n'
    + 'if (globalThis.failProject) throw Error("project startup failed");\n');
  mkdirSync(path.join(root, '_sdk', 'douyin'), { recursive: true });
  writeFileSync(path.join(root, '_sdk', 'douyin', 'index.js'),
    'export const douyinProfile = { id: "douyin", hostLabel: "\\u6296\\u97f3" };\n');
  // The MINI-GAME engine artifact, under the name that build emits: Douyin has
  // no build of its own and cannot take the browser one, which is an ES module.
  mkdirSync(path.join(root, '_wasm'), { recursive: true });
  writeFileSync(path.join(root, '_wasm', 'esengine.wxgame.js'), 'module.exports = () => Promise.resolve({});');
  writeFileSync(path.join(root, '_wasm', 'esengine.wxgame.wasm'), 'wasmbytes');

  out = path.join(root, 'dist-douyin');
}, 60_000);

afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

describe('exportGame (douyin)', () => {
  beforeAll(async () => {
    const res = await exportGame({
      minifyScripts: false,
      root,
      entryScene: 'scenes/main.esscene',
      scriptsEntry: 'player.ts',
      hostsDir: path.resolve(__dirname, '../src/runtime'), packagesDir: OFFICIAL_PACKAGES,
      sdkDistDir: path.join(root, '_sdk'),
      wasmDir: path.join(root, '_wasm'),
      outDir: out,
      title: 'My Game',
      platform: 'douyin',
      orientation: 'landscape',
      runtime: runtimeConfigOf({ designResolution: { width: 1280, height: 720 } }),
      miniGameAppid: 'tt0123456789abcdef',
    });

    expect(res.ok, res.errors.join('\n')).toBe(true);
    expect(res.platform).toBe('douyin');
  }, 180_000);

  it('writes the vendor config Douyin reads, not the one WeChat reads', () => {
    // The vendor's contract, not this exporter's habit: Douyin's own CLI and its
    // adaptation doc both name `project.config.json`, and nothing
    // published names `project.tt.json`.
    expect(existsSync(path.join(out, 'project.config.json'))).toBe(true);
    expect(existsSync(path.join(out, 'project.tt.json'))).toBe(false);
    const cfg = JSON.parse(readFileSync(path.join(out, 'project.config.json'), 'utf8'));
    expect(cfg.compileType).toBe('game');
    expect(cfg.miniprogramRoot).toBe('./');
    expect(JSON.parse(readFileSync(path.join(out, 'game.json'), 'utf8')).deviceOrientation).toBe('landscape');
    // This vendor's id, not the other one's: a WeChat appid in a Douyin package
    // is refused at upload with "不存在此 AppID".
    expect(cfg.appid).toBe('tt0123456789abcdef');
  });

  it('boots through the vendor-neutral entry and names its host', () => {
    // The whole point of the family: Douyin ships no SDK entry of its own, so the
    // bundle must carry index.minigame AND the profile that names `tt` — either
    // one alone is a package that boots into no host at all.
    const bundle = readFileSync(path.join(out, 'game-bundle.js'), 'utf8');
    expect(bundle).toContain('index.minigame.js');
    expect(bundle).toContain('installMiniGamePlatform');
    expect(bundle).toContain('douyin');
  });

  it('runs the bundled project after host installation and before runtime startup', async () => {
    const bundle = readFileSync(path.join(out, 'game-bundle.js'), 'utf8');
    for (const failProject of [false, true]) {
      const trace: string[] = [];
      const module = { exports: {} as { boot: () => Promise<void> } };
      runInNewContext(bundle, { module, trace, failProject });
      expect(trace).toEqual([]);
      if (failProject) {
        await expect(module.exports.boot()).rejects.toThrow('project startup failed');
        expect(trace).toEqual(['host:douyin', 'project:douyin']);
        await expect(module.exports.boot()).rejects.toThrow('project startup failed');
        expect(trace).toEqual(['host:douyin', 'project:douyin']);
      } else {
        await Promise.all([module.exports.boot(), module.exports.boot()]);
        expect(trace).toEqual(['host:douyin', 'project:douyin', 'capture', 'install', 'runtime', 'install', 'runtime']);
      }
    }
  });

  it('requires the mini-game engine build, which is the one a `tt` host can load', () => {
    // Douyin shipped the browser artifact for its first two versions: the package
    // built clean, installed, and died on `require` with `Unexpected token
    // 'export'` before the first frame. The entry names what it got.
    expect(readFileSync(path.join(out, 'game.js'), 'utf8'))
      .toContain("require('./wasm/esengine.wxgame.js')");
  });

  it('refuses to package an ES module engine rather than shipping a dead one', async () => {
    const esmRoot = path.join(root, '_esm-wasm');
    mkdirSync(esmRoot, { recursive: true });
    // The browser artifact, by the shape that makes it one — under the name a
    // hand-assembled vendor dir tends to use, so only the CONTENT can catch it.
    writeFileSync(path.join(esmRoot, 'esengine.js'), 'const M = () => {};\nexport default M;\n');
    writeFileSync(path.join(esmRoot, 'esengine.wasm'), 'wasmbytes');
    const res = await exportGame({
      minifyScripts: false,
      root,
      entryScene: 'scenes/main.esscene',
      hostsDir: path.resolve(__dirname, '../src/runtime'), packagesDir: OFFICIAL_PACKAGES,
      sdkDistDir: path.join(root, '_sdk'),
      wasmDir: esmRoot,
      outDir: path.join(root, 'dist-douyin-esm'),
      title: 'My Game',
      platform: 'douyin',
      orientation: 'landscape',
      runtime: runtimeConfigOf({ designResolution: { width: 1280, height: 720 } }),
    });
    expect(res.ok).toBe(false);
    expect(res.errors.join('\n')).toContain('is an ES module');
    // And it says what to run, since the fix is a build and not a setting.
    // The mini-game engine without wasm SIMD: Douyin's iOS host refuses SIMD.
    expect(res.errors.join('\n')).toContain('build -t quickgame');
  }, 180_000);

  it('says it is starting BEFORE it parses a megabyte of game code', () => {
    // The runtime's own indicator cannot cover this wait: it only appears once
    // the bundle it is waiting for has been required.
    const entry = readFileSync(path.join(out, 'game.js'), 'utf8');
    const notice = entry.indexOf('showLoading');
    const bundle = entry.indexOf("require('./game-bundle.js')");
    expect(notice).toBeGreaterThan(-1);
    expect(notice).toBeLessThan(bundle);
    // …and it must not be the thing that takes a boot down.
    expect(entry).toContain('try {');
  });

  it('is judged against Douyin\'s caps, which are not WeChat\'s', () => {
    const budgets = builtinSizeBudgets('douyin');
    const total = budgets.find((b) => b.scope === 'total');
    const initial = budgets.find((b) => b.scope === 'initial');
    expect(initial?.maxBytes).toBe(4 * 1024 * 1024);
    // 20MB, not WeChat's 30: a package that fits WeChat can still be over here,
    // which is the failure this number exists to catch.
    expect(total?.maxBytes).toBe(20 * 1024 * 1024);
    expect(total?.note).toContain('Douyin');
  });
});

describe('exportGame (douyin) — the engine compressed and in a subpackage', () => {
  // TTWebAssembly takes a `.wasm.br` path and tt.loadSubpackage a `subPackages` root: the two switches WeChat had, on the
  // host whose documentation names both.
  it('ships the engine as .wasm.br in a subpackage game.json declares, and boots from that name', async () => {
    const o = path.join(root, 'dist-douyin-br');
    const res = await exportGame({
      minifyScripts: false, root, entryScene: 'scenes/main.esscene', scriptsEntry: 'player.ts',
      hostsDir: path.resolve(__dirname, '../src/runtime'), packagesDir: OFFICIAL_PACKAGES,
      sdkDistDir: path.join(root, '_sdk'), wasmDir: path.join(root, '_wasm'), outDir: o,
      platform: 'douyin', compressWasm: true, engineSubpackage: true,
      runtime: runtimeConfigOf({ designResolution: { width: 1280, height: 720 } }),
    });
    expect(res.ok, res.errors.join('\n')).toBe(true);

    const files = (readdirSync(o, { recursive: true }) as string[]).map((f) => f.split(path.sep).join('/'));
    const engine = files.filter((f) => f.endsWith('esengine.wxgame.wasm.br'));
    expect(engine).toHaveLength(1);
    expect(files.some((f) => f.endsWith('esengine.wxgame.wasm'))).toBe(false);

    const subPackages = JSON.parse(readFileSync(path.join(o, 'game.json'), 'utf8')).subPackages as { name: string; root: string }[];
    const home = subPackages.find((s) => engine[0].startsWith(`${s.root}/`));
    expect(home, `${engine[0]} is in no declared subpackage`).toBeTruthy();
    expect(existsSync(path.join(o, home!.root, 'game.js'))).toBe(true);
    expect(readFileSync(path.join(o, 'game-bundle.js'), 'utf8')).toContain(engine[0]);
  }, 180_000);
});

describe('Douyin ships the mini-game runtime without wasm SIMD', () => {
  // 「iOS 平台目前不支持 SIMD 等 WebAssembly 提案特性」, and one package runs on both phones: a SIMD opcode in the engine or in
  // any side module is a game that never starts on an iPhone.
  it('takes the engine and every side module from the build without it', () => {
    expect(engineBuildFor('douyin')).toBe('quickgame');
    expect(douyinExportProfile.wasmBuildHint).toBe('quickgame');
    const targets = Object.values(douyinExportProfile.sideModuleBuildTargets);
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) expect(t).toMatch(/-quickgame$/);
  });
});
