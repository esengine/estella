/**
 * @file    scene-transition-controller.test.ts
 * @brief   SceneTransitionController — three-phase fade state machine in
 *          isolation from the SceneManager.
 */
import { describe, expect, it, vi } from 'vitest';

const drawCalls = {
    register: vi.fn(),
    unregister: vi.fn(),
};

vi.mock('../src/customDraw', () => ({
    registerDrawCallback: (id: string, fn: () => void) => drawCalls.register(id, fn),
    unregisterDrawCallback: (id: string) => drawCalls.unregister(id),
}));

vi.mock('../src/draw', () => ({
    Draw: {
        setLayer: vi.fn(),
        setDepth: vi.fn(),
        rect: vi.fn(),
    },
}));

import { SceneTransitionController } from '../src/scene/SceneTransitionController';

describe('SceneTransitionController', () => {
    it('resolves after fade-out → loading → fade-in on a successful swap', async () => {
        drawCalls.register.mockClear();
        drawCalls.unregister.mockClear();
        const ctrl = new SceneTransitionController();
        let swapped = false;
        const p = ctrl.start(
            { duration: 1.0, color: { r: 0, g: 0, b: 0, a: 1 } },
            async () => { swapped = true; },
        );
        let resolved = false;
        p.then(() => { resolved = true; });

        expect(ctrl.isTransitioning()).toBe(true);
        expect(drawCalls.register).toHaveBeenCalledTimes(1);

        ctrl.update(0.6);                      // fade-out done → loading; kicks swap
        await new Promise(r => setTimeout(r, 5));  // let swap microtask settle
        expect(swapped).toBe(true);

        ctrl.update(0.0);                      // loading sees success → fade-in
        ctrl.update(0.6);                      // fade-in done → resolve
        await p;

        expect(resolved).toBe(true);
        expect(ctrl.isTransitioning()).toBe(false);
        expect(drawCalls.unregister).toHaveBeenCalledTimes(1);
    });

    it('rejects with the swap error and cleans up', async () => {
        drawCalls.register.mockClear();
        drawCalls.unregister.mockClear();
        const ctrl = new SceneTransitionController();
        const boom = new Error('swap failed');
        const p = ctrl.start(
            { duration: 1.0, color: { r: 0, g: 0, b: 0, a: 1 } },
            async () => { throw boom; },
        );
        const errs: unknown[] = [];
        p.catch(e => errs.push(e));

        ctrl.update(0.6);                      // fade-out done → loading
        await new Promise(r => setTimeout(r, 5));
        ctrl.update(0.0);                      // loading sees error → reject
        await new Promise(r => setTimeout(r, 0));
        await new Promise(r => setTimeout(r, 0));

        expect(errs).toEqual([boom]);
        expect(ctrl.isTransitioning()).toBe(false);
        expect(drawCalls.unregister).toHaveBeenCalledTimes(1);
    });

    it('holds the overlay fully opaque while the swap is pending', async () => {
        drawCalls.register.mockClear();
        drawCalls.unregister.mockClear();
        const ctrl = new SceneTransitionController();
        let release: (() => void) | null = null;
        void ctrl.start(
            { duration: 1.0, color: { r: 0, g: 0, b: 0, a: 1 } },
            () => new Promise<void>(resolve => { release = resolve; }),
        );

        ctrl.update(0.6);          // fade-out → loading
        // Call update many more times while the swap has not resolved;
        // the controller must stay in 'loading' and not advance.
        for (let i = 0; i < 10; i++) ctrl.update(0.2);
        expect(ctrl.isTransitioning()).toBe(true);

        release!();
        await new Promise(r => setTimeout(r, 5));
        ctrl.update(0.0);          // loading → fade-in
        ctrl.update(0.6);          // fade-in → resolve
        expect(ctrl.isTransitioning()).toBe(false);
    });

    it('reset() clears in-flight transitions without resolve/reject', () => {
        drawCalls.register.mockClear();
        drawCalls.unregister.mockClear();
        const ctrl = new SceneTransitionController();
        void ctrl.start(
            { duration: 1.0, color: { r: 0, g: 0, b: 0, a: 1 } },
            async () => { /* noop */ },
        );
        expect(ctrl.isTransitioning()).toBe(true);

        ctrl.reset();
        expect(ctrl.isTransitioning()).toBe(false);
        expect(drawCalls.unregister).toHaveBeenCalledTimes(1);
    });

    it('invokes onStart at start and onComplete only on success', async () => {
        const onStart = vi.fn();
        const onComplete = vi.fn();
        const ctrl = new SceneTransitionController();
        const p = ctrl.start(
            { duration: 1.0, color: { r: 0, g: 0, b: 0, a: 1 }, onStart, onComplete },
            async () => { /* noop */ },
        );
        expect(onStart).toHaveBeenCalledTimes(1);
        expect(onComplete).not.toHaveBeenCalled();

        ctrl.update(0.6);
        await new Promise(r => setTimeout(r, 5));
        ctrl.update(0.0);
        ctrl.update(0.6);
        await p;

        expect(onComplete).toHaveBeenCalledTimes(1);
    });
});
