// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui-multi-pointer.test.ts
 * @brief   Two on-screen buttons, held at once: each finger is a pointer of its
 *          own, one letting go never releases another's control, and a control
 *          two fingers hold stays pressed until the last one lifts.
 */
import { describe, it, expect } from 'vitest';
import { UiPointerBook, UiPointerHitCache, uiPointersOf, MOUSE_POINTER, type UiPointerSample } from '../src/ui/input/pointerBook';
import { InputState, inputEventCallbacks } from '../src/input/input';
import type { Entity } from '../src/types';

const BUTTON_A = 1 as Entity;
const BUTTON_B = 2 as Entity;

/** A screen with one control per x: x<100 is A, x<200 is B, past that nothing. */
const screen = (p: UiPointerSample): Entity | null =>
    (p.x < 100 ? BUTTON_A : p.x < 200 ? BUTTON_B : null);

const finger = (id: number, x: number, over: Partial<UiPointerSample> = {}): UiPointerSample => ({
    id, x, y: 0, down: true, pressed: false, released: false, hovers: true, ...over,
});

const kinds = (events: ReturnType<UiPointerBook['step']>, entity: Entity): string[] =>
    events.filter((e) => e.entity === entity).map((e) => e.kind);

describe('two fingers, two buttons', () => {
    it('holds both, and one letting go does not release the other', () => {
        const book = new UiPointerBook();
        const alive = () => true;

        book.step([finger(0, 10, { pressed: true })], screen, alive);
        expect([...book.pressed]).toEqual([BUTTON_A]);

        const second = book.step([finger(0, 10), finger(1, 150, { pressed: true })], screen, alive);
        expect(kinds(second, BUTTON_B)).toContain('press');
        expect(kinds(second, BUTTON_A)).not.toContain('release');
        expect([...book.pressed].sort()).toEqual([BUTTON_A, BUTTON_B]);

        // B lifts. A is still down and must stay pressed — the whole bug.
        const lift = book.step(
            [finger(0, 10), finger(1, 150, { down: false, released: true, hovers: false })],
            screen, alive,
        );
        expect(kinds(lift, BUTTON_B)).toEqual(['hoverExit', 'release', 'click']);
        expect(kinds(lift, BUTTON_A)).toEqual([]);
        expect([...book.pressed]).toEqual([BUTTON_A]);

        const last = book.step([finger(0, 10, { down: false, released: true, hovers: false })], screen, alive);
        expect(kinds(last, BUTTON_A)).toEqual(['hoverExit', 'release', 'click']);
        expect([...book.pressed]).toEqual([]);
    });

    it('a control two fingers hold stays pressed until the last one lets go', () => {
        const book = new UiPointerBook();
        const alive = () => true;
        book.step([finger(0, 10, { pressed: true }), finger(1, 20, { pressed: true })], screen, alive);
        expect([...book.pressed]).toEqual([BUTTON_A]);

        book.step([finger(0, 10), finger(1, 20, { down: false, released: true, hovers: false })], screen, alive);
        expect([...book.pressed]).toEqual([BUTTON_A]);

        book.step([finger(0, 10, { down: false, released: true, hovers: false })], screen, alive);
        expect([...book.pressed]).toEqual([]);
    });

    it('sliding off before letting go is a release, not a click', () => {
        const book = new UiPointerBook();
        const alive = () => true;
        book.step([finger(0, 10, { pressed: true })], screen, alive);
        const off = book.step([finger(0, 150, { down: false, released: true, hovers: false })], screen, alive);
        expect(kinds(off, BUTTON_A)).toEqual(['hoverExit', 'release']);
    });

    it('a finger that vanishes without lifting still releases what it held', () => {
        const book = new UiPointerBook();
        const alive = () => true;
        book.step([finger(0, 10, { pressed: true })], screen, alive);
        const gone = book.step([], screen, alive);
        expect(kinds(gone, BUTTON_A)).toEqual(['hoverExit', 'release']);
        expect([...book.pressed]).toEqual([]);
    });

    it('a control despawned under a finger is dropped without events', () => {
        const book = new UiPointerBook();
        book.step([finger(0, 10, { pressed: true })], screen, () => true);
        const dead = book.step([finger(0, 10, { down: false, released: true, hovers: false })], screen, () => false);
        expect(dead).toEqual([]);
        expect([...book.pressed]).toEqual([]);
    });

    it('a finger hovers only while it is down', () => {
        const book = new UiPointerBook();
        const alive = () => true;
        const down = book.step([finger(0, 10, { pressed: true })], screen, alive);
        expect(kinds(down, BUTTON_A)).toEqual(['hoverEnter', 'press']);
        const up = book.step([finger(0, 10, { down: false, released: true, hovers: false })], screen, alive);
        expect(kinds(up, BUTTON_A)).toEqual(['hoverExit', 'release', 'click']);
    });
});

describe('a release inside the host event', () => {
    it('clicks the control its pointer holds while still over it, and nothing else', () => {
        const book = new UiPointerBook();
        book.step([finger(0, 10, { pressed: true })], screen, () => true);
        expect(book.releasing(0, BUTTON_A)).toBe(BUTTON_A);
        expect(book.releasing(0, BUTTON_B)).toBeNull();
        expect(book.releasing(0, null)).toBeNull();
        expect(book.releasing(1, BUTTON_A)).toBeNull();
    });
});

describe('the pointer set a frame of input makes', () => {
    it('keeps touch hit caching bounded over repeated gestures, including the release frame', () => {
        const input = new InputState(), cache = new UiPointerHitCache();
        for (let id = 0; id < 10000; id++) {
            input.touches.set(id, { id, x: 10, y: 20 });
            cache.retain(uiPointersOf(input));
            cache.set(id, { x: 10, y: 20, worldX: 10, worldY: 20, entity: BUTTON_A });
            expect(cache.size).toBe(1);
            input.endTouch(id);
            cache.retain(uiPointersOf(input));
            expect(cache.get(id)?.entity).toBe(BUTTON_A);
            input.clearFrameState();
            cache.retain(uiPointersOf(input));
            expect(cache.size).toBe(0);
        }
    });
    it('expires ended touches while keeping another finger and the current mouse hit', () => {
        const cache = new UiPointerHitCache();
        for (const id of [1, 2, MOUSE_POINTER]) cache.set(id, { x: 0, y: 0, worldX: 0, worldY: 0, entity: BUTTON_A });
        cache.retain([finger(2, 0)]);
        expect([...cache.keys()]).toEqual([2]);
        cache.set(MOUSE_POINTER, { x: 20, y: 0, worldX: 20, worldY: 0, entity: BUTTON_B });
        cache.retain([finger(MOUSE_POINTER, 20)]);
        expect([...cache.keys()]).toEqual([MOUSE_POINTER]);
    });
    it('is the mouse when nothing is touching the glass', () => {
        const input = new InputState();
        input.mouseX = 42;
        input.noteMouseDown(0);
        const [p] = uiPointersOf(input);
        expect(p.id).toBe(MOUSE_POINTER);
        expect(p.pressed).toBe(true);
        expect(p.down).toBe(true);
    });

    it('is the fingers while any is down — never both, or one finger presses twice', () => {
        const input = new InputState();
        // What a touch host does: the primary finger also synthesizes button 0.
        input.touches.set(0, { id: 0, x: 10, y: 5 });
        input.touchesStarted.set(0, { id: 0, x: 10, y: 5 });
        input.noteMouseDown(0);
        const pointers = uiPointersOf(input);
        expect(pointers).toHaveLength(1);
        expect(pointers[0].id).toBe(0);
        expect(pointers[0].pressed).toBe(true);
    });

    it('keeps a lifted finger for the frame it lifted on, where it lifted', () => {
        const input = new InputState();
        input.touches.set(3, { id: 3, x: 70, y: 90 });
        input.endTouch(3);
        const pointers = uiPointersOf(input);
        expect(pointers).toHaveLength(1);
        expect(pointers[0]).toMatchObject({ id: 3, x: 70, y: 90, down: false, released: true, hovers: false });
    });

    it('clicks with a tap that landed and lifted inside one frame', () => {
        // A 10 fps quick-game emulator dropped every quick tap: the finger was gone by the frame.
        const input = new InputState();
        input.touches.set(0, { id: 0, x: 10, y: 5 });
        input.touchesStarted.set(0, { id: 0, x: 10, y: 5 });
        input.endTouch(0);
        const events = new UiPointerBook().step(uiPointersOf(input), screen, () => true);
        expect(kinds(events, BUTTON_A)).toEqual(['press', 'release', 'click']);
    });
    it('releases the previous use of a touch id before capturing its replacement', () => {
        const input = new InputState(), callbacks = inputEventCallbacks(input), book = new UiPointerBook();
        callbacks.onTouchStart!(3, 10, 0);
        book.step(uiPointersOf(input), screen, () => true); input.clearFrameState();
        callbacks.onTouchEnd!(3); callbacks.onTouchStart!(3, 150, 0);
        const events = book.step(uiPointersOf(input), screen, () => true);
        expect(kinds(events, BUTTON_A)).toContain('click');
        expect(kinds(events, BUTTON_B)).toEqual(['hoverEnter', 'press']);
        expect(book.pressedByPointer(3)).toBe(BUTTON_B);
        input.clearFrameState(); callbacks.onTouchEnd!(3);
        expect(kinds(book.step(uiPointersOf(input), screen, () => true), BUTTON_B)).toContain('click');
    });
    it('preserves a quick tap when its id is reused by a held finger in the same frame', () => {
        const input = new InputState(), callbacks = inputEventCallbacks(input), book = new UiPointerBook();
        callbacks.onTouchStart!(3, 10, 0); callbacks.onTouchEnd!(3);
        callbacks.onTouchStart!(3, 150, 0);
        const events = book.step(uiPointersOf(input), screen, () => true);
        expect(kinds(events, BUTTON_A)).toEqual(['press', 'release', 'click']);
        expect(kinds(events, BUTTON_B)).toEqual(['hoverEnter', 'press']);
        expect(book.pressedByPointer(3)).toBe(BUTTON_B);
    });
});
