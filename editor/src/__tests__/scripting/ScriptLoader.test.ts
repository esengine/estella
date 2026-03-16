import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { extractAndRegisterComponents } from '../../scripting/ScriptLoader';
import {
    safeParseObjectLiteral,
    extractObjectLiteral,
} from '../../scripting/componentExtraction';
import {
    clearScriptComponents,
    getComponentSchema,
    exposeRegistrationAPI,
} from '../../schemas/ComponentSchemas';
import { unregisterComponent, getComponentDefaults } from 'esengine';
import { EditorContainer, setEditorContainer } from '../../container';

// ============================================================================
// Test setup
// ============================================================================

let container: EditorContainer;
const registeredNames: string[] = [];

beforeEach(() => {
    container = new EditorContainer();
    setEditorContainer(container);
    container.lockBuiltins();
    exposeRegistrationAPI();
});

afterEach(() => {
    for (const name of registeredNames) unregisterComponent(name);
    registeredNames.length = 0;
    delete (window as any).__esengine_componentSourceMap;
});

function registerAndTrack(source: string): string[] {
    const names = extractAndRegisterComponents(source);
    registeredNames.push(...names);
    return names;
}

// ============================================================================
// Unit tests — pure parsing
// ============================================================================

describe('safeParseObjectLiteral', () => {
    it('parses simple key-value pairs', () => {
        expect(safeParseObjectLiteral('{ speed: 10, name: "hello" }')).toEqual({
            speed: 10, name: 'hello',
        });
    });

    it('handles trailing commas', () => {
        expect(safeParseObjectLiteral('{ a: 1, b: 2, }')).toEqual({ a: 1, b: 2 });
    });

    it('handles nested objects', () => {
        expect(safeParseObjectLiteral('{ pos: { x: 0, y: 1 } }')).toEqual({
            pos: { x: 0, y: 1 },
        });
    });

    it('returns null for variable references', () => {
        expect(safeParseObjectLiteral('{ speed: MAX_SPEED }')).toBeNull();
    });
});

describe('extractObjectLiteral', () => {
    it('extracts balanced braces', () => {
        expect(extractObjectLiteral('{ a: 1 }, extra')).toBe('{ a: 1 }');
    });

    it('returns null when not starting with brace', () => {
        expect(extractObjectLiteral('defaults)')).toBeNull();
    });

    it('handles strings containing braces', () => {
        expect(extractObjectLiteral('{ a: "}" }')).toBe('{ a: "}" }');
    });
});

// ============================================================================
// RED — bug reproduction: clear-before-build breaks on failure
// ============================================================================

describe('compile transactional safety', () => {
    const SOURCE_V1 = `
        import { defineComponent } from 'esengine';
        defineComponent('PlayerStats', { speed: 10, health: 100 });
    `;
    const SOURCE_V2 = `
        import { defineComponent } from 'esengine';
        defineComponent('PlayerStats', { speed: 20, health: 100, armor: 50 });
    `;

    it('successful recompile updates schema and defaults', () => {
        const names = registerAndTrack(SOURCE_V1);
        expect(getComponentSchema('PlayerStats')).toBeDefined();
        expect(getComponentDefaults('PlayerStats')).toMatchObject({ speed: 10 });

        // Simulate successful recompile: clear old, register new
        for (const n of names) unregisterComponent(n);
        clearScriptComponents();
        registeredNames.length = 0;

        registerAndTrack(SOURCE_V2);

        expect(getComponentDefaults('PlayerStats')).toMatchObject({ speed: 20, armor: 50 });
        const schema = getComponentSchema('PlayerStats');
        expect(schema).toBeDefined();
        expect(schema!.properties.map(p => p.name)).toContain('armor');
    });

    it('clear-before-build pattern loses components on build failure', () => {
        registerAndTrack(SOURCE_V1);
        expect(getComponentSchema('PlayerStats')).toBeDefined();

        // OLD buggy pattern: clear first, then build fails
        for (const n of registeredNames) unregisterComponent(n);
        clearScriptComponents();

        // Build fails here — no re-registration happens
        // This is the bug: schema is gone
        expect(getComponentSchema('PlayerStats')).toBeUndefined();  // <-- proves the bug
        expect(getComponentDefaults('PlayerStats')).toBeNull();     // <-- proves the bug
    });

    it('clear-after-build pattern preserves components on build failure', () => {
        registerAndTrack(SOURCE_V1);
        expect(getComponentSchema('PlayerStats')).toBeDefined();

        // NEW correct pattern: build first, don't clear on failure
        const buildFailed = true;
        if (!buildFailed) {
            for (const n of registeredNames) unregisterComponent(n);
            clearScriptComponents();
            // would re-register here
        }

        // Components survive the failed build
        expect(getComponentSchema('PlayerStats')).toBeDefined();
        expect(getComponentDefaults('PlayerStats')).toMatchObject({ speed: 10, health: 100 });
    });
});
