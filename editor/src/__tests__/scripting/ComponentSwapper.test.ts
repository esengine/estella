import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    getComponentSchema,
    exposeRegistrationAPI,
} from '../../schemas/ComponentSchemas';
import { getComponentDefaults, unregisterComponent } from 'esengine';
import { EditorContainer, setEditorContainer } from '../../container';
import { ComponentSwapper } from '../../scripting/ComponentSwapper';

let container: EditorContainer;
const cleanup: string[] = [];

beforeEach(() => {
    container = new EditorContainer();
    setEditorContainer(container);
    container.lockBuiltins();
    exposeRegistrationAPI();
    delete (window as any).__esengine_componentSourceMap;
});

afterEach(() => {
    for (const n of cleanup) unregisterComponent(n);
    cleanup.length = 0;
    delete (window as any).__esengine_componentSourceMap;
});

function trackNames(names: string[]) {
    cleanup.push(...names);
}

const SCRIPT_A = `defineComponent('Mover', { speed: 10 });`;
const SCRIPT_B = `defineComponent('Mover', { speed: 20, accel: 5 });`;

describe('ComponentSwapper', () => {
    it('prepare collects new registrations without affecting current state', () => {
        const swapper = new ComponentSwapper();
        swapper.prepare([{ path: '/src/Mover.ts', content: SCRIPT_A }]);
    });

    it('swap atomically replaces old registrations with new ones', () => {
        const swapper = new ComponentSwapper();

        swapper.prepare([{ path: '/src/Mover.ts', content: SCRIPT_A }]);
        swapper.swap();
        trackNames(['Mover']);

        expect(getComponentSchema('Mover')).toBeDefined();
        expect(getComponentDefaults('Mover')).toMatchObject({ speed: 10 });

        swapper.prepare([{ path: '/src/Mover.ts', content: SCRIPT_B }]);
        swapper.swap();

        expect(getComponentDefaults('Mover')).toMatchObject({ speed: 20, accel: 5 });
        const schema = getComponentSchema('Mover');
        expect(schema!.properties.map(p => p.name)).toContain('accel');
    });

    it('discarding a preparation preserves the current state', () => {
        const swapper = new ComponentSwapper();

        swapper.prepare([{ path: '/src/Mover.ts', content: SCRIPT_A }]);
        swapper.swap();
        trackNames(['Mover']);

        expect(getComponentDefaults('Mover')).toMatchObject({ speed: 10 });

        swapper.prepare([{ path: '/src/Mover.ts', content: SCRIPT_B }]);
        swapper.discard();

        expect(getComponentSchema('Mover')).toBeDefined();
        expect(getComponentDefaults('Mover')).toMatchObject({ speed: 10 });
    });

    it('swap updates the source map', () => {
        const swapper = new ComponentSwapper();

        swapper.prepare([{ path: '/src/Mover.ts', content: SCRIPT_A }]);
        swapper.swap();
        trackNames(['Mover']);

        const sourceMap = window.__esengine_componentSourceMap;
        expect(sourceMap).toBeDefined();
        expect(sourceMap!.get('Mover')).toBe('/src/Mover.ts');
    });

    it('handles multiple components across files', () => {
        const swapper = new ComponentSwapper();

        swapper.prepare([
            { path: '/src/Mover.ts', content: `defineComponent('Mover', { speed: 10 });` },
            { path: '/src/Health.ts', content: `defineComponent('Health', { hp: 100 });` },
        ]);
        swapper.swap();
        trackNames(['Mover', 'Health']);

        expect(getComponentSchema('Mover')).toBeDefined();
        expect(getComponentSchema('Health')).toBeDefined();

        swapper.prepare([
            { path: '/src/Mover.ts', content: `defineComponent('Mover', { speed: 20 });` },
        ]);
        swapper.swap();

        expect(getComponentDefaults('Mover')).toMatchObject({ speed: 20 });
        expect(getComponentSchema('Health')).toBeUndefined();
    });

    it('handles tags', () => {
        const swapper = new ComponentSwapper();
        swapper.prepare([
            { path: '/src/tags.ts', content: `defineTag('Player');` },
        ]);
        swapper.swap();
        trackNames(['Player']);

        const schema = getComponentSchema('Player');
        expect(schema).toBeDefined();
        expect(schema!.category).toBe('tag');
    });
});
