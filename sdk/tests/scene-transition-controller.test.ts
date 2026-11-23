// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
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

vi.mock('../src/render/customDraw', () => ({
    registerDrawCallback: (id: string, fn: () => void) => drawCalls.register(id, fn),
    unregisterDrawCallback: (id: string) => drawCalls.unregister(id),
}));

vi.mock('../src/render/draw', () => ({
    Draw: {
        setLayer: vi.fn(),
        setDepth: vi.fn(),
        rect: vi.fn(),
    },
}));

import { SceneTransitionController } from '../src/scene/SceneTransitionController';

describe('SceneTransitionController', () => {
    it('rejects a completion callback failure and permits the next transition', async () => {
        const ctrl = new SceneTransitionController();
        const error = new Error('completion failed');
        const options = { duration: 1, color: { r: 0, g: 0, b: 0, a: 1 } };
        const pending = ctrl.start({ ...options, onComplete: () => { throw error; } }, async () => {});
        const rejected = expect(pending).rejects.toBe(error);
        ctrl.update(.6); await Promise.resolve(); ctrl.update(0);
        expect(() => ctrl.update(.6)).not.toThrow();
        await rejected;
        expect(ctrl.isTransitioning()).toBe(false);
        const next = ctrl.start(options, async () => {});
        ctrl.update(.6); await Promise.resolve(); ctrl.update(0); ctrl.update(.6);
        await next;
        expect(ctrl.isTransitioning()).toBe(false);
    });
    it('a failing callback does not tear down the transition it just started', async () => {
        const ctrl = new SceneTransitionController();
        const error = new Error('completion failed');
        const options = { duration: 1, color: { r: 0, g: 0, b: 0, a: 1 } };
        let next!: Promise<void>;
        const pending = ctrl.start({ ...options, onComplete: () => {
            next = ctrl.start(options, async () => {});
            throw error;
        } }, async () => {});
        const rejected = expect(pending).rejects.toBe(error);
        ctrl.update(.6); await Promise.resolve(); ctrl.update(0); ctrl.update(.6);
        await rejected;
        expect(ctrl.isTransitioning()).toBe(true);
        ctrl.update(.6); await Promise.resolve(); ctrl.update(0); ctrl.update(.6);
        await next;
        expect(ctrl.isTransitioning()).toBe(false);
    });
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

    it('reset() clears the overlay and rejects the pending transition', async () => {
        drawCalls.register.mockClear();
        drawCalls.unregister.mockClear();
        const ctrl = new SceneTransitionController();
        const cancelled = new Error('reset');
        const waiting = expect(ctrl.start(
            { duration: 1.0, color: { r: 0, g: 0, b: 0, a: 1 } },
            async () => { /* noop */ },
        )).rejects.toBe(cancelled);
        expect(ctrl.isTransitioning()).toBe(true);

        ctrl.reset(cancelled);
        await waiting;
        expect(ctrl.isTransitioning()).toBe(false);
        expect(drawCalls.unregister).toHaveBeenCalledTimes(1);
    });

    it('lets onStart reset its own transition before installing the overlay', async () => {
        drawCalls.register.mockClear();
        const ctrl = new SceneTransitionController(), cancelled = new Error('reset');
        const swap = vi.fn(async () => {});
        await expect(ctrl.start({ duration: 1, color: { r: 0, g: 0, b: 0, a: 1 },
            onStart: () => ctrl.reset(cancelled) }, swap)).rejects.toBe(cancelled);
        ctrl.update(1);
        expect(ctrl.isTransitioning()).toBe(false);
        expect(drawCalls.register).not.toHaveBeenCalled();
        expect(swap).not.toHaveBeenCalled();
    });

    it('lets a swap reset the transition during the frame that starts it', async () => {
        const ctrl = new SceneTransitionController(), cancelled = new Error('reset');
        const pending = ctrl.start({ duration: 1, color: { r: 0, g: 0, b: 0, a: 1 } },
            async () => ctrl.reset(cancelled));
        const rejected = expect(pending).rejects.toBe(cancelled);
        ctrl.update(0.6);
        await rejected;
        expect(ctrl.isTransitioning()).toBe(false);
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
