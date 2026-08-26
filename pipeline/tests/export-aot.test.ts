// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Whether a web package carries the systems the project promised would
 *        compile, and whether the host it ships with goes looking for them.
 *
 *        Two files and one name. If the export writes `systems.wasm` and the
 *        host fetches something else, nothing fails: the fetch 404s, no twin is
 *        installed, and the game runs the interpreter with nothing to say. So
 *        the name is asserted in the BUNDLE, not just in the source.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportGame } from '../src/export/exportGame';
import { AOT_MANIFEST, AOT_WASM } from '../src/bundle/aotArtifacts';
import { emccPath } from '../../build-tools/utils/emscripten.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME_HOST = path.join(HERE, '..', 'src', 'runtime', 'gameHost.ts');
const EMCC = emccPath();

const SCN = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const meta = (uuid: string, type: string) => JSON.stringify({ uuid, version: '2.0', type, importer: {} });

const COMPONENTS = `import { defineComponent } from 'esengine';
export const Mover = defineComponent('Mover', { speed: 100, directionX: 1, directionY: 0 });
`;

/** The shape the marker exists for: a promise the subset can keep. */
const PROMISED = `import { defineSystem, Query, Mut, Res, Time, Transform } from 'esengine';
import { Mover } from './components';

/**
 * @compiled
 */
export const moveSystem = defineSystem(
    [Query(Mut(Transform), Mover), Res(Time)],
    (query, time) => {
        for (const [, transform, mover] of query) {
            transform.position.x += mover.directionX * mover.speed * time.delta;
            transform.position.y += mover.directionY * mover.speed * time.delta;
        }
    },
    { name: 'MoveSystem' },
);
`;

const MAIN = `import './systems';
`;

function setup(files: Record<string, string>): { root: string; out: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'estella-export-aot-'));
  mkdirSync(path.join(root, 'scenes'), { recursive: true });
  writeFileSync(path.join(root, 'scenes', 'main.esscene'),
    JSON.stringify({ version: '1.0', name: 'Main', entities: [{ id: 0, components: [] }] }));
  writeFileSync(path.join(root, 'scenes', 'main.esscene.meta'), meta(SCN, 'scene'));
  for (const [rel, body] of Object.entries(files)) {
    const at = path.join(root, rel);
    mkdirSync(path.dirname(at), { recursive: true });
    writeFileSync(at, body);
  }
  mkdirSync(path.join(root, '_sdk'), { recursive: true });
  writeFileSync(path.join(root, '_sdk', 'index.js'), 'export const x = 1;\n');
  mkdirSync(path.join(root, '_wasm'), { recursive: true });
  writeFileSync(path.join(root, '_wasm', 'esengine.js'), 'export default () => {};');
  writeFileSync(path.join(root, '_wasm', 'esengine.wasm'), 'ENGINE');
  return { root, out: path.join(root, 'dist') };
}

const run = (f: { root: string; out: string }, aot?: 'dev' | 'release' | 'ship') => exportGame({
  root: f.root, entryScene: 'scenes/main.esscene', gameHostEntry: GAME_HOST,
  scriptsEntry: 'src/main.ts',
  sdkDistDir: path.join(f.root, '_sdk'), wasmDir: path.join(f.root, '_wasm'),
  outDir: f.out, ...(aot === undefined ? {} : { aot }),
});

describe('the promised systems in a web package', () => {
  it('reports whether this gate could run at all', () => {
    if (!EMCC) console.warn('[export-aot] NO EMSDK — the compiling cases did NOT run.');
  });

  it('ships neither file for a project that promised nothing', async () => {
    const f = setup({ 'src/components.ts': COMPONENTS, 'src/main.ts': "export const n = 1;\n" });
    const res = await run(f);
    expect(res.errors).toEqual([]);
    expect(existsSync(path.join(f.out, AOT_WASM))).toBe(false);
    expect(existsSync(path.join(f.out, AOT_MANIFEST))).toBe(false);
  });

  it.skipIf(!EMCC)('ships both, and a manifest that says how to call them', async () => {
    const f = setup({ 'src/components.ts': COMPONENTS, 'src/systems.ts': PROMISED, 'src/main.ts': MAIN });
    const res = await run(f);
    expect(res.errors).toEqual([]);
    expect(existsSync(path.join(f.out, AOT_WASM))).toBe(true);

    const manifest = JSON.parse(readFileSync(path.join(f.out, AOT_MANIFEST), 'utf8')) as {
      engineAbi: string; projectShapes: string;
      systems: { name: string; symbol: string; queries: { comp: string; mut: boolean }[][]; resources: { name: string; mut: boolean }[]; readers: unknown[]; writers: unknown[] }[];
    };
    expect(manifest.systems).toEqual([{
      name: 'MoveSystem',
      symbol: 'es_sys_MoveSystem',
      queries: [[{ comp: 'Transform', mut: true }, { comp: 'Mover', mut: false }]],
      resources: [{ name: 'Time', mut: false }],
      // A system with no events still declares the two lists, so a runtime
      // never has to tell "none" from "an older manifest".
      readers: [],
      writers: [],
    }]);
    expect(manifest.engineAbi).toMatch(/^[0-9a-f]{16}$/);

    // The shipped module is the one the runtime loads, so ask the artifact the
    // two questions a fake host cannot: it imports the engine's memory, and it
    // brought no data section to write over the engine's own bytes.
    const bytes = readFileSync(path.join(f.out, AOT_WASM));
    const mod = new WebAssembly.Module(bytes as unknown as BufferSource);
    expect(WebAssembly.Module.imports(mod)).toEqual([{ module: 'env', name: 'memory', kind: 'memory' }]);
    expect(WebAssembly.Module.exports(mod).map((e) => e.name)).toContain('es_sys_MoveSystem');
  });

  it.skipIf(!EMCC)('and the host it ships with asks for those exact names', async () => {
    const f = setup({ 'src/components.ts': COMPONENTS, 'src/systems.ts': PROMISED, 'src/main.ts': MAIN });
    await run(f);
    // In the BUNDLE: the constant is inlined by esbuild, so this is what the
    // shipped game will actually fetch — a source-level check would pass while
    // the two ends disagreed.
    const host = readFileSync(path.join(f.out, 'game.js'), 'utf8');
    expect(host).toContain(AOT_MANIFEST);
    expect(host).toContain(AOT_WASM);
  });

  it('a dev export never compiles, so it needs no toolchain', async () => {
    const f = setup({ 'src/components.ts': COMPONENTS, 'src/systems.ts': PROMISED, 'src/main.ts': MAIN });
    const res = await run(f, 'dev');
    expect(res.errors).toEqual([]);
    expect(existsSync(path.join(f.out, AOT_WASM))).toBe(false);
  });
});
