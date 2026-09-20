// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { breakdownOf, moduleOfInput } from '../src/export/bundleBreakdown';

/**
 * Paths exactly as esbuild spelled them for a real WeChat export. The first rule
 * read `sdk/src/` while a mini-game bundles `sdk/dist/`, so every byte landed
 * under `project` — and a one-row breakdown still looks like a breakdown, which
 * is why the shapes are pinned rather than described.
 */
const REAL_INPUTS = {
  'sdk/dist/shared/webAppFactory.js': 870_617,
  'sdk/dist/shared/system.js': 225_253,
  'sdk/dist/shared/spine.js': 95_156,
  'sdk/dist/shared/physics.js': 60_629,
  'sdk/dist/shared/dragonbones.js': 15_338,
  'sdk/dist/index.wechat.js': 2_049,
};

const metaWith = (inputs: Record<string, number>) => ({
  outputs: {
    'out/game-bundle.js': {
      inputs: Object.fromEntries(
        Object.entries(inputs).map(([k, v]) => [k, { bytesInOutput: v }]),
      ),
    },
  },
});

describe('moduleOfInput', () => {
  it('names an SDK chunk by the chunk, which is the unit a bundler can drop', () => {
    expect(moduleOfInput('sdk/dist/shared/spine.js')).toBe('spine');
    expect(moduleOfInput('sdk/dist/index.wechat.js')).toBe('index.wechat');
  });

  it('still reads a source tree, for a bundle built from one', () => {
    expect(moduleOfInput('sdk/src/tilemap/tilemapPlugin.ts')).toBe('tilemap');
    expect(moduleOfInput('sdk/src/index.ts')).toBe('core');
  });

  it('separates a dependency from the project', () => {
    expect(moduleOfInput('node_modules/@foo/bar/dist/x.js')).toBe('dep:@foo/bar');
    expect(moduleOfInput('src/game/player.ts')).toBe('project');
  });
});

describe('breakdownOf', () => {
  it('splits a real mini-game bundle into the chunks it is made of', () => {
    const rows = breakdownOf(metaWith(REAL_INPUTS), 'game-bundle.js');
    // The regression this pins: a rule that matches nothing yields one `project`
    // row holding every byte, which reads as a successful measurement.
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.every((r) => r.module === 'project')).toBe(false);
    expect(rows[0].module).toBe('webAppFactory');
    expect(rows.find((r) => r.module === 'spine')?.bytes).toBe(95_156);
  });

  it('accounts for every byte it was given', () => {
    const rows = breakdownOf(metaWith(REAL_INPUTS), 'game-bundle.js');
    const total = Object.values(REAL_INPUTS).reduce((a, b) => a + b, 0);
    expect(rows.reduce((n, r) => n + r.bytes, 0)).toBe(total);
  });

  it('leaves out an input tree-shaken to nothing, rather than calling it small', () => {
    const rows = breakdownOf(metaWith({ ...REAL_INPUTS, 'sdk/dist/shared/unused.js': 0 }), 'game-bundle.js');
    expect(rows.some((r) => r.module === 'unused')).toBe(false);
  });

  it('finds the output by suffix, since the caller cannot predict esbuild spelling', () => {
    expect(breakdownOf(metaWith(REAL_INPUTS), 'game-bundle.js')).not.toHaveLength(0);
    expect(breakdownOf(metaWith(REAL_INPUTS), 'nothing.js')).toHaveLength(0);
  });
});

/**
 * A chunk's name is one of its modules, so `shared/physics.js` reads as
 * "physics" while holding the whole directory — and once held spine too, under
 * a name that changed when spine left without a byte of it moving. The map
 * beside it says what is really in there.
 */
describe('reading a chunk through its source map', () => {
  // Laid out as the real thing, because the map's sources are relative to it:
  // `<root>/sdk/dist/shared/..` + `../../src/ai` is where the directory names are.
  const root = mkdtempSync(path.join(tmpdir(), 'dist-'));
  const dist = path.join(root, 'sdk', 'dist');
  afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

  // Two mapped spans of ten on one line: `AAAA` is (column 0, source 0), and
  // `UCAA` steps the column by ten and the source by one. A span runs to the
  // next mapping, and the last runs to the end of the line.
  mkdirSync(path.join(dist, 'shared'), { recursive: true });
  writeFileSync(path.join(dist, 'shared', 'webAppFactory.js'), 'x'.repeat(19));
  writeFileSync(path.join(dist, 'shared', 'webAppFactory.js.map'), JSON.stringify({
    version: 3,
    sources: ['../../src/ai/fsm.ts', '../../src/tilemap/paint.ts'],
    mappings: 'AAAA,UCAA',
  }));

  it('names the directories inside the chunk, not the chunk', () => {
    const rows = breakdownOf(metaWith({ 'sdk/dist/shared/webAppFactory.js': 1000 }), 'game-bundle.js', dist);
    expect(rows.map((r) => r.module).sort()).toEqual(['ai', 'tilemap']);
    expect(rows.some((r) => r.module === 'webAppFactory')).toBe(false);
  });

  it('splits the bytes that survived, not the bytes on disk', () => {
    const rows = breakdownOf(metaWith({ 'sdk/dist/shared/webAppFactory.js': 1000 }), 'game-bundle.js', dist);
    expect(rows.reduce((n, r) => n + r.bytes, 0)).toBe(1000);
    expect(rows.find((r) => r.module === 'ai')?.bytes).toBe(500);
  });

  it('falls back to the chunk when there is no map to read', () => {
    const rows = breakdownOf(metaWith({ 'sdk/dist/shared/physics.js': 60 }), 'game-bundle.js', dist);
    expect(rows[0].module).toBe('physics');
  });
});
