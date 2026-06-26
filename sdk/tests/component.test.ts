// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeEach } from 'vitest';
import {
    defineComponent,
    defineBuiltin,
    defineTag,
    getComponent,
    getComponentFieldMeta,
    getUserComponent,
    getUserComponents,
    getComponentRegistry,
    getAllRegisteredComponents,
    getComponentDefaults,
    clearUserComponents,
    unregisterComponent,
    enumOptions,
    Camera,
    ProjectionType,
} from '../src/component';
import { AppContext, getDefaultContext, setDefaultContext } from '../src/context';

describe('Component Registry', () => {
    beforeEach(() => {
        clearUserComponents();
    });

    describe('defineComponent', () => {
        it('should create a component with defaults', () => {
            const TestComponent = defineComponent('TestComponent', {
                value: 0,
                name: 'test',
            });

            expect(TestComponent._name).toBe('TestComponent');
            expect(TestComponent._default).toEqual({ value: 0, name: 'test' });
        });

        it('should create a component without defaults', () => {
            const SimpleTag = defineComponent('SimpleTag', {});

            expect(SimpleTag._name).toBe('SimpleTag');
            expect(SimpleTag._default).toEqual({});
        });

        it('should register component in user registry', () => {
            const Custom = defineComponent('Custom', { x: 1 });

            const retrieved = getUserComponent('Custom');
            expect(retrieved).toBe(Custom);
        });

        it('should reuse existing component on duplicate names', () => {
            const comp1 = defineComponent('Duplicate', { a: 1 });
            const comp2 = defineComponent('Duplicate', { b: 2 });

            expect(comp1).toBe(comp2);
        });
    });

    describe('defineTag', () => {
        it('should create a tag component with empty defaults', () => {
            const TestTag = defineTag('TestTag');

            expect(TestTag._name).toBe('TestTag');
            expect(TestTag._default).toEqual({});
        });

        it('should register tag in user registry', () => {
            const MyTag = defineTag('MyTag');

            const retrieved = getUserComponent('MyTag');
            expect(retrieved).toBe(MyTag);
        });
    });

    describe('getComponent', () => {
        it('should retrieve user-defined components', () => {
            const Custom = defineComponent('Custom', { x: 1 });

            const retrieved = getComponent('Custom');
            expect(retrieved).toBe(Custom);
        });

        it('should return undefined for unknown components', () => {
            const result = getComponent('NonExistent');
            expect(result).toBeUndefined();
        });

        it('should prioritize user components over builtins', () => {
            const Custom = defineComponent('CustomOverride', { custom: true });

            const retrieved = getComponent('CustomOverride');
            expect(retrieved).toBe(Custom);
        });
    });

    describe('getUserComponent', () => {
        it('should retrieve only user-defined components', () => {
            const Custom = defineComponent('Custom', { x: 1 });

            const retrieved = getUserComponent('Custom');
            expect(retrieved).toBe(Custom);
        });

        it('should return undefined for builtins', () => {
            const result = getUserComponent('Transform');
            expect(result).toBeUndefined();
        });

        it('should return undefined for unknown components', () => {
            const result = getUserComponent('NonExistent');
            expect(result).toBeUndefined();
        });
    });

    describe('getComponentDefaults', () => {
        it('should return defaults for user components', () => {
            defineComponent('WithDefaults', { x: 10, y: 20 });

            const defaults = getComponentDefaults('WithDefaults');
            expect(defaults).toEqual({ x: 10, y: 20 });
        });

        it('should return empty object for tags', () => {
            defineTag('EmptyTag');

            const defaults = getComponentDefaults('EmptyTag');
            expect(defaults).toEqual({});
        });

        it('should return null for unknown components', () => {
            const defaults = getComponentDefaults('Unknown');
            expect(defaults).toBeNull();
        });
    });

    describe('component reuse', () => {
        it('should reuse component on duplicate names', () => {
            const comp1 = defineComponent('Reusable', { x: 1 });
            const comp2 = defineComponent('Reusable', { y: 2 });

            expect(comp1).toBe(comp2);
        });
    });

    describe('clearUserComponents', () => {
        it('should clear all user-defined components', () => {
            defineComponent('Comp1', { x: 1 });
            defineComponent('Comp2', { y: 2 });
            defineTag('Tag1');

            clearUserComponents();

            expect(getUserComponent('Comp1')).toBeUndefined();
            expect(getUserComponent('Comp2')).toBeUndefined();
            expect(getUserComponent('Tag1')).toBeUndefined();
        });

        it('should allow re-registration after clear', () => {
            defineComponent('Reusable', { v: 1 });
            clearUserComponents();

            const NewReusable = defineComponent('Reusable', { v: 2 });

            const retrieved = getUserComponent('Reusable');
            expect(retrieved).toBe(NewReusable);
            expect(retrieved?._default).toEqual({ v: 2 });
        });
    });

    describe('component defaults cloning', () => {
        it('should return cloned defaults each time', () => {
            const Comp = defineComponent('Shared', { items: [] as number[] });

            const defaults1 = getComponentDefaults('Shared');
            const defaults2 = getComponentDefaults('Shared');

            expect(defaults1).not.toBe(defaults2);
            expect(defaults1).toEqual(defaults2);
        });
    });

    describe('name collision detection', () => {
        it('should throw when defineComponent collides with a builtin', () => {
            expect(() => defineComponent('Transform', { x: 0 })).toThrow(
                /Component name collision.*"Transform".*builtin/
            );
        });

        it('should throw when defineTag collides with a builtin', () => {
            expect(() => defineTag('Sprite')).toThrow(
                /Component name collision.*"Sprite".*builtin/
            );
        });

        it('should throw when defineBuiltin collides with a user component', () => {
            defineComponent('MyCustom', { v: 1 });
            try {
                expect(() => defineBuiltin('MyCustom', { v: 2 })).toThrow(
                    /Component name collision.*"MyCustom".*user/
                );
            } finally {
                unregisterComponent('MyCustom');
            }
        });

        it('should allow idempotent re-registration of the same builtin', () => {
            const first = defineBuiltin('TestBuiltin', { a: 1 });
            const second = defineBuiltin('TestBuiltin', { a: 1 });
            expect(first).toBe(second);
            unregisterComponent('TestBuiltin');
        });
    });

    describe('complex scenarios', () => {
        it('should handle many components', () => {
            for (let i = 0; i < 100; i++) {
                defineComponent(`Comp${i}`, { index: i });
            }

            const comp50 = getComponent('Comp50');
            expect(comp50?._default).toEqual({ index: 50 });
        });

        it('should handle mixed tags and components', () => {
            const Tag1 = defineTag('Tag1');
            const Comp1 = defineComponent('Comp1', { x: 1 });
            const Tag2 = defineTag('Tag2');
            const Comp2 = defineComponent('Comp2', { y: 2 });

            expect(getUserComponent('Tag1')).toBe(Tag1);
            expect(getUserComponent('Comp1')).toBe(Comp1);
            expect(getUserComponent('Tag2')).toBe(Tag2);
            expect(getUserComponent('Comp2')).toBe(Comp2);
        });
    });
});

// Two-tier registry invariants: builtins are GLOBAL (one module-level registry),
// user components are PER-CONTEXT (AppContext) and must not leak across contexts.
describe('Component registry tiers (builtins global, user per-context)', () => {
    beforeEach(() => clearUserComponents());

    it('getComponentRegistry merges builtins + the current context user components', () => {
        const Builtin = defineBuiltin('TierBuiltin', { v: 0 });
        const User = defineComponent('TierUser', { v: 0 });

        const all = getComponentRegistry();
        expect(all.get('TierBuiltin')).toBe(Builtin);
        expect(all.get('TierUser')).toBe(User);
        // getAllRegisteredComponents is an alias of the complete view.
        expect(getAllRegisteredComponents().get('TierBuiltin')).toBe(Builtin);
        // getComponent resolves both tiers.
        expect(getComponent('TierBuiltin')).toBe(Builtin);
        expect(getComponent('TierUser')).toBe(User);
    });

    it('getUserComponents excludes builtins', () => {
        defineBuiltin('TierBuiltin2', { v: 0 });
        const User = defineComponent('TierUser2', { v: 0 });
        const users = getUserComponents();
        expect(users.get('TierUser2')).toBe(User);
        expect(users.has('TierBuiltin2')).toBe(false);
    });

    it('user components do NOT leak across contexts; builtins stay global', () => {
        const Builtin = defineBuiltin('TierBuiltinGlobal', { v: 0 });
        defineComponent('TierUserA', { v: 0 });
        expect(getComponentRegistry().has('TierUserA')).toBe(true);

        const original = getDefaultContext();
        setDefaultContext(new AppContext());
        try {
            // Fresh context: the user component is isolated (no leak)…
            expect(getComponentRegistry().has('TierUserA')).toBe(false);
            expect(getUserComponents().has('TierUserA')).toBe(false);
            // …but the builtin is still globally visible.
            expect(getComponent('TierBuiltinGlobal')).toBe(Builtin);
            expect(getComponentRegistry().has('TierBuiltinGlobal')).toBe(true);
        } finally {
            setDefaultContext(original);
        }

        // Restored context still has the original user component.
        expect(getComponentRegistry().has('TierUserA')).toBe(true);
    });
});

describe('Field metadata (editor presentation policy)', () => {
    beforeEach(() => {
        clearUserComponents();
    });

    it('enumOptions derives label→value pairs from a const, dropping value aliases', () => {
        const opts = enumOptions(ProjectionType);
        expect(opts).toEqual(
            expect.arrayContaining([{ label: 'Perspective', value: 0 }, { label: 'Orthographic', value: 1 }]),
        );

        // Alias members sharing a value collapse to the first label.
        const aliased = enumOptions({ A: 0, B: 1, BAlias: 1 });
        expect(aliased).toEqual([{ label: 'A', value: 0 }, { label: 'B', value: 1 }]);

        // A TS numeric enum's reverse (value→name) entries are not options.
        expect(enumOptions({ Normal: 0, '0': 'Normal' } as Record<string, unknown>)).toEqual([
            { label: 'Normal', value: 0 },
        ]);
    });

    it('a builtin exposes enum + numeric field metadata; the runtime never reads it', () => {
        const meta = getComponentFieldMeta('Camera');
        expect(meta.projectionType?.enum).toEqual(enumOptions(ProjectionType));
        expect(Camera.fieldMeta.projectionType?.enum).toBe(meta.projectionType?.enum);
        // Numeric range/unit policy rides the same channel.
        expect(meta.fov).toMatchObject({ min: 1, max: 179, unit: '°' });
        expect(meta.orthoSize).toEqual({ min: 0 });
        // An unannotated field carries no metadata at all.
        expect(meta.isActive).toBeUndefined();
    });

    it('a user component declares its own field metadata', () => {
        const Mover = defineComponent('Mover', { mode: 0 }, {
            fields: { mode: { enum: [{ label: 'Walk', value: 0 }, { label: 'Run', value: 1 }] } },
        });
        expect(Mover.fieldMeta.mode?.enum?.map((o) => o.label)).toEqual(['Walk', 'Run']);
        expect(getComponentFieldMeta('Mover').mode?.enum?.[1]).toEqual({ label: 'Run', value: 1 });
    });

    it('a component without metadata returns an empty map', () => {
        defineComponent('Plain', { hp: 100 });
        expect(getComponentFieldMeta('Plain')).toEqual({});
        expect(getComponentFieldMeta('Nonexistent')).toEqual({});
    });
});
