// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The whole AOT road, in one test: a project's source becomes wasm, an
 *        App installs it, and the frames it produces are the frames the
 *        TypeScript produced (docs/REARCH_AOT.md).
 *
 * @details Every stage of this had its own gate already — the compiler against
 *          its interpreter, the module against a hand-built host, the scheduler
 *          against a closure. None of them answered the question a shipping
 *          build asks: does a project that marks a system `@compiled` end up
 *          RUNNING that system compiled, through the same doors a packaged game
 *          uses?
 *
 *          The two worlds run the SAME module: the fixture project's file is
 *          what emcc compiled AND what the interpreted App imports. A retyped
 *          copy would only ever agree with its own mistakes.
 *
 *          Loud skip without emsdk: a gate that never saw its subject is worse
 *          than a missing one.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { App, Schedule, type AotManifest, type ComponentDef, type SystemDef } from 'esengine';
import type { CppRegistry, ESEngineModule } from 'esengine/wasm';

import { buildCompiledSystems } from '../src/bundle/buildCompiledSystems';
import { resolveEmcc } from '../src/bundle/emccPath';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Inside the package, so the project's `import 'esengine'` resolves as a real one does. */
const PROJECT = path.resolve(HERE, '..', '.aot-e2e');
const PROBE = path.resolve(HERE, '..', '.aot-e2e-probe');
const EMCC = resolveEmcc();
const N = 24;
const FRAMES = 5;
const DT = 1 / 60;

/**
 * The project, as its author wrote it. One `@compiled` system over two script
 * components and the clock — the shape `examples/ecs-basics` ships, minus the
 * engine component, because an engine component's address comes from a built
 * engine and this test is about the road, not the bridge.
 */
const SOURCE = `import { defineComponent, defineSystem, Query, Mut, Res, Time } from 'esengine';

export const Pos = defineComponent('AotE2EPos', { x: 0, y: 0 });
export const Mover = defineComponent('AotE2EMover', { dx: 0, dy: 0, speed: 0 });

/**
 * Moves every mover by its direction and speed, once per frame.
 *
 * @compiled
 * A promise, not a hint: if the subset cannot lower this, the build fails here.
 */
export const moveSystem = defineSystem(
    [Query(Mut(Pos), Mover), Res(Time)],
    (query, time) => {
        for (const [, pos, mover] of query) {
            pos.x += mover.dx * mover.speed * time.delta;
            pos.y += mover.dy * mover.speed * time.delta;
        }
    },
    { name: 'AotE2EMoveSystem' },
);
`;

/**
 * The same project with the X step doubled (`replace` takes the first match).
 * It is the discriminator: without a module that answers DIFFERENTLY from the
 * closure it stands in for, this file passes with the dispatch deleted — both
 * worlds would be interpreting, and would of course agree.
 */
const PROBE_SOURCE = SOURCE.replace('mover.speed * time.delta;', 'mover.speed * time.delta * 2;');

/** The toolchain's runner, in miniature: emcc is a .bat on Windows. */
const run = (cmd: string, args: string[], cwd: string): Promise<{ code: number; stderr: string }> =>
  new Promise((done) => {
    const child = spawn(cmd, args, { cwd, shell: process.platform === 'win32' });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('error', (e) => done({ code: 1, stderr: `${stderr}${e.message}` }));
    child.on('close', (code) => done({ code: code ?? 1, stderr }));
  });

/**
 * The engine module, as far as a compiled system needs one: an allocator, a live
 * heap view, and the memory the module imports. A bump allocator because nothing
 * here frees, and freeing is not what is under test.
 */
function engineModule(): ESEngineModule {
  const memory = new WebAssembly.Memory({ initial: 256, maximum: 256 });
  let next = 4096;
  const host = {
    wasmMemory: memory,
    get HEAPU8(): Uint8Array { return new Uint8Array(memory.buffer); },
    _malloc(size: number): number {
      const at = next;
      next += (size + 15) & ~15;
      return at;
    },
    _free(): void { /* a bump allocator frees nothing */ },
  };
  return host as unknown as ESEngineModule;
}

/**
 * Enough of a CppRegistry to hand out entities. A packaged game has the real
 * one; what this test is about lives entirely on the script side — the pools the
 * rows come from and the addresses they answer with — so the registry only has
 * to be a source of ids.
 */
function registry(): CppRegistry {
  let next = 0;
  return { create: () => ++next } as unknown as CppRegistry;
}

/** What the fixture project's module exports, as this test uses it. */
interface Fixture {
  Pos: ComponentDef<{ x: number; y: number }>;
  Mover: ComponentDef<{ dx: number; dy: number; speed: number }>;
  moveSystem: SystemDef;
}

/** One world, seeded the same way, with or without the compiled twin. */
async function world(fixture: Fixture, module: ESEngineModule | null,
  install?: { wasm: BufferSource; manifest: AotManifest }): Promise<{ app: App; ids: number[] }> {
  const app = App.new();
  if (module) app.connectCpp(registry(), module);
  // Before any component exists — the rows a twin reads have to be in the memory
  // it reads, and this is the only moment that is true.
  if (install) await app.installCompiledSystems(install.wasm, install.manifest);

  const ids: number[] = [];
  for (let i = 1; i <= N; i++) {
    const e = app.world.spawn();
    app.world.insert(e, fixture.Pos, { x: i, y: -i });
    app.world.insert(e, fixture.Mover, { dx: 1, dy: -0.5, speed: i * 3 });
    ids.push(e as unknown as number);
  }
  app.addSystemToSchedule(Schedule.Update, fixture.moveSystem);
  return { app, ids };
}

const positions = (app: App, fixture: Fixture, ids: number[]): number[] =>
  ids.flatMap((id) => {
    const p = app.world.get(id as never, fixture.Pos);
    return [p.x, p.y];
  });

describe('a project that promised compilation gets it', () => {
  let built: Awaited<ReturnType<typeof buildCompiledSystems>>;
  let fixture: Fixture;
  let wasm: Uint8Array<ArrayBuffer>;
  let probe: Awaited<ReturnType<typeof buildCompiledSystems>>;
  let probeWasm: Uint8Array<ArrayBuffer>;

  beforeAll(async () => {
    if (!EMCC) return;
    rmSync(PROJECT, { recursive: true, force: true });
    mkdirSync(path.join(PROJECT, 'src'), { recursive: true });
    writeFileSync(path.join(PROJECT, 'src', 'move.ts'), SOURCE);
    built = await buildCompiledSystems(PROJECT, { mode: 'release', cc: EMCC, run });
    if (built.modulePath) wasm = Uint8Array.from(readFileSync(built.modulePath));
    // The same file the compiler read, as the runtime's own definitions — not a
    // second copy that would only ever agree with its own mistakes.
    fixture = await import(/* @vite-ignore */
      pathToFileURL(path.join(PROJECT, 'src', 'move.ts')).href) as unknown as Fixture;

    rmSync(PROBE, { recursive: true, force: true });
    mkdirSync(path.join(PROBE, 'src'), { recursive: true });
    writeFileSync(path.join(PROBE, 'src', 'move.ts'), PROBE_SOURCE);
    probe = await buildCompiledSystems(PROBE, { mode: 'release', cc: EMCC, run });
    if (probe.modulePath) probeWasm = Uint8Array.from(readFileSync(probe.modulePath));
  }, 180_000);

  it('reports whether this gate could run at all', () => {
    if (EMCC) console.log(`[aot-e2e] emcc at ${EMCC}`);
    else console.warn('[aot-e2e] NO EMSDK — the end-to-end road did NOT run (pnpm emsdk:setup).');
    expect(true).toBe(true);
  });

  it.skipIf(!EMCC)('builds the promised system and nothing else', () => {
    expect(built.errors.join('; ')).toBe('');
    expect(built.manifest?.systems.map((s) => s.name)).toEqual(['AotE2EMoveSystem']);
  });

  it.skipIf(!EMCC)('is what the runner calls — the module, not the closure', async () => {
    // A world that shows the probe's doubled X ran the compiled code; one that
    // shows the TypeScript's answer is a world where the install did nothing and
    // nobody noticed.
    const twin = await world(fixture, engineModule(), { wasm: probeWasm, manifest: probe.manifest! });
    const interpreted = await world(fixture, null);
    for (let f = 0; f < FRAMES; f++) {
      await twin.app.tick(DT);
      await interpreted.app.tick(DT);
    }
    const movedX = (w: { app: App; ids: number[] }, i: number): number =>
      w.app.world.get(w.ids[i] as never, fixture.Pos).x - (i + 1);
    const y = (w: { app: App; ids: number[] }, i: number): number =>
      w.app.world.get(w.ids[i] as never, fixture.Pos).y;
    for (let i = 0; i < N; i++) {
      expect(movedX(interpreted, i)).toBeGreaterThan(0);
      expect(movedX(twin, i)).toBeCloseTo(2 * movedX(interpreted, i), 10);
      // Y is the line the probe did NOT touch: it agrees, so what ran was this
      // module and not just anything that moves things.
      expect(y(twin, i)).toBeCloseTo(y(interpreted, i), 10);
    }
  }, 60_000);

  it.skipIf(!EMCC)('installs it, and the frames agree with the TypeScript', async () => {
    const compiled = await world(fixture, engineModule(), { wasm, manifest: built.manifest! });
    const interpreted = await world(fixture, null);
    for (let f = 0; f < FRAMES; f++) {
      await compiled.app.tick(DT);
      await interpreted.app.tick(DT);
    }

    expect(positions(compiled.app, fixture, compiled.ids))
      .toEqual(positions(interpreted.app, fixture, interpreted.ids));
    // Two untouched worlds agree too. The clock has to have reached the compiled
    // code for the agreement above to mean anything.
    expect(compiled.app.world.get(compiled.ids[0] as never, fixture.Pos).x).toBeGreaterThan(1);
  }, 60_000);

  it.skipIf(!EMCC)('refuses a module built for other component shapes', async () => {
    const app = App.new();
    app.connectCpp(registry(), engineModule());
    await expect(app.installCompiledSystems(wasm, {
      ...built.manifest!, projectShapes: 'deadbeefdeadbeef',
    })).rejects.toThrow(/Rebuild the project/);
  });

  it.skipIf(!EMCC)('refuses an engine that does not hand out its memory', async () => {
    const app = App.new();
    const module = engineModule() as unknown as { wasmMemory?: WebAssembly.Memory };
    delete module.wasmMemory;
    app.connectCpp(registry(), module as unknown as ESEngineModule);
    await expect(app.installCompiledSystems(wasm, built.manifest!))
      .rejects.toThrow(/wasmMemory/);
  });
});
