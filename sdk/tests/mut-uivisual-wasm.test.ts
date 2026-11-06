// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Issue #107: walking `Mut(UIVisual)` without writing a thing turned the
 *        colour of every row to NaN, on the web core only, and the element vanished.
 *        A row is written back more than once, and the write rewrote it in place.
 *        Held against every engine component, since the path is shared.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { Transform, builtinComponentRegistry, defineComponent, ensureBuiltinComponentsRegistered } from '../src/ecs/component';
import { Query, Mut } from '../src/ecs/query';
import { defineSystem, Schedule } from '../src/ecs/system';
import { UIVisual } from '../src/ui/core/ui-visual';
import { UINode } from '../src/ui/core/ui-node';
import { uiPlugins } from '../src/app/uiPlugins';
import { numberListFieldsOf } from '../src/ecs/bridge/BuiltinBridge';
import type { ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';
import { log } from '../src/util/logger';

let engine: ESEngineModule;
const apps: App[] = [];
afterEach(() => { for (const app of apps.splice(0)) app.quit(); vi.restoreAllMocks(); });

// The whole catalogue, as the package entry fills it: the typed definitions alone leave out what only the generated metadata names.
ensureBuiltinComponentsRegistered();

const PressScale = defineComponent('MutUIVisualPressScale', { value: 1 });
const RED = { r: 0.25, g: 0.5, b: 0.75, a: 1 };

function rgba(app: App, e: never | number) {
    const { r, g, b, a } = app.world.get(e as never, UIVisual).color;
    return { r, g, b, a };
}

function start(withUI: boolean): App {
    const app = App.new();
    apps.push(app);
    app.connectCpp(new engine.Registry(), engine, { ownedRegistry: true });
    if (withUI) for (const plugin of uiPlugins) app.addPlugin(plugin);
    return app;
}

describe.skipIf(!HAS_WASM)('Mut(UIVisual) on the web core', () => {
    beforeAll(async () => { engine = await loadWasmModule(); });

    it('a walk that writes nothing leaves the colour alone', async () => {
        const app = start(false);
        const e = app.world.spawn();
        app.world.insert(e, Transform, {});
        app.world.insert(e, UIVisual, { color: RED });
        app.world.insert(e, PressScale, {});
        let rows = 0;
        app.addSystemToSchedule(Schedule.Update, defineSystem([Query(Mut(UIVisual), PressScale)], (q) => {
            for (const [, vis] of q) { void vis; rows++; }
        }));
        await app.tick(1 / 60);
        expect(rows).toBe(1);
        expect(rgba(app, e)).toEqual(RED);
    });

    it('nor does it with the UI plugins running, frame after frame', async () => {
        const app = start(true);
        const e = app.world.spawn();
        app.world.insert(e, Transform, {});
        app.world.insert(e, UINode, {});
        app.world.insert(e, UIVisual, { color: RED });
        app.world.insert(e, PressScale, {});
        app.addSystemToSchedule(Schedule.Update, defineSystem([Query(Mut(UIVisual), PressScale)], (q) => {
            for (const [, vis] of q) void vis;
        }));
        for (let i = 0; i < 5; i++) await app.tick(1 / 60);
        expect(rgba(app, e)).toEqual(RED);
    });

    it('and a colour written through the row is the colour read back', async () => {
        const app = start(false);
        const e = app.world.spawn();
        app.world.insert(e, Transform, {});
        app.world.insert(e, UIVisual, { color: RED });
        app.addSystemToSchedule(Schedule.Update, defineSystem([Query(Mut(UIVisual))], (q) => {
            for (const [, vis] of q) vis.color = { r: 0, g: 1, b: 0, a: 0.5 };
        }));
        await app.tick(1 / 60);
        expect(rgba(app, e)).toEqual({ r: 0, g: 1, b: 0, a: 0.5 });
    });

    it('edited after the loop, a kept row still writes colour, and the row keeps its shape', async () => {
        const app = start(false);
        const e = app.world.spawn();
        app.world.insert(e, Transform, {});
        app.world.insert(e, UIVisual, { color: RED });
        let kept: { color: { r: number; g: number; b: number; a: number } } | null = null;
        let afterLoop: unknown = null;
        app.addSystemToSchedule(Schedule.Update, defineSystem([Query(Mut(UIVisual))], (q) => {
            for (const [, vis] of q) kept = vis;
            afterLoop = kept!.color.r;
            kept!.color.g = 0.125;
        }));
        await app.tick(1 / 60);
        expect(afterLoop).toBe(0.25);
        expect(rgba(app, e)).toEqual({ ...RED, g: 0.125 });
    });

    it('a walk that writes nothing changes no engine component, whichever it is', async () => {
        const app = start(false);
        const errors = vi.spyOn(log, 'error');
        const skipped: string[] = [];
        const checked: string[] = [];
        const before = new Map<string, { e: never; def: never; was: string }>();
        for (const [name, def] of builtinComponentRegistry()) {
            const e = app.world.spawn();
            try {
                if (def !== Transform) app.world.insert(e, Transform, {});
                app.world.insert(e, def as never, {} as never);
                before.set(name, { e: e as never, def: def as never, was: JSON.stringify(app.world.get(e, def as never)) });
            } catch {
                skipped.push(name);
                continue;
            }
            app.addSystemToSchedule(Schedule.Update, defineSystem([Query(Mut(def as never))], (q) => {
                for (const [, row] of q as Iterable<[unknown, unknown]>) void row;
            }));
        }
        await app.tick(1 / 60);
        await app.tick(1 / 60);
        const changed: string[] = [];
        for (const [name, { e, def, was }] of before) {
            checked.push(name);
            const now = JSON.stringify(app.world.get(e, def));
            if (now !== was) changed.push(`${name}: ${was} -> ${now}`);
        }
        expect(changed).toEqual([]);
        // A write-back that throws is swallowed by the runner and logged, and leaves the data as it was.
        expect(errors.mock.calls.map((c) => c.map(String).join(' '))).toEqual([]);
        expect(skipped).toEqual([]);
        expect(checked.length).toBeGreaterThan(20);
    });

    /** Every list field of every engine component: read off the same metadata the bridge marshals by, so a new one is covered. */
    function listFields() {
        const out: { name: string; def: never; field: string; values: (a: number, b: number) => number[]; kind: string }[] = [];
        for (const [name, def] of builtinComponentRegistry()) {
            // Kept in step with Parent by the hierarchy system: not the script's to write.
            if (name === 'Children') continue;
            const d = def as unknown as { _cppName: string; _default: Record<string, unknown>; entityFields?: readonly string[] };
            for (const field of numberListFieldsOf(d._cppName)) {
                out.push({ name, def: def as never, field, kind: 'number', values: () => [0.25, 0.5, 0.75] });
            }
            for (const field of d.entityFields ?? []) {
                if (Array.isArray(d._default[field])) {
                    out.push({ name, def: def as never, field, kind: 'entity', values: (a, b) => [a, b] });
                }
            }
        }
        return out;
    }

    it('there are list fields of both kinds to hold this against', () => {
        const kinds = new Set(listFields().map((f) => f.kind));
        expect([...kinds].sort()).toEqual(['entity', 'number']);
    });

    describe('a list field written through a Mut row', () => {
        const row = (app: App, def: never, e: unknown) => app.world.get(e as never, def) as unknown as Record<string, number[]>;

        function setUp(def: never) {
            const app = start(false);
            const errors = vi.spyOn(log, 'error');
            const a = app.world.spawn();
            const b = app.world.spawn();
            const e = app.world.spawn();
            if ((def as unknown) !== Transform) app.world.insert(e, Transform, {});
            app.world.insert(e, def, {} as never);
            return { app, errors, a: a as number, b: b as number, e };
        }

        it.each(listFields().map((f) => [`${f.name}.${f.field}`, f] as const))('%s: a new list is read back', async (_label, f) => {
            const { app, errors, a, b, e } = setUp(f.def);
            const want = f.values(a, b);
            app.addSystemToSchedule(Schedule.Update, defineSystem([Query(Mut(f.def))], (q) => {
                for (const [, r] of q as Iterable<[unknown, Record<string, number[]>]>) r[f.field] = [...want];
            }));
            await app.tick(1 / 60);
            expect(Array.from(row(app, f.def, e)[f.field])).toEqual(want);
            expect(errors).not.toHaveBeenCalled();
        });

        it.each(listFields().map((f) => [`${f.name}.${f.field}`, f] as const))('%s: pushing onto the list a row holds lands, frame after frame', async (_label, f) => {
            const { app, errors, a, b, e } = setUp(f.def);
            const want = f.values(a, b);
            let frame = 0;
            app.addSystemToSchedule(Schedule.Update, defineSystem([Query(Mut(f.def))], (q) => {
                for (const [, r] of q as Iterable<[unknown, Record<string, number[]>]>) {
                    expect(Array.isArray(r[f.field])).toBe(true);
                    if (frame < want.length) r[f.field].push(want[frame]);
                }
                frame++;
            }));
            for (let i = 0; i < want.length + 2; i++) await app.tick(1 / 60);
            expect(Array.from(row(app, f.def, e)[f.field])).toEqual(want);
            expect(errors).not.toHaveBeenCalled();
        });

        it.each(listFields().map((f) => [`${f.name}.${f.field}`, f] as const))('%s: a row kept past the loop still holds an array, and its edit lands', async (_label, f) => {
            const { app, errors, a, b, e } = setUp(f.def);
            const want = f.values(a, b);
            app.addSystemToSchedule(Schedule.Update, defineSystem([Query(Mut(f.def))], (q) => {
                let kept: Record<string, number[]> | null = null;
                for (const [, r] of q as Iterable<[unknown, Record<string, number[]>]>) kept = r;
                // The loop has written it back once by now.
                expect(Array.isArray(kept![f.field])).toBe(true);
                kept![f.field] = [...want];
            }));
            await app.tick(1 / 60);
            expect(Array.from(row(app, f.def, e)[f.field])).toEqual(want);
            expect(errors).not.toHaveBeenCalled();
        });
    });
});
