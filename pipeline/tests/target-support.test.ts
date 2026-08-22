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
import { exportGame } from '../src/export/exportGame';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const GAME_HOST = path.join(HERE, '..', '..', 'pipeline', 'src', 'runtime', 'gameHost.ts');

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
  const usage = new Map<Subsystem, string[]>([['spine', ['scenes/b.esscene', 'scenes/a.esscene']]]);

  it('names the subsystem, the reason and the files', () => {
    // Driven through a declared gap rather than a real one: every subsystem is
    // supported on every target today, and the reporting still has to work for the
    // day one is not (a flag turned off, a new platform-bound feature).
    const declared = [{ subsystem: 'spine' as Subsystem, why: 'a made-up gap, for this test' }];
    const [warning, ...rest] = subsystemGapWarnings('android', usage, declared);
    expect(rest).toEqual([]);
    expect(warning).toContain('Spine animation will not render');
    expect(warning).toContain('a made-up gap, for this test');
    expect(warning).toContain('scenes/a.esscene, scenes/b.esscene');
  });

  it('is silent about a gap the content does not use', () => {
    const declared = [{ subsystem: 'spine' as Subsystem, why: 'a made-up gap' }];
    expect(subsystemGapWarnings('android', new Map(), declared)).toEqual([]);
  });

  it('says nothing at all now that every target compiles every subsystem', () => {
    expect(subsystemGapWarnings('android', usage)).toEqual([]);
    expect(subsystemGapWarnings('web', usage)).toEqual([]);
  });

  it('reports the same gaps for both native targets — they compile one CMakeLists', () => {
    expect(targetGaps('ios')).toEqual(targetGaps('android'));
  });
});

describe('the native gaps match the native build', () => {
  const cmake = readFileSync(path.join(REPO, 'native', 'CMakeLists.txt'), 'utf8');
  const enabled = new Set([...cmake.matchAll(/set\(\s*(ES_ENABLE_\w+)\s+ON\s*\)/g)].map((m) => m[1]));
  const gaps = new Set(targetGaps('android').map((g) => g.subsystem));

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
        { id: 4, components: [{ type: 'RigidBody', data: {} }] },
        { id: 5, components: [{ type: 'SpineAnimation', data: {} }] },
      ],
    }));
    writeFileSync(path.join(root, 'scenes', 'main.esscene.meta'), meta(SCN, 'scene'));
    mkdirSync(path.join(root, '_sdk'), { recursive: true });
    writeFileSync(path.join(root, '_sdk', 'index.js'), 'export const x = 1;');
    mkdirSync(path.join(root, '_wasm'), { recursive: true });
    writeFileSync(path.join(root, '_wasm', 'esengine.js'), 'export default () => {};');
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const run = (platform: 'android' | 'web', outDir: string) => exportGame({
    root, entryScene: 'scenes/main.esscene', gameHostEntry: GAME_HOST,
    sdkDistDir: path.join(root, '_sdk'), wasmDir: path.join(root, '_wasm'),
    outDir, platform, title: 'Game',
  });

  it('warns about nothing: the native build renders everything this scene uses', async () => {
    // The scene deliberately authors every optional subsystem — text, particles,
    // tilemaps, physics and spine — and the native app compiles all of them now, so
    // any warning here would be false. The reporting mechanism itself is covered
    // above, against a declared gap.
    const res = await run('android', path.join(root, 'dist-android'));
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
    const gaps = res.warnings.filter((w) => w.startsWith('android:'));
    expect(gaps).toEqual([]);
  }, 60_000);

  it('stays quiet for a target that renders all of it', async () => {
    const res = await run('web', path.join(root, 'dist-web'));
    expect(res.warnings.filter((w) => w.includes('will not render'))).toEqual([]);
  }, 60_000);
});
