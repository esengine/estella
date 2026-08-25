// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The AOT build step: a project's `@compiled` systems become wasm.
 *
 * @details Everything upstream of this proved the compiler and the contract.
 *          This proves the BUILD: point it at a project directory and get back a
 *          module the engine can load, or an error naming the line that stopped
 *          it. Real emcc where emsdk is unpacked, and a loud skip where it is
 *          not — a gate that never saw its subject is worse than a missing one.
 */
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCompiledSystems, readCompiledManifest } from '../src/bundle/buildCompiledSystems';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function findEmcc(): string | null {
  const at = path.join(ROOT, 'tools/emsdk/upstream/emscripten',
    process.platform === 'win32' ? 'emcc.bat' : 'emcc');
  return existsSync(at) ? at : null;
}

const EMCC = findEmcc();

/** The toolchain's runner, in miniature: emcc is a .bat on Windows. */
const run = (cmd: string, args: string[], cwd: string): Promise<{ code: number; stderr: string }> =>
  new Promise((done) => {
    const child = spawn(cmd, args, { cwd, shell: process.platform === 'win32' });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('close', (code) => done({ code: code ?? 1, stderr }));
  });

/** A project on disk: `src/` with whatever files the case needs. */
function project(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'estella-aot-project-'));
  for (const [rel, body] of Object.entries(files)) {
    const at = path.join(root, rel);
    mkdirSync(path.dirname(at), { recursive: true });
    writeFileSync(at, body);
  }
  return root;
}

const COMPONENTS = `import { defineComponent } from 'esengine';
export const Mover = defineComponent('Mover', { speed: 100, directionX: 1, directionY: 0 });
`;

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
        }
    },
    { name: 'MoveSystem' },
);
`;

/** Promised, and outside the subset: trig is refused on purpose (§3.3). */
const BROKEN = PROMISED
  .replace('mover.directionX * mover.speed', 'Math.sin(mover.directionX) * mover.speed')
  .replace("{ name: 'MoveSystem' }", "{ name: 'BrokenSystem' }");

/** Inside the subset, but nobody promised it. */
const UNMARKED = PROMISED.replace(`/**
 * @compiled
 */
`, '').replace("{ name: 'MoveSystem' }", "{ name: 'QuietSystem' }");

describe('the AOT build step', () => {
  it('reports whether this gate could run at all', () => {
    if (EMCC) console.log(`[aot-build] emcc at ${EMCC}`);
    else console.warn('[aot-build] NO EMSDK — the wasm half did NOT run (pnpm emsdk:setup).');
    expect(true).toBe(true);
  });

  it('a project that promised nothing is not a build step', async () => {
    const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': UNMARKED });
    const out = await buildCompiledSystems(root, { emcc: EMCC, run });
    expect(out.ok).toBe(true);
    expect(out.wasmPath).toBeNull();
    // The refusal is still reported, as information: §3.2's fallback is the
    // design, and a build that shouted about it would be crying wolf.
    expect(out.errors).toEqual([]);
  });

  it('a project with no sources at all is fine', async () => {
    const out = await buildCompiledSystems(project({}), { emcc: EMCC, run });
    expect(out).toMatchObject({ ok: true, wasmPath: null, errors: [] });
  });

  it('a broken promise fails the build, naming the file and the line', async () => {
    const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': BROKEN });
    const out = await buildCompiledSystems(root, { emcc: EMCC, run });
    expect(out.ok).toBe(false);
    expect(out.wasmPath).toBeNull();
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toContain('BrokenSystem');
    expect(out.errors[0]).toMatch(/Math\.sin is not exactly specified/);
    expect(out.errors[0]).toMatch(/systems\.ts:\d+/);
  });

  it('says what is missing when a promise needs a toolchain that is absent', async () => {
    const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': PROMISED });
    const out = await buildCompiledSystems(root, { emcc: null, run });
    expect(out.ok).toBe(false);
    expect(out.errors[0]).toMatch(/marked @compiled but there is no emcc/);
  });

  it.skipIf(!EMCC)('builds a module the engine can load, and a manifest for it', async () => {
    const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': PROMISED });
    const out = await buildCompiledSystems(root, { emcc: EMCC, run });
    expect(out.errors).toEqual([]);
    expect(out.ok).toBe(true);
    expect(out.wasmPath).not.toBeNull();

    const bytes = await import('node:fs').then((fs) => fs.readFileSync(out.wasmPath!));
    const module = new WebAssembly.Module(bytes as unknown as BufferSource);
    // The property the whole shape rests on: the engine's memory, and nothing
    // else — no function import, so no second channel back into the engine.
    expect(WebAssembly.Module.imports(module))
      .toEqual([{ module: 'env', name: 'memory', kind: 'memory' }]);
    expect(WebAssembly.Module.exports(module).map((e) => e.name)).toContain('es_sys_MoveSystem');

    // The manifest is what turns a symbol into a call: which components fill
    // which row slot, and in what order.
    expect(out.manifest).toEqual(readCompiledManifest(root));
    expect(out.manifest!.systems).toEqual([{
      name: 'MoveSystem',
      symbol: 'es_sys_MoveSystem',
      queries: [[{ comp: 'Transform', mut: true }, { comp: 'Mover', mut: false }]],
      resources: ['Time'],
    }]);
    expect(out.manifest!.contractHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it.skipIf(!EMCC)('rebuilding is not additive: the cache is what this build made', async () => {
    const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': PROMISED });
    await buildCompiledSystems(root, { emcc: EMCC, run });
    writeFileSync(path.join(root, '.esengine/cache/aot/stale.c'), 'int leftover;\n');

    await buildCompiledSystems(root, { emcc: EMCC, run });
    // A file from a previous shape of the project must not survive into the one
    // the engine loads next.
    expect(existsSync(path.join(root, '.esengine/cache/aot/stale.c'))).toBe(false);
  });
});
