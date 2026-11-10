// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Turning multi-touch off: one finger at a time reaches the UI and the
 *        game (esengine/estella#117). Driven through the one funnel every
 *        platform's touches arrive by (inputEventCallbacks), with the platform's
 *        own primary-pointer synthesis in front, so what is tested is what a
 *        phone sends.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InputState, inputEventCallbacks } from '../src/input/input';
import { inputRouter } from '../src/input/inputRouter';
import { createPrimaryPointer } from '../src/platform/primaryPointer';
import { RuntimeConfig, applyBuildRuntimeConfig, parseRuntimeBuildConfig } from '../src/defaults';

let input: InputState;
let finger: ReturnType<typeof createPrimaryPointer>;
let ui: string[];
let unregister: () => void;

beforeEach(() => {
    input = new InputState();
    finger = createPrimaryPointer(inputEventCallbacks(input));
    ui = [];
    // A UI that sees every touch and claims none: what reaches it is recorded.
    unregister = inputRouter.setUIHandler({
        onTouchStart: (id) => { ui.push(`start ${id}`); },
        onTouchMove: (id) => { ui.push(`move ${id}`); },
        onTouchEnd: (id) => { ui.push(`end ${id}`); },
        onTouchCancel: (id) => { ui.push(`cancel ${id}`); },
    });
});
afterEach(() => { unregister(); RuntimeConfig.multiTouch = true; });

const ids = () => input.getTouches().map((t) => t.id);

describe('multi-touch switch', () => {
    it('is on by default, and every finger is handled', () => {
        expect(input.isMultiTouchEnabled()).toBe(true);
        finger.start(1, 10, 10);
        finger.start(2, 20, 20);
        expect(ids()).toEqual([1, 2]);
        expect(ui).toEqual(['start 1', 'start 2']);
    });

    it('off, a second finger reaches neither the game nor the UI for its whole life', () => {
        input.setMultiTouch(false);
        finger.start(1, 10, 10);
        finger.start(2, 20, 20);
        finger.move(2, 25, 25);
        finger.end(2);
        expect(ids()).toEqual([1]);
        expect(input.getTouchesStarted().map((t) => t.id)).toEqual([1]);
        expect(input.getTouchesEnded()).toEqual([]);
        expect(ui).toEqual(['start 1']);
    });

    it('off, the next finger is handled once the first has lifted', () => {
        input.setMultiTouch(false);
        finger.start(1, 10, 10);
        finger.end(1);
        finger.start(2, 20, 20);
        expect(ids()).toEqual([2]);
    });

    it('off, a finger pressed under the first stays ignored after the first lifts', () => {
        input.setMultiTouch(false);
        finger.start(1, 10, 10);
        finger.start(2, 20, 20);
        finger.end(1);
        finger.move(2, 30, 30);
        expect(ids()).toEqual([]);
        finger.end(2);
        finger.start(3, 40, 40);
        expect(ids()).toEqual([3]);
    });

    it('a cancelled first finger frees the slot', () => {
        input.setMultiTouch(false);
        finger.start(1, 10, 10);
        finger.cancel(1);
        finger.start(2, 20, 20);
        expect(ids()).toEqual([2]);
    });

    it('turned off with several fingers down keeps the first and cancels the rest', () => {
        finger.start(1, 10, 10);
        finger.start(2, 20, 20);
        finger.start(3, 30, 30);
        ui.length = 0;
        input.setMultiTouch(false);
        expect(ids()).toEqual([1]);
        expect(ui).toEqual(['cancel 2', 'cancel 3']);
        // They end with no release edge, and their later events are ignored.
        finger.move(2, 99, 99);
        finger.end(3);
        expect(input.getTouchesEnded()).toEqual([]);
        expect(ui).toEqual(['cancel 2', 'cancel 3']);
    });

    it('turned back on, every finger is handled again', () => {
        input.setMultiTouch(false);
        finger.start(1, 10, 10);
        input.setMultiTouch(true);
        finger.start(2, 20, 20);
        expect(ids()).toEqual([1, 2]);
    });

    it('the mouse pointer a phone synthesises still follows only the first finger', () => {
        input.setMultiTouch(false);
        finger.start(1, 10, 10);
        finger.start(2, 50, 50);
        expect(input.isMouseButtonDown(0)).toBe(true);
        expect(input.getMousePosition()).toEqual({ x: 10, y: 10 });
    });

    it('losing focus forgets every finger, in single-touch mode too', () => {
        input.setMultiTouch(false);
        finger.start(1, 10, 10);
        finger.start(2, 20, 20);
        inputEventCallbacks(input).onInputCancel?.();
        finger.start(5, 0, 0);
        expect(ids()).toEqual([5]);
    });
});

// The project's default (Project Settings → Game → Runtime → Multi-touch).
describe('the project default', () => {
    const app = { setMaxDeltaTime() {}, setMaxFixedSteps() {} };

    it('is written only when off', () => {
        expect(parseRuntimeBuildConfig({ multiTouch: false })).toEqual({ multiTouch: false });
        expect(parseRuntimeBuildConfig({ multiTouch: true })).toEqual({});
        expect(parseRuntimeBuildConfig({ multiTouch: 'no' })).toEqual({});
    });

    it('turns multi-touch off for a game that has not said otherwise', () => {
        applyBuildRuntimeConfig(app, { multiTouch: false });
        expect(input.isMultiTouchEnabled()).toBe(false);
        finger.start(1, 10, 10);
        finger.start(2, 20, 20);
        expect(ids()).toEqual([1]);
    });

    it('gives way to the game turning it back on', () => {
        applyBuildRuntimeConfig(app, { multiTouch: false });
        input.setMultiTouch(true);
        finger.start(1, 10, 10);
        finger.start(2, 20, 20);
        expect(ids()).toEqual([1, 2]);
    });

    it('is on again for a config that does not mention it, even after one that turned it off', () => {
        applyBuildRuntimeConfig(app, { multiTouch: false });
        applyBuildRuntimeConfig(app, {});
        expect(input.isMultiTouchEnabled()).toBe(true);
    });
});
