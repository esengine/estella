import { describe, it, expect, beforeEach } from 'vitest';
import {
    defineComponent,
    defineTag,
    getComponent,
    getUserComponent,
    getComponentDefaults,
    clearUserComponents,
} from '../src/component';

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
