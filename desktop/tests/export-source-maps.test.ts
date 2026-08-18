// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Whether a web package carries source maps. One answer covers the
 *        bundles the export writes and the SDK tree it copies beside them.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportGame } from '../../pipeline/src/export/exportGame';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME_HOST = path.join(HERE, '..', '..', 'pipeline', 'src', 'runtime', 'gameHost.ts');

const SCN = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const meta = (uuid: string, type: string) => JSON.stringify({ uuid, version: '2.0', type, importer: {} });

function setup(): { root: string; out: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'estella-srcmap-'));
  mkdirSync(path.join(root, 'scenes'), { recursive: true });
  writeFileSync(path.join(root, 'scenes', 'main.esscene'),
    JSON.stringify({ version: '1.0', name: 'Main', entities: [{ id: 0, components: [] }] }));
  writeFileSync(path.join(root, 'scenes', 'main.esscene.meta'), meta(SCN, 'scene'));

  mkdirSync(path.join(root, '_sdk', 'shared'), { recursive: true });
  // Exactly how the SDK build writes them: the script names its map on the last
  // line, and the map sits beside it.
  writeFileSync(path.join(root, '_sdk', 'index.js'), 'export const x = 1;\n//# sourceMappingURL=index.js.map\n');
  writeFileSync(path.join(root, '_sdk', 'index.js.map'), '{"version":3}');
  writeFileSync(path.join(root, '_sdk', 'shared', 'resource.js'), 'export const r = 1;\n//# sourceMappingURL=resource.js.map');
  writeFileSync(path.join(root, '_sdk', 'shared', 'resource.js.map'), '{"version":3}');

  mkdirSync(path.join(root, '_wasm'), { recursive: true });
  writeFileSync(path.join(root, '_wasm', 'esengine.js'), 'export default () => {};');
  writeFileSync(path.join(root, '_wasm', 'esengine.wasm'), 'ENGINE');
  return { root, out: path.join(root, 'dist') };
}

const run = (f: { root: string; out: string }, sourcemap?: boolean) => exportGame({
  root: f.root, entryScene: 'scenes/main.esscene', gameHostEntry: GAME_HOST,
  sdkDistDir: path.join(f.root, '_sdk'), wasmDir: path.join(f.root, '_wasm'),
  outDir: f.out, ...(sourcemap === undefined ? {} : { sourcemap }),
});

describe('source maps in a web package', () => {
  it('ships none by default, and leaves no script asking for one', async () => {
    const f = setup();
    try {
      const res = await run(f);
      expect(res.errors).toEqual([]);
      expect(existsSync(path.join(f.out, 'sdk', 'index.js.map'))).toBe(false);
      expect(existsSync(path.join(f.out, 'sdk', 'shared', 'resource.js.map'))).toBe(false);
      // A dangling reference is a 404 the moment anyone opens devtools on the
      // shipped game, so the copy drops the line as well as the file.
      for (const rel of ['sdk/index.js', 'sdk/shared/resource.js']) {
        expect([rel, readFileSync(path.join(f.out, rel), 'utf8')]).toEqual([rel, expect.not.stringContaining('sourceMappingURL')]);
      }
      // Stripping the comment is all it does to the script.
      expect(readFileSync(path.join(f.out, 'sdk', 'index.js'), 'utf8')).toContain('export const x = 1;');
      expect(existsSync(path.join(f.out, 'game.js.map'))).toBe(false);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, 60_000);

  it('ships them when the build asks for them', async () => {
    const f = setup();
    try {
      const res = await run(f, true);
      expect(res.errors).toEqual([]);
      expect(existsSync(path.join(f.out, 'sdk', 'index.js.map'))).toBe(true);
      expect(existsSync(path.join(f.out, 'sdk', 'shared', 'resource.js.map'))).toBe(true);
      expect(readFileSync(path.join(f.out, 'sdk', 'index.js'), 'utf8')).toContain('sourceMappingURL');
      // The export's own bundles answer the same question the same way.
      expect(existsSync(path.join(f.out, 'game.js.map'))).toBe(true);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, 60_000);
});
