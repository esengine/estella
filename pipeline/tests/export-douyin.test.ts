// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Douyin MiniGame export — that a second vendor needed no second pipeline.
 *        Asserts the four things that are Douyin's and not WeChat's: the config
 *        file it writes, the host it names, the entry that installs a platform
 *        rather than assuming one, and the caps it is judged against.
 *        (Boot correctness is a device's to answer — see RM-032.)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runtimeConfigOf } from '../src/project/runtimeConfig';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportGame } from '../src/export/exportGame';
import { builtinSizeBudgets } from '../src/project/sizeBudget';

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
    'export function initMiniGameRuntime(){return Promise.resolve();}\n'
    + 'export function installMiniGamePlatform(){}\n');
  mkdirSync(path.join(root, '_sdk', 'douyin'), { recursive: true });
  writeFileSync(path.join(root, '_sdk', 'douyin', 'index.js'),
    'export const douyinProfile = { id: "douyin", hostLabel: "\\u6296\\u97f3" };\n');
  // The web engine artifact: Douyin has no build of its own.
  mkdirSync(path.join(root, '_wasm'), { recursive: true });
  writeFileSync(path.join(root, '_wasm', 'esengine.js'), 'module.exports = () => Promise.resolve({});');
  writeFileSync(path.join(root, '_wasm', 'esengine.wasm'), 'wasmbytes');

  out = path.join(root, 'dist-douyin');
}, 60_000);

afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

describe('exportGame (douyin)', () => {
  it('writes the vendor config Douyin reads, not the one WeChat reads', async () => {
    const res = await exportGame({
      root,
      entryScene: 'scenes/main.esscene',
      hostsDir: path.resolve(__dirname, '../src/runtime'),
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

    // The vendor's contract, not this exporter's habit: Douyin's own CLI and its
    // Godot adaptation doc both name `project.config.json`, and nothing
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
  }, 180_000);

  it('boots through the vendor-neutral entry and names its host', () => {
    // The whole point of the family: Douyin ships no SDK entry of its own, so the
    // bundle must carry index.minigame AND the profile that names `tt` — either
    // one alone is a package that boots into no host at all.
    const bundle = readFileSync(path.join(out, 'game-bundle.js'), 'utf8');
    expect(bundle).toContain('index.minigame.js');
    expect(bundle).toContain('installMiniGamePlatform');
    expect(bundle).toContain('douyin');
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
