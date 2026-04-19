import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    clearUserComponents,
    defineComponent,
    defineTag,
    getAllRegisteredComponents,
    getComponent,
    isBuiltinComponent,
} from '../src/component';
import { getDefaultContext } from '../src/context';

/**
 * Confirms that the SDK-side `editorBridge` hook and the exports the
 * editor uses for initial-replay (`getAllRegisteredComponents`,
 * `isBuiltinComponent`) behave as the bridge plugin expects.
 *
 * These tests don't cover the editor plugin itself — that's wired in
 * the Editrix app and doesn't ship in the SDK package. But the SDK
 * contract they depend on is exercised here so a future refactor can't
 * silently break the bridge.
 */
describe('editor bridge', () => {
    const ctx = getDefaultContext();

    beforeEach(() => {
        ctx.editorBridge = null;
        clearUserComponents();
    });

    afterEach(() => {
        ctx.editorBridge = null;
        clearUserComponents();
    });

    it('calls editorBridge.registerComponent on defineComponent', () => {
        const seen: { name: string; isTag: boolean; defaultsKeys: string[] }[] = [];
        ctx.editorBridge = {
            registerComponent(name, defaults, isTag): void {
                seen.push({ name, isTag, defaultsKeys: Object.keys(defaults) });
            },
        };

        defineComponent('BridgeTestA', { x: 0, y: 0 });

        expect(seen).toHaveLength(1);
        expect(seen[0]?.name).toBe('BridgeTestA');
        expect(seen[0]?.isTag).toBe(false);
        expect(seen[0]?.defaultsKeys.sort()).toEqual(['x', 'y']);
    });

    it('calls editorBridge.registerComponent with isTag=true on defineTag', () => {
        const seen: boolean[] = [];
        ctx.editorBridge = {
            registerComponent(_name, _defaults, isTag): void { seen.push(isTag); },
        };

        defineTag('BridgeTestTag');

        expect(seen).toEqual([true]);
    });

    it('skips the callback when bridge is null (degrades to no-op)', () => {
        expect(() => defineComponent('BridgeTestC', { n: 1 })).not.toThrow();
        expect(getComponent('BridgeTestC')?._name).toBe('BridgeTestC');
    });

    it('the def is in the registry before the bridge callback fires', () => {
        let defPresent = false;
        ctx.editorBridge = {
            registerComponent(name): void {
                defPresent = getComponent(name) !== undefined;
            },
        };

        defineComponent('BridgeTestD', { v: true });

        expect(defPresent).toBe(true);
    });

    it('getAllRegisteredComponents exposes both builtins and user-defined', () => {
        defineComponent('BridgeTestUser1', { z: 0 });
        const all = getAllRegisteredComponents();

        expect(all.has('BridgeTestUser1')).toBe(true);
        // Transform is one of the core builtins — it must be present and
        // flagged builtin so the bridge can skip it during replay.
        const transform = all.get('Transform');
        expect(transform).toBeDefined();
        if (transform) expect(isBuiltinComponent(transform)).toBe(true);

        const user = all.get('BridgeTestUser1');
        expect(user).toBeDefined();
        if (user) expect(isBuiltinComponent(user)).toBe(false);
    });

    it('carries assetFields through the registry so the bridge sees subtypes', () => {
        defineComponent('BridgeTestAssetField', { ref: '' }, {
            assetFields: [{ field: 'ref', type: 'audio' }],
        });
        const def = getComponent('BridgeTestAssetField');
        expect(def).toBeDefined();
        if (!def) return;
        expect(def.assetFields).toHaveLength(1);
        expect(def.assetFields[0]).toEqual({ field: 'ref', type: 'audio' });
    });
});
