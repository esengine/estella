// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    aot-perf.test.ts
 * @brief   Whether compiling a system is worth anything, asked of the compiler.
 *
 * @details The premise of the whole line, and until now nobody had measured the
 *          COMPILER's output: the Stage 0 benchmark timed a hand transcription
 *          under QuickJS, which answers "would a compiler pay off" and not "does
 *          this one". This runs the emitted module against the author's own
 *          closure, in one process, over one world, under V8 — the jit that
 *          makes the closure as fast as it ever gets.
 *
 *          It is a DIRECTION, not a speedup: a ratio measures the machine as
 *          much as the code, so the bar is only that dispatching to a twin must
 *          not cost more than interpreting. Falling under that would mean the
 *          per-call materialisation had grown past what the loop saves, which is
 *          the regression worth a gate.
 */
import { describe, it, expect } from 'vitest';
import { bootMockApp } from './helpers/mockApp';
import { buildFadeModule, fadeManifest, useBytesPlatform } from './helpers/aotFade';
import { FakeEngine } from './fakeEngine';
import { emccPath } from '../../build-tools/utils/emscripten.js';
import { defineComponent } from '../src/ecs/component';
import { defineSystem, Schedule } from '../src/ecs/system';
import { Query, Mut } from '../src/ecs/query';
import type { AnyComponentDef } from '../src/ecs/component';
import type { Entity } from '../src/types';

const EMCC = emccPath();

useBytesPlatform();
const N = 5000;
const FRAMES = 300;
const WARMUP = 60;

/** The same author's system either way; only whether a twin exists differs. */
function fadeApp(): { app: ReturnType<typeof bootMockApp>['app']; Fade: AnyComponentDef } {
    const { app } = bootMockApp();
    const Fade = defineComponent('Fade', { alpha: 1, step: 0.1 }) as AnyComponentDef;
    app.addSystemToSchedule(Schedule.Update, defineSystem([Query(Mut(Fade))], (query) => {
        for (const [, f] of query as Iterable<[Entity, { alpha: number; step: number }]>) f.alpha -= f.step;
    }, { name: 'Fade' }));
    return { app, Fade };
}

function seed(app: ReturnType<typeof bootMockApp>['app'], Fade: AnyComponentDef): void {
    // A step small enough that 360 frames cannot drive alpha anywhere strange.
    for (let i = 0; i < N; i++) {
        const e = app.world.spawn();
        app.world.insert(e, Fade, { alpha: 1, step: 1e-6 });
    }
}

describe('what compiling a system buys', () => {
    it('reports whether this gate could run at all', () => {
        if (!EMCC) console.warn('[aot-perf] NO EMSDK — the comparison did NOT run.');
    });

    it.skipIf(!EMCC)('dispatching to a twin costs less than interpreting', async () => {
        const compiled = fadeApp();
        await compiled.app.useCompiledSystems({
            host: new FakeEngine(), manifest: fadeManifest(), wasm: buildFadeModule(EMCC!),
        });
        seed(compiled.app, compiled.Fade);
        const plain = fadeApp();
        seed(plain.app, plain.Fade);

        for (let f = 0; f < WARMUP; f++) { await plain.app.tick(1 / 60); await compiled.app.tick(1 / 60); }

        const run = async (app: ReturnType<typeof bootMockApp>['app']): Promise<number> => {
            const t0 = performance.now();
            for (let f = 0; f < FRAMES; f++) await app.tick(1 / 60);
            return performance.now() - t0;
        };
        // Twice each, alternating, and the best of two: a ratio taken once on a
        // shared machine is a coin toss about scheduling.
        const c1 = await run(plain.app), t1 = await run(compiled.app);
        const c2 = await run(plain.app), t2 = await run(compiled.app);
        const closure = Math.min(c1, c2);
        const twin = Math.min(t1, t2);
        console.log(`[aot-perf] ${N} entities, ${FRAMES} frames — closure ${closure.toFixed(1)}ms, `
            + `twin ${twin.toFixed(1)}ms, ratio ${(twin / closure).toFixed(2)}x`);

        // The twin has to have actually run, or this compares a world to itself.
        expect(compiled.app.compiledSystems.calls).toBeGreaterThan(FRAMES);
        expect(twin / closure).toBeLessThan(0.9);
    });
});
