// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { uiAbsoluteMove, uiFlowSlot, type UIInsetFields, type UIRect } from '../src/ui/core/placement';
import { DimensionUnit } from '../src/ui/core/dimension';
import { FlexDirection } from '../src/ui/layout/flex';

const px = (value: number) => ({ value, unit: DimensionUnit.Px });
const pct = (value: number) => ({ value, unit: DimensionUnit.Percent });
const auto = { value: 0, unit: DimensionUnit.Auto };

function node(over: Partial<UIInsetFields> = {}): UIInsetFields {
    return {
        insetLeft: auto, insetTop: auto, insetRight: auto, insetBottom: auto,
        marginLeft: px(0), marginTop: px(0), marginRight: px(0), marginBottom: px(0),
        ...over,
    };
}

// A 400×200 parent centred on the origin; a 40×20 node whose top-left is 50 px in and 30 px down.
const parent: UIRect = { cx: 0, cy: 0, hw: 200, hh: 100 };
const box: UIRect = { cx: -200 + 50 + 20, cy: 100 - 30 - 10, hw: 20, hh: 10 };

describe('uiAbsoluteMove', () => {
    it('moves a pixel inset by the drag, with layout y running down', () => {
        const patch = uiAbsoluteMove(node({ insetLeft: px(50), insetTop: px(30) }), box, parent, 10, 5);
        expect(patch).toEqual({ insetLeft: px(60), insetTop: px(25) });
    });

    it('keeps a right anchor anchored: the far side moves the other way, in its own unit', () => {
        const patch = uiAbsoluteMove(node({ insetRight: pct(10) }), box, parent, 40, 0);
        expect(patch).toEqual({ insetRight: pct(0) });
    });

    it('pins an axis with no inset set at the near edge where it is drawn', () => {
        expect(uiAbsoluteMove(node(), box, parent, 10, 0)).toEqual({ insetLeft: px(60) });
    });

    it('drops an auto margin that would hold the node centred against the move', () => {
        const patch = uiAbsoluteMove(node({ marginLeft: auto, marginRight: auto, insetLeft: px(50) }), box, parent, 10, 0);
        expect(patch).toEqual({ marginLeft: px(0), marginRight: px(0), insetLeft: px(60) });
    });

    it('writes nothing for an axis that did not move', () => {
        expect(uiAbsoluteMove(node({ insetLeft: px(50) }), box, parent, 0, 0)).toEqual({});
    });
});

describe('uiFlowSlot', () => {
    // Three 20×20 cells in a row at x = 10, 40, 70, all on y = 0.
    const row: UIRect[] = [10, 40, 70].map((cx) => ({ cx, cy: 0, hw: 10, hh: 10 }));

    it('counts the siblings before the point along a row', () => {
        expect(uiFlowSlot(FlexDirection.Row, row, { x: 0, y: 0 })).toBe(0);
        expect(uiFlowSlot(FlexDirection.Row, row, { x: 50, y: 3 })).toBe(2);
        expect(uiFlowSlot(FlexDirection.Row, row, { x: 99, y: 0 })).toBe(3);
    });

    it('reads a reversed row from the right', () => {
        expect(uiFlowSlot(FlexDirection.RowReverse, row, { x: 99, y: 0 })).toBe(0);
        expect(uiFlowSlot(FlexDirection.RowReverse, row, { x: 0, y: 0 })).toBe(3);
    });

    it('runs a column downward, y being up', () => {
        const column: UIRect[] = [0, -30, -60].map((cy) => ({ cx: 0, cy, hw: 10, hh: 10 }));
        expect(uiFlowSlot(FlexDirection.Column, column, { x: 0, y: 5 })).toBe(0);
        expect(uiFlowSlot(FlexDirection.Column, column, { x: 0, y: -45 })).toBe(2);
        expect(uiFlowSlot(FlexDirection.ColumnReverse, column, { x: 0, y: -45 })).toBe(1);
    });

    it('reads a wrapped row like text: a whole earlier line comes first', () => {
        const wrapped: UIRect[] = [
            { cx: 10, cy: 0, hw: 10, hh: 10 }, { cx: 40, cy: 0, hw: 10, hh: 10 },
            { cx: 10, cy: -30, hw: 10, hh: 10 }, { cx: 40, cy: -30, hw: 10, hh: 10 },
        ];
        // Left of the second line's first cell: both cells of line one come before it.
        expect(uiFlowSlot(FlexDirection.Row, wrapped, { x: 0, y: -30 })).toBe(2);
        expect(uiFlowSlot(FlexDirection.Row, wrapped, { x: 99, y: 0 })).toBe(2);
    });
});
