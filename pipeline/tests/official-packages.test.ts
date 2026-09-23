// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  `estella-plugin-*` resolves to the copy the editor ships.
 *
 * None of them is on a registry, so a project that imports one — as every doc
 * page for them says to — had nothing to resolve it from: the import failed in
 * play and in every export. The claims are that each bundle a project's scripts
 * go into finds the shipped copy, that a copy the project installed itself still
 * wins, and that a miss names what does ship.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildProjectScripts } from '../src/bundle/buildScripts';
import { buildOpenDataContext } from '../src/bundle/buildOpenData';
import { exportGame } from '../src/export/exportGame';
import { runtimeConfigOf } from '../src/project/runtimeConfig';
import { OFFICIAL_PACKAGES } from './officialPackagesDir';

let work: string;
let shipped: string;

function project(name: string, main: string): string {
  const root = path.join(work, name);
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'main.ts'), main);
  return root;
}

function fakePackage(dir: string, name: string, marker: string): void {
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name, type: 'module', exports: { '.': './src/index.ts', './extra': './src/extra.ts' },
  }));
  writeFileSync(path.join(dir, 'src', 'index.ts'),
    `import { installMiniGamePlatform } from 'esengine';\nexport const where = '${marker}';\nexport const hook = installMiniGamePlatform;\n`);
  writeFileSync(path.join(dir, 'src', 'extra.ts'), `export const extra = '${marker}-extra';\n`);
}

beforeAll(() => {
  work = mkdtempSync(path.join(tmpdir(), 'estella-official-'));
  shipped = path.join(work, 'shipped');
  fakePackage(path.join(shipped, 'fake'), 'estella-plugin-fake', 'SHIPPED_COPY');
});

afterAll(() => rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

describe('an official package in play', () => {
  it('bundles the shipped copy, with the engine left to the realm', async () => {
    const root = project('play', `import { where, hook } from 'estella-plugin-fake';\nconsole.log(where, hook);\n`);
    const res = await buildProjectScripts(root, { packagesDir: shipped });
    expect(res.errors).toEqual([]);
    const out = readFileSync(res.outputPath!, 'utf8');
    expect(out).toContain('SHIPPED_COPY');
    expect(out).toMatch(/from\s*["']esengine["']/);
  });

  it('resolves an exported subpath, and refuses one the package does not export', async () => {
    const ok = project('sub', `import { extra } from 'estella-plugin-fake/extra';\nconsole.log(extra);\n`);
    expect(readFileSync((await buildProjectScripts(ok, { packagesDir: shipped })).outputPath!, 'utf8'))
      .toContain('SHIPPED_COPY-extra');
    const bad = project('badsub', `import { x } from 'estella-plugin-fake/nope';\nconsole.log(x);\n`);
    const res = await buildProjectScripts(bad, { packagesDir: shipped });
    expect(res.errors.join('\n')).toContain('exports no "./nope"');
  });

  it('prefers the copy the project installed itself', async () => {
    const root = project('own', `import { where } from 'estella-plugin-fake';\nconsole.log(where);\n`);
    fakePackage(path.join(root, 'node_modules', 'estella-plugin-fake'), 'estella-plugin-fake', 'PROJECT_COPY');
    const out = readFileSync((await buildProjectScripts(root, { packagesDir: shipped })).outputPath!, 'utf8');
    expect(out).toContain('PROJECT_COPY');
    expect(out).not.toContain('SHIPPED_COPY');
  });

  it('names what does ship when a package is neither shipped nor installed', async () => {
    const root = project('miss', `import { x } from 'estella-plugin-nothing';\nconsole.log(x);\n`);
    const res = await buildProjectScripts(root, { packagesDir: shipped });
    expect(res.ok).toBe(false);
    expect(res.errors.join('\n')).toContain('estella-plugin-fake');
  });

  it('bundles the real minigame services, main entry and friends board', async () => {
    const root = project('real', `import { Recorder, miniGameServicesPlugin } from 'estella-plugin-minigame-services';\nconsole.log(Recorder, miniGameServicesPlugin);\n`);
    const res = await buildProjectScripts(root, { packagesDir: OFFICIAL_PACKAGES });
    expect(res.errors).toEqual([]);
    expect(readFileSync(res.outputPath!, 'utf8')).toContain('RecorderAPI');

    mkdirSync(path.join(root, 'open-data'), { recursive: true });
    writeFileSync(path.join(root, 'open-data', 'index.ts'),
      `import 'estella-plugin-minigame-services/open-data';\n`);
    const ctx = await buildOpenDataContext(root, { packagesDir: OFFICIAL_PACKAGES });
    expect(ctx.errors).toEqual([]);
    // A side-effect import is the whole entry; one that bundled to nothing
    // would still report no errors.
    expect(readFileSync(ctx.outputPath!, 'utf8')).toContain('onMessage');
  });
});

describe('an official package in an export', () => {
  const fixture = (name: string): string => {
    const root = project(name, `import { where } from 'estella-plugin-fake';\nconsole.log(where);\n`);
    mkdirSync(path.join(root, 'scenes'), { recursive: true });
    writeFileSync(path.join(root, 'scenes', 'main.esscene'), JSON.stringify({ version: '1.0', name: 'Main', entities: [] }));
    writeFileSync(path.join(root, 'scenes', 'main.esscene.meta'),
      JSON.stringify({ uuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', version: '2.0', type: 'scene', importer: {} }));
    mkdirSync(path.join(root, '_sdk', 'douyin'), { recursive: true });
    writeFileSync(path.join(root, '_sdk', 'index.minigame.js'),
      'export function initMiniGameRuntime(){return Promise.resolve();}\nexport function installMiniGamePlatform(){}\n');
    writeFileSync(path.join(root, '_sdk', 'douyin', 'index.js'), 'export const douyinProfile = { id: "douyin" };\n');
    mkdirSync(path.join(root, '_wasm'), { recursive: true });
    writeFileSync(path.join(root, '_wasm', 'esengine.wxgame.js'), 'module.exports = () => Promise.resolve({});');
    writeFileSync(path.join(root, '_wasm', 'esengine.wxgame.wasm'), 'wasm');
    return root;
  };

  it('inlines the shipped copy into a mini-game package', async () => {
    const root = fixture('douyin');
    const out = path.join(root, 'dist');
    const res = await exportGame({
      root, entryScene: 'scenes/main.esscene', scriptsEntry: 'src/main.ts',
      hostsDir: path.resolve(__dirname, '../src/runtime'), packagesDir: shipped,
      sdkDistDir: path.join(root, '_sdk'), wasmDir: path.join(root, '_wasm'), outDir: out,
      platform: 'douyin', miniGameAppid: 'tt0123456789abcdef',
      runtime: runtimeConfigOf({ designResolution: { width: 1280, height: 720 } }),
    });
    expect(res.ok, res.errors.join('\n')).toBe(true);
    expect(readFileSync(path.join(out, 'game-bundle.js'), 'utf8')).toContain('SHIPPED_COPY');
  });
});
