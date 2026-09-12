// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui-multi-pointer.test.ts
 * @brief   Two on-screen buttons, held at once: each finger is a pointer of its
 *          own, one letting go never releases another's control, and a control
 *          two fingers hold stays pressed until the last one lifts.
 */
import { describe, it, expect } from 'vitest';
import { UiPointerBook, uiPointersOf, MOUSE_POINTER, type UiPointerSample } from '../src/ui/input/pointerBook';
import { InputState } from '../src/input/input';
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

describe('the pointer set a frame of input makes', () => {
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
});
