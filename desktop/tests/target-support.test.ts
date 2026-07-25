// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a build target cannot render, and the export saying so.
 *
 * The native app compiles a subset of the engine, so a project can author
 * content that will not appear on the device. Two things are asserted: that the
 * scan sees the authored vocabulary (scenes, prefabs, nested entities), and that
 * the declared native gaps still match `native/CMakeLists.txt` — the build file
 * is the truth about which sources are compiled, and flipping a flag there is
 * what deletes an entry from the table.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectSubsystems, subsystemGapWarnings, targetGaps, SUBSYSTEM_CMAKE_FLAG, type Subsystem,
} from '../src/project/targetSupport';
import { exportGame } from '../electron/exportGame';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const GAME_HOST = path.join(HERE, '..', 'src', 'gameHost.ts');

describe('collectSubsystems', () => {
  it('sees components wherever they sit in the document', () => {
    const scene = {
      version: '1.0',
      entities: [
        { id: 0, components: [{ type: 'Transform' }, { type: 'Sprite' }] },
        { id: 1, components: [{ type: 'TilemapLayer', data: { tileset: '@uuid:x' } }] },
        { id: 2, children: [{ id: 3, components: [{ type: 'Text', data: { text: 'hi' } }] }] },
      ],
    };
    expect([...collectSubsystems(scene)].sort()).toEqual(['text', 'tilemap']);
  });

  it('sees a prefab body and its physics vocabulary', () => {
    const prefab = { version: '1.0', root: { components: [{ type: 'RigidBody' }, { type: 'BoxCollider' }] } };
    expect([...collectSubsystems(prefab)]).toEqual(['physics']);
  });

  it('says nothing about a project that only uses what every target has', () => {
    const scene = { entities: [{ components: [{ type: 'Sprite' }, { type: 'Light2D' }, { type: 'TrailRenderer' }] }] };
    expect(collectSubsystems(scene).size).toBe(0);
  });

  it('ignores non-component `type` fields', () => {
    expect(collectSubsystems({ importer: { type: 'texture' }, asset: { type: 'scene' } }).size).toBe(0);
  });
});

describe('subsystemGapWarnings', () => {
  const usage = new Map<Subsystem, string[]>([['tilemap', ['scenes/b.esscene', 'scenes/a.esscene']]]);

  it('names the subsystem, the reason and the files', () => {
    const [warning, ...rest] = subsystemGapWarnings('native', usage);
    expect(rest).toEqual([]);
    expect(warning).toContain('Tilemaps will not render');
    expect(warning).toContain('scenes/a.esscene, scenes/b.esscene');
  });

  it('is silent for a target with no known gaps', () => {
    expect(subsystemGapWarnings('web', usage)).toEqual([]);
  });

  it('is silent about a gap the content does not use', () => {
    expect(subsystemGapWarnings('native', new Map())).toEqual([]);
  });
});

describe('the native gaps match the native build', () => {
  const cmake = readFileSync(path.join(REPO, 'native', 'CMakeLists.txt'), 'utf8');
  const enabled = new Set([...cmake.matchAll(/set\(\s*(ES_ENABLE_\w+)\s+ON\s*\)/g)].map((m) => m[1]));
  const gaps = new Set(targetGaps('native').map((g) => g.subsystem));

  it.each(Object.entries(SUBSYSTEM_CMAKE_FLAG) as [Subsystem, string][])(
    '%s: a source set the native build omits is declared unsupported', (subsystem, flag) => {
      if (!enabled.has(flag)) expect(gaps).toContain(subsystem);
    },
  );

  it.each(Object.keys(SUBSYSTEM_CMAKE_FLAG) as Subsystem[])(
    '%s: a source set the native build compiles is not declared unsupported', (subsystem) => {
      if (enabled.has(SUBSYSTEM_CMAKE_FLAG[subsystem]!)) expect(gaps).not.toContain(subsystem);
    },
  );
});

describe('exportGame warns about content the target cannot render', () => {
  let root: string;
  const TEX = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const SCN = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const meta = (uuid: string, type: string) => JSON.stringify({ uuid, version: '2.0', type, importer: {} });

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'estella-target-support-'));
    mkdirSync(path.join(root, 'assets'), { recursive: true });
    copyFileSync(path.join(REPO, 'examples', 'hello-world', 'assets', 'textures', 'logo.png'), path.join(root, 'assets', 'hero.png'));
    writeFileSync(path.join(root, 'assets', 'hero.png.meta'), meta(TEX, 'texture'));
    mkdirSync(path.join(root, 'scenes'), { recursive: true });
    writeFileSync(path.join(root, 'scenes', 'main.esscene'), JSON.stringify({
      version: '1.0', name: 'Main',
      entities: [
        { id: 0, components: [{ type: 'Sprite', data: { texture: `@uuid:${TEX}` } }] },
        { id: 1, components: [{ type: 'Text', data: { text: 'score' } }] },
        { id: 2, components: [{ type: 'ParticleEmitter', data: {} }] },
        { id: 3, components: [{ type: 'TilemapLayer', data: {} }] },
      ],
    }));
    writeFileSync(path.join(root, 'scenes', 'main.esscene.meta'), meta(SCN, 'scene'));
    mkdirSync(path.join(root, '_sdk'), { recursive: true });
    writeFileSync(path.join(root, '_sdk', 'index.js'), 'export const x = 1;');
    mkdirSync(path.join(root, '_wasm'), { recursive: true });
    writeFileSync(path.join(root, '_wasm', 'esengine.js'), 'export default () => {};');
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const run = (platform: 'native' | 'web', outDir: string) => exportGame({
    root, entryScene: 'scenes/main.esscene', gameHostEntry: GAME_HOST,
    sdkDistDir: path.join(root, '_sdk'), wasmDir: path.join(root, '_wasm'),
    outDir, platform, title: 'Game',
  });

  it('names every unsupported subsystem the scene uses — and ships anyway', async () => {
    const res = await run('native', path.join(root, 'dist-native'));
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
    const gaps = res.warnings.filter((w) => w.startsWith('native:'));
    expect(gaps).toHaveLength(2);
    expect(gaps.join('\n')).toContain('Particles will not render');
    expect(gaps.join('\n')).toContain('Tilemaps will not render');
    expect(gaps.join('\n')).toContain('scenes/main.esscene');
    // Text renders on the native core (the host rasterizes glyphs), so the scene's
    // label is not warned about — the gaps are what the build really cannot do.
    expect(gaps.join('\n')).not.toContain('Text will not render');
  }, 60_000);

  it('stays quiet for a target that renders all of it', async () => {
    const res = await run('web', path.join(root, 'dist-web'));
    expect(res.warnings.filter((w) => w.includes('will not render'))).toEqual([]);
  }, 60_000);
});
