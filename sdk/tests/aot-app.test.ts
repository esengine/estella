// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    aot-app.test.ts
 * @brief   The path a shipped game takes: install on the App, tick, get twins.
 *
 * @details The runner-level gates hand `useAot` a runtime directly. A game host
 *          cannot: an App makes its runner on the FIRST FRAME, while the pool
 *          memory has to be in place before the first pooled component. So the
 *          install is split, and this is the gate on the halves meeting.
 */
import { describe, it, expect } from 'vitest';
import { bootMockApp } from './helpers/mockApp';
import { buildFadeModule, fadeManifest, FADE_PROBE_ALPHA, FADE_PROBE_C } from './helpers/aotFade';
import { FakeEngine } from './fakeEngine';
import { emccPath } from '../../build-tools/utils/emscripten.js';
import { defineComponent } from '../src/ecs/component';
import { defineSystem, Schedule } from '../src/ecs/system';
import { Query, Mut } from '../src/ecs/query';
import type { AnyComponentDef } from '../src/ecs/component';
import type { Entity } from '../src/types';

const EMCC = emccPath();
const N = 8;

/** The same author's system either way; only whether a twin exists differs. */
function fadeApp(): { app: ReturnType<typeof bootMockApp>['app']; Fade: AnyComponentDef } {
    const { app } = bootMockApp();
    const Fade = defineComponent('Fade', { alpha: 1, step: 0.1 }) as AnyComponentDef;
    app.addSystemToSchedule(Schedule.Update, defineSystem([Query(Mut(Fade))], (query) => {
        for (const [, fade] of query as Iterable<[Entity, { alpha: number; step: number }]>) {
            fade.alpha -= fade.step;
        }
    }, { name: 'Fade' }));
    return { app, Fade };
}

function seed(app: ReturnType<typeof bootMockApp>['app'], Fade: AnyComponentDef): Entity[] {
    const out: Entity[] = [];
    for (let i = 1; i <= N; i++) {
        const e = app.world.spawn();
        app.world.insert(e, Fade, { alpha: i * 0.1, step: 0.01 });
        out.push(e);
    }
    return out;
}

const alphas = (app: ReturnType<typeof bootMockApp>['app'], Fade: AnyComponentDef, es: Entity[]): number[] =>
    es.map((e) => (app.world.get(e, Fade) as { alpha: number }).alpha);

describe('an App told to run its compiled twins', () => {
    it('reports whether this gate could run at all', () => {
        if (!EMCC) console.warn('[aot-app] NO EMSDK — the App-level install did NOT run.');
    });

    it.skipIf(!EMCC)('installs before any runner exists, and the first frame uses the twin', async () => {
        const wasm = buildFadeModule(EMCC!);

        const plain = fadeApp();
        const plainEntities = seed(plain.app, plain.Fade);

        const compiled = fadeApp();
        // Before seeding AND before the first tick: no pooled component yet, and
        // no runner yet. Both deadlines are met by the same call.
        await compiled.app.useCompiledSystems({ host: new FakeEngine(), manifest: fadeManifest(), wasm });
        const compiledEntities = seed(compiled.app, compiled.Fade);

        for (let f = 0; f < 4; f++) {
            await plain.app.tick(1 / 60);
            await compiled.app.tick(1 / 60);
        }

        expect(alphas(compiled.app, compiled.Fade, compiledEntities))
            .toEqual(alphas(plain.app, plain.Fade, plainEntities));
        // Two untouched worlds would agree just as well.
        expect(alphas(compiled.app, compiled.Fade, compiledEntities)[0]).not.toBeCloseTo(0.1, 10);
    });

    /**
     * The differential above cannot see this one: with no twin the closure runs
     * and produces the same numbers, so it passes either way. Sabotage-verified
     * by removing the attach — this reddens, that one does not.
     */
    it.skipIf(!EMCC)('and the twin is what ran, not the closure that agrees with it', async () => {
        const { app, Fade } = fadeApp();
        await app.useCompiledSystems({
            host: new FakeEngine(), manifest: fadeManifest(),
            wasm: buildFadeModule(EMCC!, FADE_PROBE_C),
        });
        const entities = seed(app, Fade);
        await app.tick(1 / 60);
        expect(alphas(app, Fade, entities)).toEqual(entities.map(() => FADE_PROBE_ALPHA));
    });

    it.skipIf(!EMCC)('and installing after the runner exists attaches to it too', async () => {
        const { app, Fade } = fadeApp();
        // A frame first, so the runner is already made when the install lands.
        // The probe again: without it the closure's answer passes for the twin's.
        await app.tick(1 / 60);
        await app.useCompiledSystems({
            host: new FakeEngine(), manifest: fadeManifest(),
            wasm: buildFadeModule(EMCC!, FADE_PROBE_C),
        });
        const entities = seed(app, Fade);
        await app.tick(1 / 60);
        expect(alphas(app, Fade, entities)).toEqual(entities.map(() => FADE_PROBE_ALPHA));
    });

    it.skipIf(!EMCC)('refuses a module built for other shapes, and the App keeps interpreting', async () => {
        const { app, Fade } = fadeApp();
        await expect(app.useCompiledSystems({
            host: new FakeEngine(),
            manifest: fadeManifest(/* a shape digest from before `step` existed */ 'deadbeefdeadbeef'),
            wasm: buildFadeModule(EMCC!),
        })).rejects.toThrow(/Rebuild the project/);
        const entities = seed(app, Fade);
        await app.tick(1 / 60);
        expect(alphas(app, Fade, entities)[0]).toBeCloseTo(0.09, 10);
    });
});
