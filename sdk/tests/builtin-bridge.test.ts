/**
 * @file    builtin-bridge.test.ts
 * @brief   Ensure BuiltinBridge eagerly verifies all component bindings at
 *          connect time and surfaces drift between the C++ Registry and the
 *          generated component metadata in one diagnostic.
 */
import { describe, expect, it } from 'vitest';
import { BuiltinBridge } from '../src/ecs/BuiltinBridge';
import { COMPONENT_META } from '../src/component.generated';
import type { CppRegistry, ESEngineModule } from '../src/wasm';

function stubMethod() { return undefined; }

/** Build a fake CppRegistry that satisfies COMPONENT_META. */
function makeCompleteRegistry(): Record<string, (...args: unknown[]) => unknown> {
    const reg: Record<string, (...args: unknown[]) => unknown> = {};
    for (const name of Object.keys(COMPONENT_META)) {
        for (const prefix of ['add', 'get', 'has', 'remove']) {
            reg[`${prefix}${name}`] = stubMethod;
        }
    }
    return reg;
}

describe('BuiltinBridge', () => {
    it('connects successfully in strict mode when every component has all four methods', () => {
        const bridge = new BuiltinBridge();
        const reg = makeCompleteRegistry() as unknown as CppRegistry;

        expect(() => { bridge.connect(reg, undefined, { strict: true }); }).not.toThrow();
        expect(bridge.hasCpp).toBe(true);
        expect(bridge.verify().ok).toBe(true);
    });

    it('throws an aggregated error in strict mode listing every missing method', () => {
        const bridge = new BuiltinBridge();
        const reg = makeCompleteRegistry();
        const firstName = Object.keys(COMPONENT_META)[0];
        const secondName = Object.keys(COMPONENT_META)[1];
        if (!firstName || !secondName) {
            throw new Error('COMPONENT_META fixture is empty — test cannot run');
        }

        delete reg[`add${firstName}`];
        delete reg[`remove${firstName}`];
        delete reg[`get${secondName}`];

        let caught: Error | null = null;
        try {
            bridge.connect(reg as unknown as CppRegistry, undefined, { strict: true });
        } catch (e) {
            caught = e as Error;
        }

        expect(caught).not.toBeNull();
        expect(caught!.message).toContain(firstName);
        expect(caught!.message).toContain(`add${firstName}`);
        expect(caught!.message).toContain(`remove${firstName}`);
        expect(caught!.message).toContain(secondName);
        expect(caught!.message).toContain(`get${secondName}`);
        expect(caught!.message).not.toContain(`has${firstName}`);
    });

    it('does not throw on missing bindings in non-strict mode (default)', () => {
        const bridge = new BuiltinBridge();
        const reg = makeCompleteRegistry();
        const firstName = Object.keys(COMPONENT_META)[0];
        if (!firstName) throw new Error('COMPONENT_META fixture is empty');
        delete reg[`add${firstName}`];

        expect(() => { bridge.connect(reg as unknown as CppRegistry); }).not.toThrow();
        expect(bridge.hasCpp).toBe(true);
        expect(bridge.verify().ok).toBe(false);
    });

    it('leaves the bridge disconnected after a failed strict connect', () => {
        const bridge = new BuiltinBridge();
        const reg = makeCompleteRegistry();
        const firstName = Object.keys(COMPONENT_META)[0];
        if (!firstName) throw new Error('COMPONENT_META fixture is empty');
        delete reg[`add${firstName}`];

        expect(() => { bridge.connect(reg as unknown as CppRegistry, undefined, { strict: true }); }).toThrow();
        expect(bridge.hasCpp).toBe(false);
        expect(bridge.getCppRegistry()).toBeNull();
    });

    it('resets cached state on disconnect', () => {
        const bridge = new BuiltinBridge();
        const reg = makeCompleteRegistry() as unknown as CppRegistry;
        bridge.connect(reg, undefined, { strict: true });

        bridge.disconnect();

        expect(bridge.hasCpp).toBe(false);
        expect(bridge.getCppRegistry()).toBeNull();
        expect(bridge.verify().ok).toBe(false);
    });

    it('caches bound methods so getBuiltinMethods returns the same handle', () => {
        const bridge = new BuiltinBridge();
        const reg = makeCompleteRegistry() as unknown as CppRegistry;
        bridge.connect(reg, undefined, { strict: true });

        const firstName = Object.keys(COMPONENT_META)[0];
        if (!firstName) throw new Error('COMPONENT_META fixture is empty');

        const m1 = bridge.getBuiltinMethods(firstName);
        const m2 = bridge.getBuiltinMethods(firstName);
        expect(m1).toBe(m2);
    });

    it('throws a descriptive error when getBuiltinMethods is called before connect', () => {
        const bridge = new BuiltinBridge();
        expect(() => bridge.getBuiltinMethods('Transform')).toThrow(/before connect/);
    });

    // -------------------------------------------------------------------------
    // Reflection-table drift detection (requires the WASM module to expose
    // getBuiltinComponentNames() — absent on older builds; present on all
    // builds produced by the current EHT generator).
    // -------------------------------------------------------------------------

    it('verify().ok is true when WASM reflection matches COMPONENT_META', () => {
        const bridge = new BuiltinBridge();
        const reg = makeCompleteRegistry() as unknown as CppRegistry;
        const module = {
            getBuiltinComponentNames: () => Object.keys(COMPONENT_META),
        } as unknown as ESEngineModule;

        bridge.connect(reg, module, { strict: true });
        const v = bridge.verify();
        expect(v.ok).toBe(true);
        expect(v.wasmOnly).toEqual([]);
        expect(v.sdkOnly).toEqual([]);
    });

    it('reports wasmOnly components when WASM exposes one the SDK does not know', () => {
        const bridge = new BuiltinBridge();
        const reg = makeCompleteRegistry();
        // Add a hypothetical component the SDK hasn't heard of. The registry must
        // expose its four methods too or strict verification of SDK components
        // wouldn't be the source of the drift report.
        for (const p of ['add', 'get', 'has', 'remove']) {
            reg[`${p}FutureThing`] = stubMethod;
        }
        const module = {
            getBuiltinComponentNames: () => [...Object.keys(COMPONENT_META), 'FutureThing'],
        } as unknown as ESEngineModule;

        const caught = (() => {
            try {
                bridge.connect(reg as unknown as CppRegistry, module, { strict: true });
                return null;
            } catch (e) { return e as Error; }
        })();

        expect(caught).not.toBeNull();
        expect(caught!.message).toContain('WASM exposes components not in');
        expect(caught!.message).toContain('FutureThing');
    });

    it('reports sdkOnly components when COMPONENT_META has one the WASM does not', () => {
        const bridge = new BuiltinBridge();
        const reg = makeCompleteRegistry() as unknown as CppRegistry;
        const firstName = Object.keys(COMPONENT_META)[0];
        if (!firstName) throw new Error('COMPONENT_META fixture is empty');
        const module = {
            // WASM reports everything except the first name.
            getBuiltinComponentNames: () => Object.keys(COMPONENT_META).slice(1),
        } as unknown as ESEngineModule;

        const caught = (() => {
            try {
                bridge.connect(reg, module, { strict: true });
                return null;
            } catch (e) { return e as Error; }
        })();

        expect(caught).not.toBeNull();
        expect(caught!.message).toContain('SDK\'s COMPONENT_META lists components the WASM does not');
        expect(caught!.message).toContain(firstName);
    });

    it('skips reflection cross-check when the module lacks getBuiltinComponentNames', () => {
        // Older WASM builds won't have the reflection export. The bridge must
        // still connect successfully as long as method-level verification passes.
        const bridge = new BuiltinBridge();
        const reg = makeCompleteRegistry() as unknown as CppRegistry;
        const module = {} as unknown as ESEngineModule;

        expect(() => { bridge.connect(reg, module, { strict: true }); }).not.toThrow();
        const v = bridge.verify();
        expect(v.ok).toBe(true);
        expect(v.wasmOnly).toEqual([]);
        expect(v.sdkOnly).toEqual([]);
    });
});
