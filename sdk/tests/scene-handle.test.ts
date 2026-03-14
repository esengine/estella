import { describe, it, expect, vi } from 'vitest';
import { SceneHandle } from '../src/asset/SceneHandle';

describe('SceneHandle', () => {
    it('stores entities', () => {
        const handle = new SceneHandle([1, 2, 3], []);
        expect(handle.entities).toEqual([1, 2, 3]);
    });

    it('calls release callbacks on release', () => {
        const cb1 = vi.fn();
        const cb2 = vi.fn();
        const handle = new SceneHandle([1], [cb1, cb2]);

        handle.release();

        expect(cb1).toHaveBeenCalledOnce();
        expect(cb2).toHaveBeenCalledOnce();
    });

    it('only releases once', () => {
        const cb = vi.fn();
        const handle = new SceneHandle([1], [cb]);

        handle.release();
        handle.release();

        expect(cb).toHaveBeenCalledOnce();
        expect(handle.isReleased).toBe(true);
    });

    it('isReleased is false initially', () => {
        const handle = new SceneHandle([1], []);
        expect(handle.isReleased).toBe(false);
    });
});
