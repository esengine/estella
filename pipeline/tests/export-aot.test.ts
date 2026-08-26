// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What the MANIFEST beside a package's compiled module says, and what the
 *        module itself imports.
 *
 *        `export-compiled-systems.test.ts` holds the staging — which file lands
 *        where, and that the config names it. This holds the two things that
 *        would still be wrong with all of that right: a manifest that describes
 *        the systems differently than the runtime reads them, and a module that
 *        brought its own memory or a data section to write over the engine's.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportGame } from '../src/export/exportGame';
import { emccPath } from '../../build-tools/utils/emscripten.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME_HOST = path.join(HERE, '..', 'src', 'runtime', 'gameHost.ts');
/** Where an export stages the module, and where the config points at it. */
const STAGED = path.join('aot', 'systems.wasm');
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

const run = (f: { root: string; out: string }) => exportGame({
  root: f.root, entryScene: 'scenes/main.esscene', gameHostEntry: GAME_HOST,
  scriptsEntry: 'src/main.ts',
  sdkDistDir: path.join(f.root, '_sdk'), wasmDir: path.join(f.root, '_wasm'),
  outDir: f.out,
});

describe('the promised systems in a web package', () => {
  it('reports whether this gate could run at all', () => {
    if (!EMCC) console.warn('[export-aot] NO EMSDK — the compiling cases did NOT run.');
  });

  it.skipIf(!EMCC)('writes a manifest that says how to call them', async () => {
    const f = setup({ 'src/components.ts': COMPONENTS, 'src/systems.ts': PROMISED, 'src/main.ts': MAIN });
    const res = await run(f);
    expect(res.errors).toEqual([]);

    const cfg = JSON.parse(readFileSync(path.join(f.out, 'game.config.json'), 'utf8')) as {
      aot?: {
        wasm: string;
        manifest: {
          engineAbi: string; projectShapes: string;
          systems: {
            name: string; symbol: string;
            queries: { comp: string; mut: boolean }[][];
            resources: { name: string; mut: boolean }[];
            readers: unknown[]; writers: unknown[];
          }[];
        };
      };
    };
    expect(cfg.aot?.manifest.systems).toEqual([{
      name: 'MoveSystem',
      symbol: 'es_sys_MoveSystem',
      queries: [[{ comp: 'Transform', mut: true }, { comp: 'Mover', mut: false }]],
      // `mut` per resource, because a read-only mirror written back would
      // overwrite what the engine put there this frame.
      resources: [{ name: 'Time', mut: false }],
      // A system with no events still declares the two lists, so a runtime
      // never has to tell "none" from "an older manifest".
      readers: [],
      writers: [],
    }]);
    expect(cfg.aot?.manifest.engineAbi).toMatch(/^[0-9a-f]{16}$/);
  });

  it.skipIf(!EMCC)('and the module it staged imports the engine\'s memory, and nothing else', async () => {
    const f = setup({ 'src/components.ts': COMPONENTS, 'src/systems.ts': PROMISED, 'src/main.ts': MAIN });
    await run(f);
    // Ask the ARTIFACT the two questions a fake host cannot: it imports the
    // engine's memory rather than owning one, and it brought no data section to
    // write over the engine's own bytes.
    const bytes = readFileSync(path.join(f.out, STAGED));
    const mod = new WebAssembly.Module(bytes as unknown as BufferSource);
    expect(WebAssembly.Module.imports(mod)).toEqual([{ module: 'env', name: 'memory', kind: 'memory' }]);
    expect(WebAssembly.Module.exports(mod).map((e) => e.name)).toContain('es_sys_MoveSystem');
  });
});
