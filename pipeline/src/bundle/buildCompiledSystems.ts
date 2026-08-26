// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  AOT step: a project's `@compiled` systems, as wasm.
 *
 * The rest of `buildScripts` hands the realm JavaScript. This hands it a module
 * of machine code for the systems the author PROMISED would compile, built with
 * emcc from the C `@estella/compiler` emits.
 *
 * It imports the engine's memory rather than owning one, which is what keeps
 * this cheap: the engine wasm stays prebuilt and only the game's own systems are
 * compiled here — a few hundred bytes, not a link.
 *
 * Never throws. A project with no marked system is not a failure and not a
 * build step; a marked system that will not compile IS one, because that is what
 * the marker means.
 *
 * The mode decides whether it runs at all. `dev` never compiles, because the
 * editor's preview always interprets: a machine with no emsdk builds and runs
 * every project. `release` and `ship` do compile, and there a promise the subset
 * cannot keep is an error rather than a quiet fallback — which is the difference
 * the marker exists to make.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { brokenPromises, lowerProgram } from '../../../compiler/src/frontend';
import { verifySystem } from '../../../compiler/src/verify';
import { inlineSystem } from '../../../compiler/src/inline';
import { builtinShapes } from '../../../compiler/src/builtins';
import { packLayout, planFor } from '../../../compiler/src/abi';
import { CFLAGS, WASM_LINK_FLAGS, cSymbol, emitC } from '../../../compiler/src/codegen';
import { AOT_MANIFEST, AOT_WASM } from './aotArtifacts';

/** Where the C and the wasm land, beside the script bundle. */
const CACHE_DIR = '.esengine/cache/aot';
const WASM = AOT_WASM;
const MANIFEST = AOT_MANIFEST;

/** What the runtime needs in order to call one compiled system. */
export interface CompiledSystemInfo {
  /** The system's declared name, as the schedule knows it. */
  name: string;
  /** The exported wasm symbol. */
  symbol: string;
  /** One entry per declared Query: its components, in the order it names them. */
  queries: { comp: string; mut: boolean }[][];
  /**
   * One per declared Res/ResMut, in declaration order. `mut` is what makes the
   * runtime write a mirrored resource back after the call; `fields` is present
   * for a resource the PROJECT declared, because its layout is not something
   * the engine knows — it was derived from the declaration.
   */
  resources: { name: string; mut: boolean; fields?: string[] }[];
  /** Event readers and writers, with the payload layout each one uses. */
  readers: { slot: number; event: string; fields: string[] }[];
  writers: { slot: number; event: string; fields: string[] }[];
}

export interface CompiledSystemsManifest {
  /**
   * What this module baked in, so a loader can say WHICH one moved: the engine
   * it was built against, and the project's own component shapes. The fixes
   * differ — rebuild the module, or rebuild the project — so the numbers do too.
   */
  engineAbi: string;
  projectShapes: string;
  systems: CompiledSystemInfo[];
}

/**
 * Which build this is. Not a verbosity setting: it decides whether a `@compiled`
 * marker is a promise anyone is collecting on.
 */
export type BuildMode = 'dev' | 'release' | 'ship';

export interface BuildCompiledResult {
  ok: boolean;
  /** Absolute path to the wasm, or null when there was nothing to build. */
  wasmPath: string | null;
  manifest: CompiledSystemsManifest | null;
  errors: string[];
  /** Systems the subset refused that were NOT promised — information, not failure. */
  notes: string[];
}

/** A project resource's fields in LAYOUT order, as the code reads them. */
function fieldsOfShape(module: { comps: ReadonlyMap<string, { fields: ReadonlyMap<string, unknown> }> },
  name: string): string[] {
  return [...(module.comps.get(name)?.fields.keys() ?? [])];
}

/** A payload's fields in LAYOUT order, which is the order the code reads them. */
function fieldsOf(module: { events: ReadonlyMap<string, { fields: ReadonlyMap<string, unknown> }> },
    event: string): string[] {
  return [...(module.events.get(event)?.fields.keys() ?? [])];
}

/** Every `.ts` under `src/`, which is the unit a project's program is. */
function sources(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) out.push(p);
    }
  };
  walk(path.join(root, 'src'));
  return out;
}

/** A marker anywhere in a file. Text, not a parse: this only decides whether the
 *  expensive answer is worth computing. */
const anyPromise = (files: string[]): boolean =>
  files.some((f) => readFileSync(f, 'utf8').includes('@compiled'));

/**
 * Whether this project promises any compilation at all.
 *
 * The cheap half of what {@link buildCompiledSystems} answers, exported because
 * the editor's platform catalog must say a target needs emcc BEFORE an export
 * spawns one. Both read this, so they cannot disagree about what was promised.
 */
export function promisesCompilation(root: string): boolean {
  return anyPromise(sources(root));
}

/**
 * Compile the project's `@compiled` systems to `<root>/.esengine/cache/aot/`.
 *
 * `emcc` is the caller's to supply, because finding it is the toolchain's job
 * and not this module's; without one a project that promised nothing still
 * builds, and one that promised something says so.
 */
export async function buildCompiledSystems(
  root: string,
  opts: {
    /** dev never compiles; release and ship require what the markers promised. */
    mode: BuildMode;
    /** Absolute path to emcc, or null when the toolchain has none. */
    emcc: string | null;
    /** Runs a command; the toolchain's own runner, so env and logging match. */
    run: (cmd: string, args: string[], cwd: string) => Promise<{ code: number; stderr: string }>;
  },
): Promise<BuildCompiledResult> {
  if (opts.mode === 'dev') {
    // Nothing is compiled and nothing is checked, so a marker costs a dev build
    // nothing at all — not a toolchain, not a second of build time, not a
    // failure on a machine that has neither.
    return { ok: true, wasmPath: null, manifest: null, errors: [], notes: [] };
  }
  const files = sources(root);
  if (files.length === 0) {
    return { ok: true, wasmPath: null, manifest: null, errors: [], notes: [] };
  }
  // A project with no `@compiled` anywhere promised nothing, so it must not pay
  // for a TypeScript Program over its sources. Nothing is decided here: the parse
  // below still decides, this only skips having nothing to decide.
  if (!anyPromise(files)) {
    return { ok: true, wasmPath: null, manifest: null, errors: [], notes: [] };
  }

  let lowered;
  try {
    lowered = lowerProgram(files, builtinShapes());
  } catch (err) {
    return { ok: false, wasmPath: null, manifest: null, notes: [], errors: [String(err)] };
  }

  const broken = brokenPromises(lowered);
  if (broken.length > 0) {
    // The marker's whole point: a refusal against a promised system is an error
    // with a line, not a silent fall back to the interpreter.
    return {
      ok: false,
      wasmPath: null,
      manifest: null,
      notes: [],
      errors: broken.map((d) => `${d.file}:${d.line}: ${d.system ?? ''} is @compiled but ${d.message}`),
    };
  }

  const promised = new Set(lowered.required);
  const chosen = lowered.module.systems.filter((s) => promised.has(s.name));
  const notes = lowered.diagnostics
    .filter((d) => d.severity === 'note' && d.system)
    .map((d) => `${d.system}: ${d.message}`);
  if (chosen.length === 0) {
    // Nothing was promised, so there is nothing to build and nothing to say.
    return { ok: true, wasmPath: null, manifest: null, errors: [], notes };
  }

  const bad = chosen.flatMap((s) => verifySystem(s, lowered.module.comps, lowered.module.fns));
  if (bad.length > 0) {
    return {
      ok: false, wasmPath: null, manifest: null, notes,
      errors: bad.map((e) => `${e.system}: ${e.message}`),
    };
  }

  if (!opts.emcc) {
    return {
      ok: false, wasmPath: null, manifest: null, notes,
      errors: [`${chosen.length} system(s) are marked @compiled but there is no emcc`
        + ' — install the emscripten toolchain and point EMSDK at it (in this repo:'
        + ' `pnpm emsdk:setup`), or remove the marker'],
    };
  }

  const layout = packLayout(lowered.module.comps);
  const inlined = chosen.map((s) => inlineSystem(s, lowered.module.fns));
  const c = emitC(lowered.module, layout, inlined);

  const dir = path.join(root, CACHE_DIR);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'estella_abi.h'), c.header);
  writeFileSync(path.join(dir, 'estella_offsets.h'), c.offsets);
  writeFileSync(path.join(dir, 'systems.c'), c.source);

  const wasmPath = path.join(dir, WASM);
  const exported = c.symbols.map((s) => `_${s}`).join(',');
  const built = await opts.run(opts.emcc, [
    ...CFLAGS, '-Wall', '-Wextra',
    // No entry point and no JS glue, so the module's only import is the memory
    // it is given. An empty import section is a property of this command line
    // as much as of the C.
    ...WASM_LINK_FLAGS,
    `-sEXPORTED_FUNCTIONS=${exported}`,
    // `c.decls` is deliberately NOT compiled here. It is the data half, and a
    // data section is written at a link-time address the engine already owns.
    '-o', wasmPath, path.join(dir, 'systems.c'),
  ], dir);
  if (built.code !== 0 || !existsSync(wasmPath)) {
    return { ok: false, wasmPath: null, manifest: null, notes, errors: [built.stderr.trim()] };
  }

  const manifest: CompiledSystemsManifest = {
    engineAbi: c.handshake.engineAbi,
    projectShapes: c.handshake.projectShapes,
    systems: inlined.map((sys) => {
      const plan = planFor(sys);
      return {
        name: sys.name,
        symbol: cSymbol(sys.name),
        queries: plan.queries.map((q) => q.map((a) => ({ comp: a.comp, mut: a.mut }))),
        resources: plan.resources.map((r) => (lowered.module.userResources.has(r.name)
            ? { name: r.name, mut: r.mut, fields: fieldsOfShape(lowered.module, r.name) }
            : { name: r.name, mut: r.mut })),
        // The payload layout travels with the manifest: the runtime flattens an
        // object into it, and the compiled code reads at those offsets.
        readers: plan.readers.map((r) => ({
            slot: r.slot, event: r.event, fields: fieldsOf(lowered.module, r.event),
        })),
        writers: plan.writers.map((w) => ({
            slot: w.slot, event: w.event, fields: fieldsOf(lowered.module, w.event),
        })),
      };
    }),
  };
  writeFileSync(path.join(dir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  return { ok: true, wasmPath, manifest, errors: [], notes };
}

/** Read back what a previous build wrote, or null. */
export function readCompiledManifest(root: string): CompiledSystemsManifest | null {
  const at = path.join(root, CACHE_DIR, MANIFEST);
  if (!existsSync(at)) return null;
  return JSON.parse(readFileSync(at, 'utf8')) as CompiledSystemsManifest;
}
