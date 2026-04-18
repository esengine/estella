/**
 * @file    custom-draw.test.ts
 * @brief   Draw-callback registry: register/unregister, scene scoping.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
    registerDrawCallback,
    unregisterDrawCallback,
    clearDrawCallbacks,
    clearSceneDrawCallbacks,
    getDrawCallbacks,
} from '../src/customDraw';

describe('customDraw callback registry', () => {
    beforeEach(() => {
        clearDrawCallbacks();
    });

    it('registers a callback and returns it via getDrawCallbacks', () => {
        const fn = () => { /* noop */ };
        registerDrawCallback('id-1', fn);
        const all = getDrawCallbacks();
        expect(all.size).toBe(1);
        expect(all.get('id-1')?.fn).toBe(fn);
        expect(all.get('id-1')?.scene).toBe('');
    });

    it('associates a scene name when provided', () => {
        registerDrawCallback('id-1', () => { /* noop */ }, 'level1');
        expect(getDrawCallbacks().get('id-1')?.scene).toBe('level1');
    });

    it('overwrites when re-registering the same id', () => {
        const a = () => { /* noop */ };
        const b = () => { /* noop */ };
        registerDrawCallback('id-1', a);
        registerDrawCallback('id-1', b);
        expect(getDrawCallbacks().get('id-1')?.fn).toBe(b);
        expect(getDrawCallbacks().size).toBe(1);
    });

    it('unregisters by id', () => {
        registerDrawCallback('id-1', () => { /* noop */ });
        registerDrawCallback('id-2', () => { /* noop */ });
        unregisterDrawCallback('id-1');
        const all = getDrawCallbacks();
        expect(all.has('id-1')).toBe(false);
        expect(all.has('id-2')).toBe(true);
    });

    it('clearSceneDrawCallbacks removes only the named scene', () => {
        registerDrawCallback('global', () => { /* noop */ });
        registerDrawCallback('scene-a-1', () => { /* noop */ }, 'sceneA');
        registerDrawCallback('scene-a-2', () => { /* noop */ }, 'sceneA');
        registerDrawCallback('scene-b-1', () => { /* noop */ }, 'sceneB');

        clearSceneDrawCallbacks('sceneA');

        const all = getDrawCallbacks();
        expect(all.has('global')).toBe(true);
        expect(all.has('scene-a-1')).toBe(false);
        expect(all.has('scene-a-2')).toBe(false);
        expect(all.has('scene-b-1')).toBe(true);
    });

    it('clearDrawCallbacks removes everything', () => {
        registerDrawCallback('a', () => { /* noop */ });
        registerDrawCallback('b', () => { /* noop */ }, 'x');
        clearDrawCallbacks();
        expect(getDrawCallbacks().size).toBe(0);
    });
});
