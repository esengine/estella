// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    emscripten-wrapper.test.ts
 * @brief   Diagnostic: verify Object.entries / getter-setter / world.insert
 *          behaviour for Emscripten value-object reference wrappers, exercised
 *          through UINode's nested `Dimension` structs (the UIRect anchor
 *          structs this used to probe were retired in REARCH_GUI F3).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { App } from '../src/app';
import { UINode, type UINodeData } from '../src/ui/core/ui-node';
import type { ESEngineModule, CppRegistry } from '../src/wasm';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';

/** px / auto Dimension literals (unit 0 = Px, 2 = Auto). */
const px = (v: number) => ({ value: v, unit: 0 });
const auto = () => ({ value: 0, unit: 2 });

/** A complete UINode value-object (embind requires every member present). */
function fullNode(over: Partial<UINodeData> = {}): UINodeData {
    return {
        position: 0,
        width: auto(), height: auto(),
        minWidth: auto(), minHeight: auto(),
        maxWidth: auto(), maxHeight: auto(),
        flexGrow: 0, flexShrink: 1, flexBasis: auto(),
        alignSelf: 0,
        marginLeft: px(0), marginTop: px(0), marginRight: px(0), marginBottom: px(0),
        insetLeft: auto(), insetTop: auto(), insetRight: auto(), insetBottom: auto(),
        ...over,
    } as UINodeData;
}

describe.skipIf(!HAS_WASM)('Emscripten wrapper diagnostics', () => {
    let module: ESEngineModule;

    beforeAll(async () => {
        module = await loadWasmModule();
    });

    it('Object.entries on Emscripten getUINode reference wrapper', () => {
        const registry = new module.Registry() as unknown as CppRegistry;
        const entity = registry.create();

        registry.addUINode(entity, fullNode({ width: px(50), height: px(50) }) as never);

        const ref = registry.getUINode(entity);

        // The nested Dimension wrapper must read back via its getter.
        expect(ref.width.value).toBeCloseTo(50, 5);
        expect(ref.width.unit).toBe(0);
        expect(ref.height.value).toBeCloseTo(50, 5);

        // Object.* introspection on the embind reference wrapper must not throw.
        expect(() => Object.entries(ref as unknown as object)).not.toThrow();
        expect(() => Object.keys(ref as unknown as object)).not.toThrow();
        expect(() => Object.getOwnPropertyNames(ref as unknown as object)).not.toThrow();

        registry.destroy(entity);
        (registry as unknown as { delete(): void }).delete();
    });

    it('world.insert with Emscripten wrapper preserves values', () => {
        const app = App.new();
        const registry = new module.Registry() as unknown as CppRegistry;
        app.connectCpp(registry, module);

        const world = app.world;
        const entity = world.spawn();

        world.insert(entity, UINode, fullNode());

        const ref = world.get(entity, UINode) as UINodeData;

        // Modify nested struct fields via the wrapper setters.
        ref.width = px(120);
        ref.height = px(64);
        ref.position = 1;

        expect(ref.width.value).toBeCloseTo(120, 5);

        // Re-insert the wrapper and read back: values must survive the round-trip.
        world.insert(entity, UINode, ref);

        const after = world.get(entity, UINode) as UINodeData;
        expect(after.width.value).toBeCloseTo(120, 5);
        expect(after.width.unit).toBe(0);
        expect(after.height.value).toBeCloseTo(64, 5);
        expect(after.position).toBe(1);

        world.despawn(entity);
        world.disconnectCpp();
        (registry as unknown as { delete(): void }).delete();
    });

    it('nested field modification on Emscripten wrapper', () => {
        const registry = new module.Registry() as unknown as CppRegistry;
        const entity = registry.create();

        registry.addUINode(entity, fullNode({ width: px(200), height: px(200) }) as never);

        const ref = registry.getUINode(entity);

        // Mutating a nested member in place writes to a COPY, not C++ memory…
        ref.width.value = 0.7;

        // …whereas assigning a whole Dimension struct writes through.
        ref.width = px(140);

        expect(ref.width.value).toBeCloseTo(140, 5);
        expect(ref.width.unit).toBe(0);

        registry.destroy(entity);
        (registry as unknown as { delete(): void }).delete();
    });

    // REARCH_GUI F5: a std::vector<VisualState> component field must round-trip a
    // plain JS array through embind (register_vector + value_object), incl. the
    // std::string member. This is the path the button/dropdown widgets exercise.
    it('round-trips a std::vector<VisualState> through embind', () => {
        const registry = new module.Registry() as unknown as CppRegistry;
        const entity = registry.create();

        const reg = registry as unknown as {
            addStateVisuals(e: number, c: unknown): void;
            getStateVisuals(e: number): { states: unknown };
        };
        reg.addStateVisuals(entity, {
            targetGraphic: 0,
            transitionFlags: 1,
            fadeDuration: 0.5,
            states: [
                { name: 'normal', r: 1, g: 0, b: 0, a: 1, sprite: 0, scale: 1 },
                { name: 'hover', r: 0, g: 1, b: 0, a: 1, sprite: 7, scale: 1.25 },
            ],
        });

        const states = reg.getStateVisuals(entity).states as
            | Array<Record<string, number | string>>
            | { size(): number; get(i: number): Record<string, number | string> };
        // embind may hand back a plain array or a bound vector — accept both.
        const isArr = Array.isArray(states);
        const len = isArr ? (states as unknown[]).length : (states as { size(): number }).size();
        const at = (i: number) => isArr
            ? (states as Array<Record<string, number | string>>)[i]
            : (states as { get(i: number): Record<string, number | string> }).get(i);

        expect(len).toBe(2);
        expect(at(0).name).toBe('normal');
        expect(at(0).r).toBeCloseTo(1, 5);
        expect(at(1).name).toBe('hover');
        expect(at(1).sprite).toBe(7);
        expect(at(1).scale).toBeCloseTo(1.25, 5);

        registry.destroy(entity);
        (registry as unknown as { delete(): void }).delete();
    });
});
