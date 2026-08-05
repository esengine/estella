// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui-text-block-origin.test.ts
 * @brief   Where a laid text block sits relative to its origin, for a label with
 *          a layout box and for one standing in the world without.
 *
 *          The boxed path receives an origin that already carries the baseline
 *          (rectTextBox subtracts 0.8em); the boxless one used to start from a
 *          bare 0, so Middle centred the block on a BASELINE instead of on the
 *          entity and every world label rode 0.8em high — half a square on a
 *          chessboard, which is how it was found.
 */
import { describe, it, expect } from 'vitest';
import { textBlockOriginY } from '../src/ui/text/text-renderer';
import { rectTextBox } from '../src/ui/text/text-transform';

const FS = 50;
const LINE = FS * 1.2; // the laid block's height at the default lineHeight

/** Boxed, pivot-centred: what a UINode of `h` hands the renderer. */
const boxed = (h: number, valign: number): number =>
    textBlockOriginY(rectTextBox(0.5, 0.5, 100, h, FS).originY, h, LINE, FS, valign, LINE);

/** Boxless: the entity origin, nothing else. */
const boxless = (valign: number): number => textBlockOriginY(0, 0, LINE, FS, valign, LINE);

describe('textBlockOriginY', () => {
    it('centres a boxless Middle label on the entity, not on its baseline', () => {
        // The same answer a zero-height box would give, which is the definition
        // of "the origin IS the box".
        expect(boxless(1)).toBeCloseTo(boxed(0.000001, 1), 5);
        // And 0.8em below where it used to land.
        expect(boxless(1)).toBeCloseTo(-0.8 * FS + LINE / 2 - (LINE - FS) / 2, 5);
    });

    it('puts Top, Middle and Bottom on ONE ladder, hanging below to sitting above', () => {
        expect(boxless(0)).toBeLessThan(boxless(1));
        expect(boxless(1)).toBeLessThan(boxless(2));
        // Each is the answer a zero-height box gives — the rule is the same one.
        for (const valign of [0, 1, 2]) {
            expect(boxless(valign)).toBeCloseTo(boxed(0.000001, valign), 5);
        }
    });

    it('treats an unspecified alignment as Top, not as a third behaviour', () => {
        expect(textBlockOriginY(0, 0, LINE, FS, undefined, LINE)).toBeCloseTo(boxless(0), 5);
    });

    it('does not touch the boxed path — a Middle label in a box is unmoved', () => {
        // Centred in its box: the block's middle lands on the box's middle, which
        // for a pivot-centred box is the entity. (0.8em baseline, half a line back
        // up, less half-leading.)
        expect(boxed(200, 1)).toBeCloseTo(-0.8 * FS + LINE / 2 - (LINE - FS) / 2, 5);
        // Taller box, same answer: centring cannot depend on the box's height.
        expect(boxed(400, 1)).toBeCloseTo(boxed(200, 1), 5);
    });

    it('honours half-leading only when the line is taller than the em', () => {
        // Boxed, so the boxless baseline term is not in play — this isolates leading.
        expect(textBlockOriginY(0, 100, FS, FS, 0, FS)).toBe(0);
        expect(textBlockOriginY(0, 100, FS, FS, 0, FS * 0.9)).toBe(0); // never negative
    });
});
