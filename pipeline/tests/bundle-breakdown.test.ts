// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
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
