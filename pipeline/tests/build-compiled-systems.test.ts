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
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildCompiledSystems, readCompiledManifest } from '../src/bundle/buildCompiledSystems';
import { cachedManifestPath } from '../src/bundle/compiledBuildCache';
import { runSystemCompiler as run } from '../src/bundle/emccPath';
import { compiledSystemModule } from './fixtures/compiledSystemModule';
import { projectShapeDigest } from '../../sdk/src/ecs/aot/abiDigest';
import { emccPath } from '../../build-tools/utils/emscripten.js';
import { findHostCC, nativeModuleExt } from '../../compiler/src/hostCC';
import { ANDROID_AOT_LIBRARY, androidAotCompilers } from '../src/export/androidAot';
import { androidSdk, ndkTool, requireNdk } from '../../build-tools/utils/android.js';


const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EMCC = emccPath();
const HOST_CC = findHostCC();

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

/** A deterministic linker for tests of the cache layout that can run without a native toolchain. */
const writeNamedModule: typeof run = async (_cc, args, cwd) => {
  const file = path.resolve(cwd, args[args.indexOf('-o') + 1]!);
  writeFileSync(file, path.basename(file));
  return { code: 0, stderr: '' };
};

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

/** Takes the channel AND uses it: the declaration alone is not the question,
 *  because a system that never despawns writes no record for a host to flush. */
const COMMANDS = `import { defineSystem, Query, Mut, Commands } from 'esengine';
import { Mover } from './components';

/**
 * @compiled
 */
export const reapSystem = defineSystem(
    [Query(Mut(Mover)), Commands()],
    (query, cmds) => {
        for (const [e, mover] of query) {
            mover.speed = mover.speed - 1;
            if (mover.speed <= 0) cmds.despawn(e);
        }
    },
    { name: 'ReapSystem' },
);
`;

/** Takes the channel and never writes to it. */
const IDLE_COMMANDS = `import { defineSystem, Query, Mut, Commands } from 'esengine';
import { Mover } from './components';

/**
 * @compiled
 */
export const idleSystem = defineSystem(
    [Query(Mut(Mover)), Commands()],
    (query, _cmds) => {
        for (const [, mover] of query) mover.speed = mover.speed - 1;
    },
    { name: 'IdleSystem' },
);
`;

describe.skipIf(!EMCC)('compiled artifacts from overlapping exports', () => {
  it('keeps each linker on its own sources and preserves both results for packaging', async () => {
    const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': PROMISED,
      'src/extra.ts': IDLE_COMMANDS.replace('@compiled', '') });
    let resume!: () => void;
    const waiting = new Promise<void>(resolve => { resume = resolve; });
    const threaded = buildCompiledSystems(root, { mode: 'ship', compileAll: true, includeSharedMemory: true, cc: EMCC,
      run: async (cc, args, dir) => { await waiting; return run(cc, args, dir); } });
    const mini = await buildCompiledSystems(root, { mode: 'ship', compileAll: false, cc: EMCC, run }).finally(resume);
    const web = await threaded;
    expect(mini.errors).toEqual([]);
    expect(web.errors).toEqual([]);
    for (const [result, shared] of [[mini, false], [web, false], [web, true]] as const) {
      const file = shared ? result.modules!['systems-shared.wasm'] : result.modulePath!;
      expect(compiledSystemModule(file, shared)).toMatchObject({
        contract: result.manifest!.moduleContract,
        symbols: result.manifest!.systems.map(system => system.symbol).sort(),
      });
    }
    expect(mini.manifest!.systems).toHaveLength(1);
    expect(web.manifest!.systems).toHaveLength(2);
    expect(readCompiledManifest(root)).toEqual(web.manifest);
  }, 120_000);

  it('keeps the original binary after a body-only edit with the same ABI', async () => {
    const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': PROMISED });
    const options = { mode: 'ship' as const, cc: EMCC, run };
    const first = await buildCompiledSystems(root, options);
    expect(first.errors).toEqual([]);
    const original = readFileSync(first.modulePath!);
    writeFileSync(path.join(root, 'src/systems.ts'), PROMISED.replace('mover.speed * time.delta', '7 * mover.speed * time.delta'));
    const second = await buildCompiledSystems(root, options);
    expect(second.errors).toEqual([]);
    expect(second.manifest).toEqual(first.manifest);
    expect(readFileSync(second.modulePath!)).not.toEqual(original);
    expect(readFileSync(first.modulePath!)).toEqual(original);
    expect(path.dirname(cachedManifestPath(root))).toBe(path.dirname(second.modulePath!));
  }, 120_000);

  it('keeps the last complete manifest and modules when a later variant fails', async () => {
    const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': PROMISED });
    const working = await buildCompiledSystems(root, { mode: 'ship', cc: EMCC, run });
    expect(working.errors).toEqual([]);
    const original = readFileSync(working.modulePath!);
    const failed = await buildCompiledSystems(root, { mode: 'ship', cc: EMCC, includeSharedMemory: true,
      run: async (cc, args, dir) => args.includes('-Wl,--shared-memory')
        ? { code: 1, stderr: 'shared linker stopped' } : run(cc, args, dir) });
    expect(failed).toMatchObject({ ok: false, modulePath: null, manifest: null });
    expect(failed.errors.join(' ')).toContain('shared linker stopped');
    expect(readCompiledManifest(root)).toEqual(working.manifest);
    expect(readFileSync(working.modulePath!)).toEqual(original);
  }, 120_000);
});

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
    const out = await buildCompiledSystems(root, { mode: 'release', cc: EMCC, run });
    expect(out.errors).toEqual([]);

    const { default: createEngine } = await import(pathToFileURL(ENGINE_GLUE!).href) as
      { default: () => Promise<{ wasmMemory: WebAssembly.Memory; HEAPU8: Uint8Array; _malloc(n: number): number }> };
    const engine = await createEngine();

    // Without this export there is no way to hand a module the engine's memory:
    // HEAPU8.buffer is an ArrayBuffer, and an import needs the Memory itself.
    expect(engine.wasmMemory, 'the engine must export wasmMemory').toBeInstanceOf(WebAssembly.Memory);
    expect(engine.HEAPU8.buffer).toBe(engine.wasmMemory.buffer);

    const canary = engine.HEAPU8.slice(1024, 1024 + 4096);
    const bytes = readFileSync(out.modulePath!);
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

  it('a project that compiles only what it marked, and marked nothing, is not a build step', async () => {
    const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': UNMARKED });
    const out = await buildCompiledSystems(root, { mode: 'release', compileAll: false, cc: EMCC, run });
    expect(out).toMatchObject({ ok: true, modulePath: null, errors: [] });
  });

  it.skipIf(!EMCC)('compiles an unmarked system the subset takes, by default', async () => {
    const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': UNMARKED });
    const out = await buildCompiledSystems(root, { mode: 'release', cc: EMCC, run });
    expect(out.errors).toEqual([]);
    expect(out.modulePath).not.toBeNull();
    expect(out.manifest!.systems.map((s) => s.name)).toEqual(['QuietSystem']);
  });

  it('leaves an unmarked system the subset refuses to the interpreter, as a note', async () => {
    const quietBroken = BROKEN.replace('/**\n * @compiled\n */\n', '');
    const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': quietBroken });
    const out = await buildCompiledSystems(root, { mode: 'release', cc: EMCC, run });
    expect(out).toMatchObject({ ok: true, modulePath: null, errors: [] });
    expect(out.notes.join('\n')).toMatch(/BrokenSystem: Math\.sin is implementation-defined/);
  });

  it('with no compiler and nothing promised, builds and says what ran interpreted', async () => {
    const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': UNMARKED });
    const out = await buildCompiledSystems(root, { mode: 'release', cc: null, run });
    expect(out).toMatchObject({ ok: true, modulePath: null, errors: [] });
    expect(out.warnings?.[0]).toMatch(/1 system\(s\) could run compiled, but there is no emcc/);
  });

  it('a project with no sources at all is fine', async () => {
    const out = await buildCompiledSystems(project({}), { mode: 'release', cc: EMCC, run });
    expect(out).toMatchObject({ ok: true, modulePath: null, errors: [] });
  });

  it('a broken promise fails the build, naming the file and the line', async () => {
    const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': BROKEN });
    const out = await buildCompiledSystems(root, { mode: 'release', cc: EMCC, run });
    expect(out.ok).toBe(false);
    expect(out.modulePath).toBeNull();
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toContain('BrokenSystem');
    expect(out.errors[0]).toMatch(/Math\.sin is implementation-defined/);
    expect(out.errors[0]).toMatch(/systems\.ts:\d+/);
  });

  it('says what is missing when a promise needs a toolchain that is absent', async () => {
    const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': PROMISED });
    const out = await buildCompiledSystems(root, { mode: 'release', cc: null, run });
    expect(out.ok).toBe(false);
    expect(out.errors[0]).toMatch(/marked @compiled but there is no emcc/);
  });

  it.skipIf(!EMCC)('builds a module the engine can load, and a manifest for it', async () => {
    const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': PROMISED });
    const out = await buildCompiledSystems(root, { mode: 'release', cc: EMCC, run });
    expect(out.errors).toEqual([]);
    expect(out.ok).toBe(true);
    expect(out.modulePath).not.toBeNull();

    const bytes = await import('node:fs').then((fs) => fs.readFileSync(out.modulePath!));
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
      // A system with no events still declares the two lists, so a runtime
      // never has to tell "none" from "an older manifest".
      readers: [],
      writers: [],
      // Off the BODY: this one takes no Commands channel, and one that took it
      // and never despawned would say the same.
      commands: false,
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
      const out = await buildCompiledSystems(root, { mode: 'release', cc: EMCC, run });
      expect(out.errors).toEqual([]);
      bytes = readFileSync(out.modulePath!);
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

  it('publishes only the requested variants and reuses identical completed builds', async () => {
    const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': PROMISED });
    const options = { mode: 'release' as const, cc: 'test-cc', run: writeNamedModule };
    const both = await buildCompiledSystems(root, { ...options, includeSharedMemory: true });
    const [first, second] = await Promise.all([buildCompiledSystems(root, options), buildCompiledSystems(root, options)]);
    for (const result of [both, first, second]) expect(result.errors).toEqual([]);
    expect(first.modulePath).toBe(second.modulePath);
    expect(path.dirname(cachedManifestPath(root))).toBe(path.dirname(first.modulePath!));
    expect(existsSync(path.join(path.dirname(first.modulePath!), 'systems-shared.wasm'))).toBe(false);
    expect(existsSync(both.modules!['systems-shared.wasm']!)).toBe(true);
    const cache = path.join(root, '.esengine/cache/aot');
    expect(readdirSync(path.join(cache, 'builds'))).toHaveLength(2);
    expect(readdirSync(cache).filter(name => name.startsWith('.build-'))).toEqual([]);
  });

  it('reads legacy flat caches and keeps them when linking is interrupted', async () => {
    const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': PROMISED });
    const cache = path.join(root, '.esengine/cache/aot');
    mkdirSync(cache, { recursive: true });
    const manifest = { engineAbi: 'legacy', projectShapes: 'legacy', moduleContract: 'legacy', systems: [] };
    writeFileSync(path.join(cache, 'systems.json'), JSON.stringify(manifest));
    expect(readCompiledManifest(root)).toEqual(manifest);
    const failed = await buildCompiledSystems(root, {
      mode: 'ship', cc: 'test-cc', run: async () => { throw new Error('link interrupted'); },
    });
    expect(failed).toMatchObject({ ok: false, modulePath: null, errors: ['link interrupted'] });
    expect(readCompiledManifest(root)).toEqual(manifest);
    expect(readdirSync(cache).filter(name => name.startsWith('.build-'))).toEqual([]);
  });

  it('keeps nested library paths within their named compiler outputs', async () => {
    const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': PROMISED });
    const result = await buildCompiledSystems(root, {
      mode: 'release', target: 'native', cc: null, run: writeNamedModule,
      outputs: [{ id: 'arm64', cc: 'test-cc', flags: [], module: 'plugins/systems.so' }],
    });
    expect(result.errors).toEqual([]);
    const file = path.join(path.dirname(cachedManifestPath(root)), 'arm64', 'plugins', 'systems.so');
    expect(result.modulePath).toBe(file);
    expect(result.modules).toEqual({ arm64: file });
    expect(readFileSync(file, 'utf8')).toBe('systems.so');
  });

  it('passes a stable default build timestamp and honors the toolchain environment', async () => {
    const root = project({ 'clock.cjs': "process.stderr.write(process.env.SOURCE_DATE_EPOCH ?? 'missing');" });
    try {
      vi.stubEnv('SOURCE_DATE_EPOCH', undefined);
      expect(await run(process.execPath, ['clock.cjs'], root)).toEqual({ code: 0, stderr: '0' });
      vi.stubEnv('SOURCE_DATE_EPOCH', '946684800');
      expect(await run(process.execPath, ['clock.cjs'], root)).toEqual({ code: 0, stderr: '946684800' });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('a dev build never compiles, so a marker costs it nothing', async () => {
    const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': PROMISED });
    // No emcc, and a project that promised something: in release this is an
    // error, and in dev it is not a build step at all. §9 — the preview
    // interprets, so a machine with no emsdk still builds and runs everything.
    const out = await buildCompiledSystems(root, { mode: 'dev', cc: null, run });
    expect(out).toMatchObject({ ok: true, modulePath: null, errors: [] });
  });

  it('and a dev build does not fail on a promise it is not collecting', async () => {
    const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': BROKEN });
    const out = await buildCompiledSystems(root, { mode: 'dev', cc: EMCC, run });
    expect(out.ok).toBe(true);
    expect(out.errors).toEqual([]);
  });

  it.skipIf(!EMCC)('ship compiles exactly as release does', async () => {
    const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': PROMISED });
    const ship = await buildCompiledSystems(root, { mode: 'ship', cc: EMCC, run });
    expect(ship.ok).toBe(true);
    expect(ship.manifest?.systems.map((s) => s.name)).toEqual(['MoveSystem']);
  });
});

/**
 * The other machine. Desktop hosts the engine in their own process, so an
 * address there is a pointer and the module is a library they load — the same
 * C at the other width, since the header picks the typedef.
 */
describe('the AOT build step, for a host that loads a library', () => {
  it.skipIf(!HOST_CC)('builds a library named for this platform, and a manifest for it', async () => {
    const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': PROMISED });
    const out = await buildCompiledSystems(root, { mode: 'release', target: 'native', cc: HOST_CC, run });

    expect(out.ok, out.errors.join('; ')).toBe(true);
    expect(path.basename(out.modulePath!)).toBe(`systems${nativeModuleExt()}`);
    expect(JSON.parse(readFileSync(path.join(path.dirname(out.modulePath!), 'systems.json'), 'utf8'))).toEqual(out.manifest);
    expect(existsSync(out.modulePath!)).toBe(true);
    expect(out.manifest?.systems.map((s) => s.name)).toEqual(['MoveSystem']);
  });

  it.skipIf(!HOST_CC)('compiles the declaration table, which the wasm module must not carry', async () => {
    const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': PROMISED });
    const native = await buildCompiledSystems(root, { mode: 'release', target: 'native', cc: HOST_CC, run });
    expect(native.errors).toEqual([]);
    const decl = path.join(path.dirname(native.modulePath!), 'systems_decl.c');
    expect(existsSync(decl)).toBe(true);

    // And the wasm build of the SAME project does not write one: its data
    // section would land at an address the engine already owns.
    if (EMCC) {
      const wasm = await buildCompiledSystems(root, { mode: 'release', cc: EMCC, run });
      expect(wasm.errors).toEqual([]);
      expect(existsSync(path.join(path.dirname(wasm.modulePath!), 'systems_decl.c'))).toBe(false);
      expect(existsSync(decl)).toBe(true);
    }
  });

  it.skipIf(!(HOST_CC && EMCC))('bakes a different handshake, so neither host takes the other artifact', async () => {
    const src = { 'src/components.ts': COMPONENTS, 'src/systems.ts': PROMISED };
    const native = await buildCompiledSystems(project(src), { mode: 'release', target: 'native', cc: HOST_CC, run });
    const web = await buildCompiledSystems(project(src), { mode: 'release', cc: EMCC, run });

    expect(native.manifest!.engineAbi).not.toBe(web.manifest!.engineAbi);
    // The project's own shapes are the contract and do NOT move with the width.
    expect(native.manifest!.projectShapes).toBe(web.manifest!.projectShapes);
  });

  it.skipIf(!HOST_CC)('says what is missing when this machine has no C compiler', async () => {
    const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': PROMISED });
    const out = await buildCompiledSystems(root, { mode: 'release', target: 'native', cc: null, run });

    expect(out.ok).toBe(false);
    // Not emcc: a machine can have one and lack the other, and being sent to
    // install the wrong toolchain is worse than being told nothing.
    expect(out.errors[0]).toMatch(/no C compiler/);
    expect(out.errors[0]).not.toMatch(/emsdk/);
  });
});


/**
 * A phone: no JIT, the same QuickJS the desktop host embeds, so this is where a
 * compiled system pays most. The one C, cross-compiled by the NDK once per 64-bit
 * ABI, each a shared object the system linker loads by its bare name.
 */
describe('the AOT build step, for an Android package', () => {
  const android = androidAotCompilers(['arm64-v8a', 'x86_64', 'armeabi-v7a']);
  const HAS_NDK = android.compilers.length > 0;

  it('leaves 32-bit ABIs out and says so', () => {
    expect(android.skipped).toEqual(['armeabi-v7a']);
  });

  it.skipIf(!HAS_NDK)('builds one ELF shared object per ABI, for that machine, exporting the module table', async () => {
    const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': PROMISED });
    const out = await buildCompiledSystems(root, {
      mode: 'release', target: 'native', cc: null, run,
      outputs: android.compilers.map((c) => ({ id: c.abi, cc: c.cc, flags: c.flags, module: ANDROID_AOT_LIBRARY })),
    });
    expect(out.ok, out.errors.join('; ')).toBe(true);
    expect(Object.keys(out.modules!).sort()).toEqual(['arm64-v8a', 'x86_64']);
    expect(out.manifest?.systems.map((s) => s.name)).toEqual(['MoveSystem']);
    const readelf = ndkTool(requireNdk(androidSdk() ?? ''), 'llvm-readelf');
    const machine = { 'arm64-v8a': 'AArch64', x86_64: 'Advanced Micro Devices X86-64' } as Record<string, string>;
    for (const [abi, file] of Object.entries(out.modules!)) {
      expect(path.basename(file)).toBe(ANDROID_AOT_LIBRARY);
      const header = spawnSync(readelf, ['-h', file], { encoding: 'utf8' }).stdout;
      expect(header, abi).toContain('DYN (Shared object file)');
      expect(header, abi).toContain(machine[abi]);
      // What aot::Module reads out of the library: no manifest file rides along.
      const symbols = spawnSync(readelf, ['--dyn-syms', file], { encoding: 'utf8' }).stdout;
      for (const name of ['es_abi_hash', 'es_systems', 'es_system_count']) expect(symbols, `${abi} ${name}`).toContain(name);
    }
  }, 120_000);

  it('says what is missing when there is no NDK', async () => {
    const root = project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': PROMISED });
    const out = await buildCompiledSystems(root, {
      mode: 'release', target: 'native', cc: null, run, outputs: [], missing: 'there is no Android NDK',
    });
    expect(out.ok).toBe(false);
    expect(out.errors[0]).toMatch(/no Android NDK/);
  });
});

/**
 * Two builds of one engine over one project's shapes. Probed before the pairing
 * existed: both produced the SAME engineAbi and the SAME projectShapes, and the
 * artifact's baked handshake is a pure function of those — so a runtime reading
 * the wrong sidecar's mut flags had nothing to stop it.
 */
describe('which build a native artifact is', () => {
  const COMPONENTS_2 = `import { defineComponent } from 'esengine';
export const Mover = defineComponent('Mover', { speed: 100, directionX: 1, directionY: 0 });
`;
  const WRITES_TRANSFORM = `import { defineSystem, Query, Mut, Transform } from 'esengine';
import { Mover } from './components';
/** @compiled */
export const moveSystem = defineSystem(
    [Query(Mut(Transform), Mover)],
    (query) => { for (const [, t, m] of query) { t.position.x += m.speed; } },
    { name: 'MoveSystem' },
);
`;
  const WRITES_MOVER = `import { defineSystem, Query, Mut, Transform } from 'esengine';
import { Mover } from './components';
/** @compiled */
export const moveSystem = defineSystem(
    [Query(Transform, Mut(Mover))],
    (query) => { for (const [, t, m] of query) { m.speed = t.position.x; } },
    { name: 'MoveSystem' },
);
`;

  it.skipIf(!HOST_CC)('separates two builds the other digests cannot', async () => {
    const build = (src: string) => buildCompiledSystems(
      project({ 'src/components.ts': COMPONENTS_2, 'src/systems.ts': src }),
      { mode: 'release', target: 'native', cc: HOST_CC, run });
    const a = await build(WRITES_TRANSFORM);
    const b = await build(WRITES_MOVER);
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);

    // The two really are different modules: one writes Transform, one Mover.
    expect(JSON.stringify(a.manifest!.systems)).not.toEqual(JSON.stringify(b.manifest!.systems));
    // And neither digest that existed can say so.
    expect(a.manifest!.engineAbi).toBe(b.manifest!.engineAbi);
    expect(a.manifest!.projectShapes).toBe(b.manifest!.projectShapes);
    // This one can, which is the whole of its job.
    expect(a.manifest!.moduleContract).not.toBe(b.manifest!.moduleContract);
    // And the same build twice is the same pair, or it would refuse itself.
    expect((await build(WRITES_TRANSFORM)).manifest!.moduleContract)
      .toBe(a.manifest!.moduleContract);
  });
});


/**
 * A system that READS an event, built for real and handed to the runtime that
 * has to load it. Every test of a reader until now wrote its own manifest, and
 * wrote the projectShapes a runtime would compute rather than the one a build
 * produces — so a real reader module had never been loaded by anything.
 */
describe('a compiled system that appends a command', () => {
  it.skipIf(!HOST_CC)('says so, so a road that cannot flush one can refuse it', async () => {
    const out = await buildCompiledSystems(
      project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': COMMANDS }),
      { mode: 'release', target: 'native', cc: HOST_CC, run });
    expect(out.errors).toEqual([]);
    expect(out.manifest!.systems[0]!.commands).toBe(true);
  });

  // The declaration is not the question. Refusing on the channel would send a
  // system to the interpreter for a promise it never makes, and the difference
  // is a whole road's worth of systems on a host that cannot flush records.
  it.skipIf(!HOST_CC)('and one that takes the channel without writing to it does not', async () => {
    const out = await buildCompiledSystems(
      project({ 'src/components.ts': COMPONENTS, 'src/systems.ts': IDLE_COMMANDS }),
      { mode: 'release', target: 'native', cc: HOST_CC, run });
    expect(out.errors).toEqual([]);
    expect(out.manifest!.systems[0]!.commands).toBe(false);
  });
});

describe('a compiled system that reads an event', () => {
  const READER = `import { defineComponent, defineEvent, defineSystem, Query, Mut, EventReader } from 'esengine';
export const Mover = defineComponent('Mover', { speed: 100 });
export const Hit = defineEvent<{ amount: number }>('Hit', { amount: 0 });
/** @compiled */
export const absorb = defineSystem(
    [EventReader(Hit), Query(Mut(Mover))],
    (hits, query) => { for (const h of hits) { for (const [, m] of query) { m.speed += h.amount; } } },
    { name: 'Absorb' },
);
`;

  it.skipIf(!HOST_CC)('builds a manifest the runtime can recompute', async () => {
    const out = await buildCompiledSystems(project({ 'src/systems.ts': READER }),
      { mode: 'release', target: 'native', cc: HOST_CC, run });
    expect(out.errors).toEqual([]);
    expect(out.manifest!.systems[0]!.readers).toHaveLength(1);

    // Exactly what a runtime holding this project computes: its components, and
    // the payload read off the value `defineEvent` carries. Both halves range
    // over the same set, which is what a reader module needs to load at all.
    expect(out.manifest!.projectShapes).toBe(projectShapeDigest([
      { name: 'Mover', fields: ['speed'] },
      { name: 'Hit', fields: ['amount'] },
    ]));
  });
});
