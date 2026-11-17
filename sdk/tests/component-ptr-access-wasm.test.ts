// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../src/app/app';
import {
    ensureBuiltinComponentsRegistered, getComponent, isBuiltinComponent,
    type BuiltinComponentDef,
} from '../src/ecs/component';
import { builtinFromWasm } from '../src/ecs/bridge/BuiltinBridge';
import { PTR_LAYOUTS, type PtrLayout } from '../src/wasm/ptrLayouts.generated';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

type Bag = Record<string, unknown>;

let engine: ESEngineModule;
const apps: App[] = [];
afterEach(() => { for (const app of apps.splice(0)) app.quit(); });

const WEB_PTR = Object.entries(PTR_LAYOUTS).filter(([, l]) => l.ptrFn).map(([n]) => n);

function perturbed(layout: PtrLayout, current: Bag, embindShape: boolean): Bag {
    const out: Bag = { ...current };
    layout.fields.forEach((f, i) => {
        const k = i + 1;
        const v = (n: number) => k + n * 0.25;
        switch (f.type) {
            case 'f32': out[f.name] = v(0.5); break;
            case 'i32': out[f.name] = -(k + 1); break;
            case 'u32': out[f.name] = k + 3; break;
            case 'bool': out[f.name] = !current[f.name]; break;
            case 'u8': out[f.name] = current[f.name] === 1 ? 2 : 1; break;
            case 'vec2': out[f.name] = { x: v(1), y: v(2) }; break;
            case 'uvec2': out[f.name] = { x: k + 640, y: k + 360 }; break;
            case 'vec3': out[f.name] = { x: v(1), y: v(2), z: v(3) }; break;
            case 'vec4':
            case 'quat': out[f.name] = { x: v(1), y: v(2), z: v(3), w: v(4) }; break;
            case 'color': out[f.name] = embindShape
                ? { x: 0.25, y: 0.5, z: 0.75, w: 1 }
                : { r: 0.25, g: 0.5, b: 0.75, a: 1 }; break;
            case 'struct': {
                const s: Bag = {};
                f.members!.forEach((m, j) => { s[m.name] = m.type === 'f32' ? v(j + 1) : j + 1; });
                out[f.name] = s;
                break;
            }
        }
    });
    return out;
}

function mismatches(ptr: Bag, embind: Bag): string[] {
    const bad: string[] = [];
    const keys = (o: Bag) => Object.keys(o).sort().join(',');
    if (keys(ptr) !== keys(embind)) bad.push(`fields: pointer [${keys(ptr)}] vs embind [${keys(embind)}]`);
    for (const [k, pv] of Object.entries(ptr)) {
        const ev = embind[k];
        if (pv && typeof pv === 'object') {
            for (const [mk, mv] of Object.entries(pv as Bag)) {
                const e = (ev as Bag | undefined)?.[mk];
                if (e !== mv) bad.push(`${k}.${mk}: pointer ${String(mv)} vs embind ${String(e)}`);
            }
        } else if (pv !== ev) {
            bad.push(`${k}: pointer ${String(pv)} vs embind ${String(ev)}`);
        }
    }
    return bad;
}

describe.skipIf(!HAS_WASM)('engine component pointer access', () => {
    beforeAll(async () => {
        engine = await loadWasmModule();
        ensureBuiltinComponentsRegistered();
    });

    it('the engine exports get<C>Ptr for exactly the layouts that carry one', () => {
        const mod = engine as unknown as Record<string, unknown>;
        const names = (mod.getBuiltinComponentNames as () => string[])();
        expect(names.length).toBeGreaterThan(WEB_PTR.length);
        const wrong = names.filter((n) =>
            (typeof mod[`get${n}Ptr`] === 'function') !== Boolean(PTR_LAYOUTS[n]?.ptrFn));
        expect(wrong).toEqual([]);
        expect(WEB_PTR).toContain('UIInteraction');
        expect(WEB_PTR).toContain('RigidBody3D');
        expect(WEB_PTR).not.toContain('SpineAnimation');
    });

    it.each(WEB_PTR)('%s reads and writes through the heap as embind does', (name) => {
        const def = getComponent(name);
        expect(def && isBuiltinComponent(def)).toBe(true);
        const comp = def as BuiltinComponentDef<Bag>;
        const layout = PTR_LAYOUTS[name]!;

        const app = App.new();
        apps.push(app);
        app.connectCpp(new engine.Registry() as unknown as CppRegistry, engine, { ownedRegistry: true });
        const world = app.world;
        const registry = world.getCppRegistry() as unknown as Record<string, (...a: unknown[]) => Bag>;
        const e = world.spawn();
        world.insert(e, comp, {});

        const read = world.builtin.resolvePtrGetter(name, 'retained');
        const write = world.builtin.resolvePtrSetter(name);
        expect(read).toBeTypeOf('function');
        expect(write).toBeTypeOf('function');
        const viaEmbind = () => builtinFromWasm(registry[`get${name}`](e), comp) as Bag;

        registry[`add${name}`](e, perturbed(layout, registry[`get${name}`](e), true));
        expect(mismatches(read!(e) as Bag, viaEmbind())).toEqual([]);

        const written = perturbed(layout, read!(e) as Bag, false);
        write!(e, written);
        const afterWrite = read!(e) as Bag;
        expect(mismatches(afterWrite, written)).toEqual([]);
        expect(mismatches(afterWrite, viaEmbind())).toEqual([]);
    });

    it.each(WEB_PTR)('world.get and tryGet of %s read the heap, not the embind getter', (name) => {
        const comp = getComponent(name) as BuiltinComponentDef<Bag>;
        const app = App.new();
        apps.push(app);
        app.connectCpp(new engine.Registry() as unknown as CppRegistry, engine, { ownedRegistry: true });
        const world = app.world;
        const registry = world.getCppRegistry() as unknown as Record<string, (...a: unknown[]) => Bag>;
        const e = world.spawn();
        const bare = world.spawn();
        world.insert(e, comp, {});
        registry[`add${name}`](e, perturbed(PTR_LAYOUTS[name]!, registry[`get${name}`](e), true));
        const expected = builtinFromWasm(registry[`get${name}`](e), comp) as Bag;

        const getter = Object.getPrototypeOf(registry) as Record<string, (...a: unknown[]) => Bag>;
        const original = getter[`get${name}`];
        let embindReads = 0;
        getter[`get${name}`] = function (this: unknown, ...a: unknown[]) { embindReads++; return original.apply(this, a); };
        // The bridge bound the getter when it first resolved the component; a fresh connection binds the counted one.
        world.builtin.connect(world.getCppRegistry()!, engine);
        try {
            const got = world.get(e, comp) as Bag;
            const tried = world.tryGet(e, comp) as Bag;
            expect(mismatches(got, expected)).toEqual([]);
            expect(mismatches(tried, expected)).toEqual([]);
            // Each read is the caller's own: a second one must not refill the first.
            expect(got).not.toBe(tried);
            expect(world.tryGet(bare, comp)).toBeNull();
            expect(embindReads).toBe(0);
        } finally {
            getter[`get${name}`] = original;
        }
    });
});
