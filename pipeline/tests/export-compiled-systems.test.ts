// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a package carries for the systems a project marked `@compiled`.
 *
 * @details `build-compiled-systems.test.ts` proves the compile; this proves the
 *          EXPORT — that the module is staged where the runtime looks and named
 *          in `game.config.json`, because a module nothing points at is a module
 *          nothing loads, and the game would interpret with no sign anything
 *          went wrong (docs/REARCH_AOT.md §9).
 *
 *          Stub sdk/wasm trees, like the other export tests: what is under test
 *          is the package's shape, not the engine in it.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PackagedGameConfig } from 'esengine';
import { exportGame } from '../src/export/exportGame';
import { resolveEmcc } from '../src/bundle/emccPath';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME_HOST = path.join(HERE, '..', 'src', 'runtime', 'gameHost.ts');
const SCN = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const EMCC = resolveEmcc();

/** A system the subset lowers, and its author says so. */
const PROMISED = `import { defineComponent, defineSystem, Query, Mut } from 'esengine';

export const Drift = defineComponent('ExportDrift', { x: 0, step: 0.5 });

/**
 * @compiled
 */
export const driftSystem = defineSystem(
    [Query(Mut(Drift))],
    (query) => {
        for (const [, drift] of query) {
            drift.x += drift.step;
        }
    },
    { name: 'ExportDriftSystem' },
);
`;

/** The same promise over something the subset refuses: a call it cannot lower. */
const BROKEN = PROMISED.replace('drift.x += drift.step;', 'drift.x += Math.random();');

/** A project with no marker at all — the state every project starts in. */
const UNMARKED = PROMISED.replace(/\n \* @compiled\n/, '\n');

/** A mini-game package needs the vendor SDK entry and its own glue staged. */
function miniGameStubs(root: string): void {
  // The names the fixture project imports: a stub entry missing one fails the
  // bundle, and the bundle is what carries the boot call under test.
  writeFileSync(path.join(root, '_sdk', 'index.wechat.js'),
    'export function initWeChatRuntime(){return Promise.resolve();}\n'
    + 'export const defineComponent = () => {};\nexport const defineSystem = () => {};\n'
    + 'export const Query = () => {};\nexport const Mut = () => {};\n');
  writeFileSync(path.join(root, '_wasm', 'esengine.wxgame.js'), 'module.exports = () => Promise.resolve({});');
  writeFileSync(path.join(root, '_wasm', 'esengine.wxgame.wasm'), 'wasmbytes');
}

function project(source: string | null): { root: string; out: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'estella-aot-export-'));
  mkdirSync(path.join(root, 'scenes'), { recursive: true });
  writeFileSync(path.join(root, 'scenes', 'main.esscene'), JSON.stringify({
    version: '1.0', name: 'Main', entities: [{ id: 0, components: [{ type: 'Sprite', data: {} }] }],
  }));
  writeFileSync(path.join(root, 'scenes', 'main.esscene.meta'),
    JSON.stringify({ uuid: SCN, version: '2.0', type: 'scene', importer: {} }));

  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'main.ts'), source ?? 'export {};\n');

  mkdirSync(path.join(root, '_sdk'), { recursive: true });
  writeFileSync(path.join(root, '_sdk', 'index.js'), 'export const x = 1;');
  mkdirSync(path.join(root, '_wasm'), { recursive: true });
  writeFileSync(path.join(root, '_wasm', 'esengine.js'), 'export default () => {};');
  writeFileSync(path.join(root, '_wasm', 'esengine.wasm'), 'ENGINE');
  writeFileSync(path.join(root, '_wasm', 'wasm.manifest.json'), JSON.stringify({ schema: 1 }));
  return { root, out: path.join(root, 'dist') };
}

const run = (f: { root: string; out: string }) => exportGame({
  root: f.root, entryScene: 'scenes/main.esscene', gameHostEntry: GAME_HOST,
  scriptsEntry: 'src/main.ts',
  sdkDistDir: path.join(f.root, '_sdk'), wasmDir: path.join(f.root, '_wasm'),
  outDir: f.out,
});

const config = (out: string): PackagedGameConfig =>
  JSON.parse(readFileSync(path.join(out, 'game.config.json'), 'utf8')) as PackagedGameConfig;

const runWeChat = (f: { root: string; out: string }) => exportGame({
  root: f.root, entryScene: 'scenes/main.esscene', gameHostEntry: 'unused-for-wechat',
  scriptsEntry: 'src/main.ts', platform: 'wechat', wechatAppid: 'wxTEST0123456789',
  sdkDistDir: path.join(f.root, '_sdk'), wasmDir: path.join(f.root, '_wasm'),
  outDir: f.out,
});

describe('what a package carries for a compiled system', () => {
  it('reports whether this gate could run at all', () => {
    if (EMCC) console.log(`[aot-export] emcc at ${EMCC}`);
    else console.warn('[aot-export] NO EMSDK — the staged module was NOT built (pnpm emsdk:setup).');
    expect(true).toBe(true);
  });

  it.skipIf(!EMCC)('stages the module and names it in the config', async () => {
    const f = project(PROMISED);
    try {
      const res = await run(f);
      expect(res.errors).toEqual([]);
      const cfg = config(f.out);
      expect(cfg.aot?.module).toBe('aot/systems.wasm');
      // The path in the config is the path in the package, or the runtime 404s
      // at boot and falls back to interpreting with nothing to see.
      expect(existsSync(path.join(f.out, cfg.aot!.module))).toBe(true);
      expect(cfg.aot?.manifest.systems.map((s) => s.name)).toEqual(['ExportDriftSystem']);
      expect(cfg.aot?.manifest.engineAbi).toMatch(/^[0-9a-f]{16}$/);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, 120_000);

  it.skipIf(!EMCC)('fails the export when a promise cannot be kept, and says where', async () => {
    const f = project(BROKEN);
    try {
      const res = await run(f);
      expect(res.ok).toBe(false);
      expect(res.errors.join('\n')).toMatch(/main\.ts:\d+:.*ExportDriftSystem is @compiled/);
      expect(existsSync(path.join(f.out, 'aot', 'systems.wasm'))).toBe(false);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, 120_000);

  it.skipIf(!EMCC)('a mini-game carries it too, and boots from the path', async () => {
    const f = project(PROMISED);
    miniGameStubs(f.root);
    try {
      const res = await runWeChat(f);
      expect(res.errors).toEqual([]);
      expect(existsSync(path.join(f.out, 'aot', 'systems.wasm'))).toBe(true);
      // A mini-game has no game.config.json — its configuration IS the generated
      // boot call, and WXWebAssembly takes the PATH, never the bytes.
      const boot = readFileSync(path.join(f.out, 'game-bundle.js'), 'utf8');
      expect(boot).toContain('aot/systems.wasm');
      expect(boot).toContain('ExportDriftSystem');
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, 120_000);

  it('carries nothing for a project that promised nothing', async () => {
    const f = project(UNMARKED);
    try {
      const res = await run(f);
      expect(res.errors).toEqual([]);
      // Not an empty module and not an empty key: a project that never asked for
      // this pays nothing for it, on a machine that may have no toolchain at all.
      expect(config(f.out).aot).toBeUndefined();
      expect(existsSync(path.join(f.out, 'aot'))).toBe(false);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, 120_000);
});
