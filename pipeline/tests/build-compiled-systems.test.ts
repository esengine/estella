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
import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildCompiledSystems, readCompiledManifest } from '../src/bundle/buildCompiledSystems';
import { emccPath } from '../../build-tools/utils/emscripten.js';


const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EMCC = emccPath();

/**
 * A memory shaped like the engine's: growable to 2GB, and already 16MB, which
 * is also the size the module REQUIRES — emcc writes its INITIAL_MEMORY into
 * the import's declared minimum, so a host with a smaller memory gets a
 * LinkError rather than a module that copes.
 */
const engineMemory = (): WebAssembly.Memory =>
  new WebAssembly.Memory({ initial: 256, maximum: 32768 });

/** wasm section ids, by the numbers the format assigns them. */
const DATA_SECTION = 11;

/** Section id -> byte length, read straight out of the binary. */
function sectionSizes(buf: Buffer): Map<number, number> {
  const out = new Map<number, number>();
  let p = 8;
  const leb = (): number => {
    let r = 0, shift = 0, b = 0;
    do { b = buf[p++]!; r |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
    return r >>> 0;
  };
  while (p < buf.length) {
    const id = buf[p++]!;
    const size = leb();
    out.set(id, (out.get(id) ?? 0) + size);
    p += size;
  }
  return out;
}


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

/**
 * The engine wasm a build produces, or null on a checkout that has not built
 * one. `build/wasm/web` is where the build writes it; desktop/public is the
 * editor's copy, and is inside a submodule this repo may not have.
 */
function engineGlue(): string | null {
  for (const at of ['build/wasm/web/esengine.js', 'desktop/public/wasm/esengine.js']) {
    const p = path.join(ROOT, at);
    if (existsSync(p)) return p;
  }
  return null;
}

const ENGINE_GLUE = engineGlue();

/**
 * The one place both halves are real: the engine wasm this repo builds, and a
 * module compiled from a shipped system. Every other gate substitutes a fake
 * for one of them, and the two things that go wrong here are invisible against
 * a fake — a memory that cannot grow, and low addresses nobody owns.
 */
describe.skipIf(!EMCC || !ENGINE_GLUE)('loaded into the engine the build produces', () => {
  it('reports whether this gate could run at all', () => {
    if (EMCC && ENGINE_GLUE) console.log(`[real-engine] against ${ENGINE_GLUE}`);
    else console.warn('[real-engine] did NOT run — no emsdk, or no built engine wasm.');
  });

  it('instantiates against the real memory and leaves the engine intact', async () => {
    const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': PROMISED });
    const out = await buildCompiledSystems(root, { mode: 'release', emcc: EMCC, run });
    expect(out.errors).toEqual([]);

    const { default: createEngine } = await import(pathToFileURL(ENGINE_GLUE!).href) as
      { default: () => Promise<{ wasmMemory: WebAssembly.Memory; HEAPU8: Uint8Array; _malloc(n: number): number }> };
    const engine = await createEngine();

    // Without this export there is no way to hand a module the engine's memory:
    // HEAPU8.buffer is an ArrayBuffer, and an import needs the Memory itself.
    expect(engine.wasmMemory, 'the engine must export wasmMemory').toBeInstanceOf(WebAssembly.Memory);
    expect(engine.HEAPU8.buffer).toBe(engine.wasmMemory.buffer);

    const canary = engine.HEAPU8.slice(1024, 1024 + 4096);
    const bytes = readFileSync(out.wasmPath!);
    new WebAssembly.Instance(new WebAssembly.Module(bytes as unknown as BufferSource),
      { env: { memory: engine.wasmMemory } });

    expect([...engine.HEAPU8.slice(1024, 1024 + 4096)]).toEqual([...canary]);
    expect(engine._malloc(16)).toBeGreaterThan(0);
  });
});

describe('the AOT build step', () => {
  it('reports whether this gate could run at all', () => {
    if (EMCC) console.log(`[aot-build] emcc at ${EMCC}`);
    else console.warn('[aot-build] NO EMSDK — the wasm half did NOT run (pnpm emsdk:setup).');
    expect(true).toBe(true);
  });

  it('a project that promised nothing is not a build step', async () => {
    const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': UNMARKED });
    const out = await buildCompiledSystems(root, { mode: 'release', emcc: EMCC, run });
    expect(out.ok).toBe(true);
    expect(out.wasmPath).toBeNull();
    // The refusal is still reported, as information: §3.2's fallback is the
    // design, and a build that shouted about it would be crying wolf.
    expect(out.errors).toEqual([]);
  });

  it('a project with no sources at all is fine', async () => {
    const out = await buildCompiledSystems(project({}), { mode: 'release', emcc: EMCC, run });
    expect(out).toMatchObject({ ok: true, wasmPath: null, errors: [] });
  });

  it('a broken promise fails the build, naming the file and the line', async () => {
    const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': BROKEN });
    const out = await buildCompiledSystems(root, { mode: 'release', emcc: EMCC, run });
    expect(out.ok).toBe(false);
    expect(out.wasmPath).toBeNull();
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toContain('BrokenSystem');
    expect(out.errors[0]).toMatch(/Math\.sin is not exactly specified/);
    expect(out.errors[0]).toMatch(/systems\.ts:\d+/);
  });

  it('says what is missing when a promise needs a toolchain that is absent', async () => {
    const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': PROMISED });
    const out = await buildCompiledSystems(root, { mode: 'release', emcc: null, run });
    expect(out.ok).toBe(false);
    expect(out.errors[0]).toMatch(/marked @compiled but there is no emcc/);
  });

  it.skipIf(!EMCC)('builds a module the engine can load, and a manifest for it', async () => {
    const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': PROMISED });
    const out = await buildCompiledSystems(root, { mode: 'release', emcc: EMCC, run });
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
      resources: [{ name: 'Time', mut: false }],
    }]);
    expect(out.manifest!.engineAbi).toMatch(/^[0-9a-f]{16}$/);
    expect(out.manifest!.projectShapes).toMatch(/^[0-9a-f]{16}$/);
  });

  /**
   * What a module loaded into the ENGINE's memory must not do, asked of the
   * artifact rather than of the command line that made it. A fake host with a
   * fixed-size memory and nothing at the low addresses answers neither.
   */
  describe.skipIf(!EMCC)('the module a real engine would load', () => {
    let bytes: Buffer;
    beforeAll(async () => {
      const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': PROMISED });
      const out = await buildCompiledSystems(root, { mode: 'release', emcc: EMCC, run });
      expect(out.errors).toEqual([]);
      bytes = readFileSync(out.wasmPath!);
    });

    it('carries no data section, because those bytes are the engine\'s', () => {
      // A data section is written at instantiation, at an address the linker
      // chose — which for a module built against an imported memory is wherever
      // the ENGINE already keeps its statics.
      expect(sectionSizes(bytes).get(DATA_SECTION) ?? 0).toBe(0);
    });

    it('instantiates against a GROWABLE memory, which is the only kind an engine has', () => {
      // The engine links with -sALLOW_MEMORY_GROWTH, so its memory declares a
      // maximum of 32768 pages. A module declaring a smaller one does not run
      // slower — it does not instantiate at all, with a LinkError.
      expect(() => new WebAssembly.Instance(
        new WebAssembly.Module(bytes as unknown as BufferSource),
        { env: { memory: engineMemory() } })).not.toThrow();
    });

    /**
     * The same two checks against a module that DOES carry data, built the same
     * way. Without it they could be passing because emcc dropped an unreferenced
     * table — which is luck, not the property.
     */
    it('and both checks can see their subject', async () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'estella-aot-control-'));
      writeFileSync(path.join(dir, 'has-data.c'), [
        '#include <stdint.h>',
        'static const double kTable[8] = { 1, 2, 3, 4, 5, 6, 7, 8 };',
        'void es_sys_Control(uint32_t ctx) {',
        '    double *out = (double *)(uintptr_t)ctx;',
        // A RUNTIME index: with a constant one the compiler folds the table into
        // the instructions and the module has no data after all.
        '    out[1] = kTable[(unsigned)out[0] & 7u];',
        '}',
      ].join('\n'));
      const wasm = path.join(dir, 'has-data.wasm');
      const built = await run(EMCC!, ['-O2', '--no-entry', '-sSTANDALONE_WASM', '-sIMPORTED_MEMORY',
        '-sALLOW_MEMORY_GROWTH=1', '-sEXPORTED_FUNCTIONS=_es_sys_Control', '-o', wasm,
        path.join(dir, 'has-data.c')], dir);
      expect(built.code, built.stderr).toBe(0);

      const withData = readFileSync(wasm);
      expect(sectionSizes(withData).get(DATA_SECTION) ?? 0).toBeGreaterThan(0);

      const memory = engineMemory();
      const sentinel = new Uint8Array(memory.buffer, 1024, 4096).fill(0xab);
      new WebAssembly.Instance(
        new WebAssembly.Module(withData as unknown as BufferSource), { env: { memory } });
      expect(sentinel.every((b) => b === 0xab)).toBe(false);
    });

    it('and leaves the bytes already in that memory alone', () => {
      const memory = engineMemory();
      // Where a linker puts a module's data. The engine's own statics live here.
      const sentinel = new Uint8Array(memory.buffer, 1024, 4096).fill(0xab);
      new WebAssembly.Instance(
        new WebAssembly.Module(bytes as unknown as BufferSource), { env: { memory } });
      expect(sentinel.every((b) => b === 0xab)).toBe(true);
    });
  });

  it.skipIf(!EMCC)('rebuilding is not additive: the cache is what this build made', async () => {
    const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': PROMISED });
    await buildCompiledSystems(root, { mode: 'release', emcc: EMCC, run });
    writeFileSync(path.join(root, '.esengine/cache/aot/stale.c'), 'int leftover;\n');

    await buildCompiledSystems(root, { mode: 'release', emcc: EMCC, run });
    // A file from a previous shape of the project must not survive into the one
    // the engine loads next.
    expect(existsSync(path.join(root, '.esengine/cache/aot/stale.c'))).toBe(false);
  });

  it('a dev build never compiles, so a marker costs it nothing', async () => {
    const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': PROMISED });
    // No emcc, and a project that promised something: in release this is an
    // error, and in dev it is not a build step at all. §9 — the preview
    // interprets, so a machine with no emsdk still builds and runs everything.
    const out = await buildCompiledSystems(root, { mode: 'dev', emcc: null, run });
    expect(out).toMatchObject({ ok: true, wasmPath: null, errors: [] });
  });

  it('and a dev build does not fail on a promise it is not collecting', async () => {
    const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': BROKEN });
    const out = await buildCompiledSystems(root, { mode: 'dev', emcc: EMCC, run });
    expect(out.ok).toBe(true);
    expect(out.errors).toEqual([]);
  });

  it.skipIf(!EMCC)('ship compiles exactly as release does', async () => {
    const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': PROMISED });
    const ship = await buildCompiledSystems(root, { mode: 'ship', emcc: EMCC, run });
    expect(ship.ok).toBe(true);
    expect(ship.manifest?.systems.map((s) => s.name)).toEqual(['MoveSystem']);
  });
});
