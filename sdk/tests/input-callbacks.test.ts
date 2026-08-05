// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    input-callbacks.test.ts
 * @brief   The funnel every raw event arrives through, as one exported thing.
 *
 *          It is exported because the platform binding is not the only caller
 *          that should exist: a harness driving a running game has to deliver a
 *          click, and doing it any other way is not the same event. A synthetic
 *          DOM event carries no usable offsetX; writing `mouseX` and
 *          `mouseButtonsPressed` by hand skips the router, so UI that should
 *          have swallowed the click never sees it and gameplay behind a button
 *          reacts to presses the player never made.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { InputState, inputEventCallbacks } from '../src/input/input';
import { inputRouter } from '../src/input/inputRouter';

describe('inputEventCallbacks', () => {
    let state: InputState;
    beforeEach(() => {
        state = new InputState();
        inputRouter.setUIHandler(null);
        inputRouter.setEditorHandler(null);
    });

    it('records a pointer press the way a real event does', () => {
        const cb = inputEventCallbacks(state);
        cb.onPointerDown?.(0, 120, 45);
        expect(state.mouseX).toBe(120);
        expect(state.mouseY).toBe(45);
        expect(state.isMouseButtonDown(0)).toBe(true);
        expect(state.isMouseButtonPressed(0)).toBe(true);
        cb.onPointerUp?.(0);
        expect(state.isMouseButtonDown(0)).toBe(false);
        expect(state.isMouseButtonReleased(0)).toBe(true);
    });

    it('tracks the cursor on a move without pressing anything', () => {
        const cb = inputEventCallbacks(state);
        cb.onPointerMove?.(7, 9);
        expect(state.getMousePosition()).toEqual({ x: 7, y: 9 });
        expect(state.isMouseButtonDown(0)).toBe(false);
    });

    it('records keys, wheel and touches through the same funnel', () => {
        const cb = inputEventCallbacks(state);
        cb.onKeyDown?.('ArrowRight');
        expect(state.isKeyDown('ArrowRight')).toBe(true);
        expect(state.isKeyPressed('ArrowRight')).toBe(true);
        cb.onKeyUp?.('ArrowRight');
        expect(state.isKeyDown('ArrowRight')).toBe(false);

        cb.onWheel?.(3, -4);
        expect(state.getScrollDelta()).toEqual({ x: 3, y: -4 });

        cb.onTouchStart?.(1, 50, 60);
        expect(state.getTouchCount()).toBe(1);
        expect(state.getTouch(1)).toMatchObject({ x: 50, y: 60 });
        cb.onTouchEnd?.(1);
        expect(state.getTouchCount()).toBe(0);
    });

    it('lets the UI router refuse a press before gameplay records it', () => {
        // The half a hand-written injector skips: a click on a button must not
        // also reach the board behind it.
        const handler = {
            onPointerDown: () => true, // consumed
            onPointerUp: () => true,
        };
        const off = inputRouter.setUIHandler(handler as never);
        try {
            const cb = inputEventCallbacks(state);
            cb.onPointerDown?.(0, 10, 10);
            // Position still tracks (a HUD cursor must not freeze) but the press
            // never became a gameplay edge.
            expect(state.mouseX).toBe(10);
            expect(state.isMouseButtonDown(0)).toBe(false);
            expect(state.isMouseButtonPressed(0)).toBe(false);
        } finally {
            off();
        }
    });
});
