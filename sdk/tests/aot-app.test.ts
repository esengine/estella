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
import {
    buildAotModule, buildFadeModule, eventManifest, fadeManifest, fadeTaggedManifest,
    keyProbeC, keyProbeManifest, EVENT_C,
    timeScaleManifest, userResManifest, FADE_TAGGED_C, USER_RES_C,
    FADE_PROBE_ALPHA, FADE_PROBE_C, TIME_SCALE_C, useBytesPlatform,
} from './helpers/aotFade';
import { FakeEngine } from './fakeEngine';
import { emccPath } from '../../build-tools/utils/emscripten.js';
import { defineComponent, defineTag } from '../src/ecs/component';
import { defineResource, ResMut, Time } from '../src/ecs/resource';
import { defineEvent, EventReader, EventWriter } from '../src/ecs/event';
import { Input } from '../src/input/input';
import { defineSystem, Schedule } from '../src/ecs/system';
import { Query, Mut } from '../src/ecs/query';
import type { AnyComponentDef } from '../src/ecs/component';
import type { Entity } from '../src/types';

const EMCC = emccPath();
const N = 8;

useBytesPlatform();

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

    it.skipIf(!EMCC)('and says which systems it runs compiled, and how often it dispatched', async () => {
        const { app, Fade } = fadeApp();
        expect(app.compiledSystems).toEqual({ installed: [], calls: 0 });
        await app.useCompiledSystems({ host: new FakeEngine(), manifest: fadeManifest(), wasm: buildFadeModule(EMCC!) });
        seed(app, Fade);
        for (let f = 0; f < 3; f++) await app.tick(1 / 60);
        // Installed is one question and dispatched is another: a module can load
        // and never be reached, and the numbers would not say so.
        expect(app.compiledSystems).toEqual({ installed: ['Fade'], calls: 3 });
    });

    it.skipIf(!EMCC)('writes a ResMut resource back, and leaves a Res one alone', async () => {
        const wasm = buildAotModule(EMCC!, TIME_SCALE_C, 'es_sys_Speed');
        const scaleAfter = async (mut: boolean): Promise<number> => {
            const { app } = bootMockApp();
            app.addSystemToSchedule(Schedule.Update, defineSystem([], () => { /* the twin is the point */ },
                { name: 'Speed' }));
            await app.useCompiledSystems({ host: new FakeEngine(), manifest: timeScaleManifest(mut), wasm });
            await app.tick(1 / 60);
            return app.getResource(Time).scale;
        };
        // A resource is mirrored into the block, so the twin's write reaches the
        // world only if the host copies it back — and only when ResMut asked.
        expect(await scaleAfter(true)).toBe(2);
        expect(await scaleAfter(false)).toBe(1);
    });

    it.skipIf(!EMCC)('mirrors a service question into the bit the twin reads', async () => {
        const wasm = buildAotModule(EMCC!, keyProbeC(), 'es_sys_KeyProbe');
        // Named for the twin: dispatch is by system name, so a mismatch here
        // would quietly run the closure and prove nothing.
        const { app } = bootMockApp();
        const Fade = defineComponent('Fade', { alpha: 1, step: 0.1 }) as AnyComponentDef;
        app.addSystemToSchedule(Schedule.Update, defineSystem([Query(Mut(Fade))], () => {
            /* the twin is the point */
        }, { name: 'KeyProbe' }));
        // The engine's own Input, answering by method — the mirror is what has
        // to turn that into the bit, and nothing else in the suite asks it to.
        const input = app.getResource(Input);
        await app.useCompiledSystems({ host: new FakeEngine(), manifest: keyProbeManifest(), wasm });
        const entities = seed(app, Fade);

        await app.tick(1 / 60);
        expect(alphas(app, Fade, entities).every((a) => a === 0)).toBe(true);

        input.noteKeyDown('KeyW');
        await app.tick(1 / 60);
        expect(alphas(app, Fade, entities).every((a) => a === 1)).toBe(true);

        // And back: a mirror that only ever sets bits would pass the line above.
        input.noteKeyUp('KeyW');
        await app.tick(1 / 60);
        expect(alphas(app, Fade, entities).every((a) => a === 0)).toBe(true);
    });

    it.skipIf(!EMCC)('reaches its rows when the query also filters on a tag', async () => {
        const { app } = bootMockApp();
        const Fade = defineComponent('Fade', { alpha: 1, step: 0.1 }) as AnyComponentDef;
        const Lit = defineTag('Lit') as AnyComponentDef;
        app.addSystemToSchedule(Schedule.Update, defineSystem([Query(Mut(Fade), Lit)], () => {
            /* the twin is the point */
        }, { name: 'FadeTagged' }));
        await app.useCompiledSystems({
            host: new FakeEngine(), manifest: fadeTaggedManifest(),
            wasm: buildAotModule(EMCC!, FADE_TAGGED_C, 'es_sys_FadeTagged'),
        });

        const lit: Entity[] = [];
        const unlit: Entity[] = [];
        for (let i = 1; i <= 4; i++) {
            const e = app.world.spawn();
            app.world.insert(e, Fade, { alpha: 1, step: 0.25 });
            if (i % 2 === 0) { app.world.insert(e, Lit, {}); lit.push(e); } else unlit.push(e);
        }
        await app.tick(1 / 60);

        // A tag carries no address, and a host that read that as "no row" would
        // leave these untouched — which is the same thing an uninstalled twin
        // looks like, so the untagged half is what tells them apart.
        expect(alphas(app, Fade, lit)).toEqual(lit.map(() => 0.75));
        expect(alphas(app, Fade, unlit)).toEqual(unlit.map(() => 1));
    });

    it.skipIf(!EMCC)('walks the payloads a reader was given', async () => {
        const wasm = buildAotModule(EMCC!, EVENT_C, 'es_sys_Absorb');
        const { app } = bootMockApp();
        const Fade = defineComponent('Fade', { alpha: 1, step: 0.1 }) as AnyComponentDef;
        const Hit = defineEvent<{ amount: number }>('Hit', { amount: 0 });
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [EventReader(Hit), Query(Mut(Fade))], () => { /* the twin is the point */ },
            { name: 'Absorb' }));
        await app.useCompiledSystems({ host: new FakeEngine(), manifest: eventManifest('Absorb'), wasm });
        const entities = seed(app, Fade);

        // Sent before a frame, readable during it, gone from the next — and the
        // last half is what says the twin read a buffer, not a list.
        const bus = (app as unknown as { eventRegistry_: { getBus(e: unknown): { send(v: unknown): void } } })
            .eventRegistry_.getBus(Hit);
        bus.send({ amount: 3 });
        bus.send({ amount: 4 });
        await app.tick(1 / 60);
        expect(alphas(app, Fade, entities)).toEqual(entities.map(() => 7));
        await app.tick(1 / 60);
        expect(alphas(app, Fade, entities).every((a) => a === 0)).toBe(true);
    });

    it.skipIf(!EMCC)('and delivers the payloads it appended', async () => {
        const wasm = buildAotModule(EMCC!, EVENT_C, 'es_sys_Emit');
        const { app } = bootMockApp();
        const Fade = defineComponent('Fade', { alpha: 1, step: 0.1 }) as AnyComponentDef;
        const Hit = defineEvent<{ amount: number }>('Sent', { amount: 0 });
        const seen: number[] = [];
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Query(Fade), EventWriter(Hit)], () => { /* the twin is the point */ },
            { name: 'Emit' }));
        // A reader in the same world, interpreted: what the twin sent has to
        // arrive the ordinary way or it went nowhere.
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [EventReader(Hit)], (hits) => { for (const h of hits) seen.push(h.amount); },
            { name: 'Watch' }));
        await app.useCompiledSystems({ host: new FakeEngine(), manifest: eventManifest('Emit'), wasm });
        const entities = seed(app, Fade);

        await app.tick(1 / 60);
        await app.tick(1 / 60);
        // Sent in the first frame and read in the second, on the same bus an
        // interpreted reader walks — the only way they could arrive.
        expect(seen).toEqual(entities.map((_, i) => (i + 1) * 0.1));
    });

    it.skipIf(!EMCC)("reads a resource the PROJECT declared, at the layout the build derived", async () => {
        const wasm = buildAotModule(EMCC!, USER_RES_C, 'es_sys_Tally');
        const { app } = bootMockApp();
        // Declared by the project, not by the engine: nothing in the SDK knows
        // these fields, so the only description of them is the manifest's.
        const Score = defineResource({ step: 3, total: 0 }, 'Score');
        app.insertResource(Score, { step: 3, total: 0 });
        app.addSystemToSchedule(Schedule.Update, defineSystem([ResMut(Score)], () => {
            /* the twin is the point */
        }, { name: 'Tally' }));
        await app.useCompiledSystems({
            host: new FakeEngine(), manifest: userResManifest(['step', 'total']), wasm,
        });

        await app.tick(1 / 60);
        await app.tick(1 / 60);
        expect(app.getResource(Score)).toEqual({ step: 3, total: 6 });
    });

    it.skipIf(!EMCC)('and refuses a module built for a different field order', async () => {
        const { app } = bootMockApp();
        const Score = defineResource({ step: 3, total: 0 }, 'Score');
        app.insertResource(Score, { step: 3, total: 0 });
        // Swapped: same fields, and every one of them at the wrong offset. This
        // is the failure a digest exists for — not an error, a different field.
        await expect(app.useCompiledSystems({
            host: new FakeEngine(), manifest: userResManifest(['total', 'step']),
            wasm: buildAotModule(EMCC!, USER_RES_C, 'es_sys_Tally'),
        })).rejects.toThrow(/Rebuild the project/);
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
