import {
    FlexDirection, JustifyContent, AlignItems, FlexWrap,
} from 'esengine';
import type { Color } from 'esengine';

// Canvas + geometry (design resolution 800×600).
export const CANVAS_W = 800;
export const CTRL_W = 142;
export const CTRL_H = 34;
export const CTRL_GAP = 10;

export const DEMO_W = 660;
export const DEMO_H = 392;
export const DEMO_TOP = 108;
export const DEMO_PAD = 16;
export const DEMO_GAP = 12;

export const ITEM_W = 74;
// Varied heights so align-items (the cross axis in row flow) is visible.
export const ITEM_HEIGHTS = [58, 92, 66, 104, 74, 60, 96, 52];

// Each control is one option list; the button shows the short label, the
// readout line spells out the CSS-equivalent value.
export interface Opt { short: string; css: string; value: number; }

export const DIRECTIONS: Opt[] = [
    { short: 'Row', css: 'row', value: FlexDirection.Row },
    { short: 'Column', css: 'column', value: FlexDirection.Column },
    { short: 'Row-rev', css: 'row-reverse', value: FlexDirection.RowReverse },
    { short: 'Col-rev', css: 'column-reverse', value: FlexDirection.ColumnReverse },
];

export const JUSTIFY: Opt[] = [
    { short: 'Start', css: 'flex-start', value: JustifyContent.Start },
    { short: 'Center', css: 'center', value: JustifyContent.Center },
    { short: 'End', css: 'flex-end', value: JustifyContent.End },
    { short: 'Between', css: 'space-between', value: JustifyContent.SpaceBetween },
    { short: 'Around', css: 'space-around', value: JustifyContent.SpaceAround },
    { short: 'Evenly', css: 'space-evenly', value: JustifyContent.SpaceEvenly },
];

export const ALIGN: Opt[] = [
    { short: 'Start', css: 'flex-start', value: AlignItems.Start },
    { short: 'Center', css: 'center', value: AlignItems.Center },
    { short: 'End', css: 'flex-end', value: AlignItems.End },
    { short: 'Stretch', css: 'stretch', value: AlignItems.Stretch },
];

export const WRAP: Opt[] = [
    { short: 'No-wrap', css: 'nowrap', value: FlexWrap.NoWrap },
    { short: 'Wrap', css: 'wrap', value: FlexWrap.Wrap },
];

export const COUNTS = [4, 5, 6, 8];

// Item fill: a smooth hue wheel (same family as the other UI examples).
export function itemColor(i: number): Color {
    const h = (208 + i * 42) % 360 / 360;
    const s = 0.5, l = 0.6;
    const q = l + s - l * s, p = 2 * l - q;
    const f = (t: number): number => {
        t = (t % 1 + 1) % 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    const r = (v: number): number => +v.toFixed(3);
    return { r: r(f(h + 1 / 3)), g: r(f(h)), b: r(f(h - 1 / 3)), a: 1 };
}
