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
import { textBlockOffsetX, textBlockOriginY } from '../src/ui/text/text-renderer';
import { rectTextBox } from '../src/ui/text/text-transform';
// The frozen alignment vocabulary, rather than the 0/1/2 it is: these ARE the
// names, and a test spelling them as numbers cannot catch a renumbering.
import { TextAlign, TextVerticalAlign } from '../src/ui/core/text';

const FS = 50;
const LINE = FS * 1.2; // the laid block's height at the default lineHeight

/** Boxed, pivot-centred: what a UINode of `h` hands the renderer. */
const boxed = (h: number, valign: TextVerticalAlign): number =>
    textBlockOriginY(rectTextBox(0.5, 0.5, 100, h, FS).originY, h, LINE, FS, valign, LINE);

/** Boxless: the entity origin, nothing else. */
const boxless = (valign: TextVerticalAlign): number => textBlockOriginY(0, 0, LINE, FS, valign, LINE);

describe('textBlockOriginY', () => {
    it('centres a boxless Middle label on the entity, not on its baseline', () => {
        // The same answer a zero-height box would give, which is the definition
        // of "the origin IS the box".
        expect(boxless(TextVerticalAlign.Middle)).toBeCloseTo(boxed(0.000001, TextVerticalAlign.Middle), 5);
        // And 0.8em below where it used to land.
        expect(boxless(TextVerticalAlign.Middle)).toBeCloseTo(-0.8 * FS + LINE / 2 - (LINE - FS) / 2, 5);
    });

    it('puts Top, Middle and Bottom on ONE ladder, hanging below to sitting above', () => {
        expect(boxless(TextVerticalAlign.Top)).toBeLessThan(boxless(TextVerticalAlign.Middle));
        expect(boxless(TextVerticalAlign.Middle)).toBeLessThan(boxless(TextVerticalAlign.Bottom));
        // Each is the answer a zero-height box gives — the rule is the same one.
        for (const valign of Object.values(TextVerticalAlign)) {
            expect(boxless(valign)).toBeCloseTo(boxed(0.000001, valign), 5);
        }
    });

    it('treats an unspecified alignment as Top, not as a third behaviour', () => {
        expect(textBlockOriginY(0, 0, LINE, FS, undefined, LINE)).toBeCloseTo(boxless(TextVerticalAlign.Top), 5);
    });

    it('does not touch the boxed path — a Middle label in a box is unmoved', () => {
        // Centred in its box: the block's middle lands on the box's middle, which
        // for a pivot-centred box is the entity. (0.8em baseline, half a line back
        // up, less half-leading.)
        expect(boxed(200, TextVerticalAlign.Middle)).toBeCloseTo(-0.8 * FS + LINE / 2 - (LINE - FS) / 2, 5);
        // Taller box, same answer: centring cannot depend on the box's height.
        expect(boxed(400, TextVerticalAlign.Middle)).toBeCloseTo(boxed(200, TextVerticalAlign.Middle), 5);
    });

    it('honours half-leading only when the line is taller than the em', () => {
        // Boxed, so the boxless baseline term is not in play — this isolates leading.
        expect(textBlockOriginY(0, 100, FS, FS, TextVerticalAlign.Top, FS)).toBe(0);
        expect(textBlockOriginY(0, 100, FS, FS, TextVerticalAlign.Top, FS * 0.9)).toBe(0); // never negative
    });

    it('anchors a boxless label horizontally per TextAlign, and centres inside a box', () => {
        // The other half of the same rule: no box means the alignment anchors the
        // run against the origin instead of positioning it inside a width.
        const at = (align: TextAlign, boxWidth: number) =>
            textBlockOffsetX(align, boxWidth, 100);
        expect(at(TextAlign.Left, 0)).toBe(0);
        expect(at(TextAlign.Center, 0)).toBeCloseTo(-50, 5);
        expect(at(TextAlign.Right, 0)).toBeCloseTo(-100, 5);
        // Boxed: layoutText already aligned each line inside the width, so the
        // block itself does not move.
        for (const align of Object.values(TextAlign)) expect(at(align, 400)).toBe(0);
    });
});
