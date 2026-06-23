/**
 * @file    ui/text/ui-text.ts
 * @brief   UIText component — the opt-in driver for the dynamic SDF text path
 *          (REARCH_GUI P1.3c). Authored on entities (serializes via the scene
 *          system); the UITextPlugin pre-flush system renders it. Kept separate
 *          from the legacy core/text.ts Text (Canvas2D per-entity) so the two
 *          don't double-render; P1.4 migrates Text → UIText and retires the old
 *          path.
 */
import { defineComponent } from '../../component';
import type { Color, Vec3, Quat } from '../../types';

/** Style bit flags — bold | italic. */
export const UI_TEXT_BOLD = 1;
export const UI_TEXT_ITALIC = 2;

export interface UITextData {
    content: string;
    fontFamily: string;
    fontSizePx: number;
    color: Color;
    /** Bit flags: UI_TEXT_BOLD | UI_TEXT_ITALIC. */
    style: number;
    layer: number;
    /** Parse `<b>/<i>/<color>/<font size>` markup in `content`. */
    richText: boolean;
    /** Horizontal alignment: 0 left | 1 center | 2 right. */
    align: number;
    /** Baseline-to-baseline px for multi-line text; 0 = auto (fontSizePx × 1.2). */
    lineHeight: number;
    /** Word-wrap width in px (plain text); 0 = no wrap. */
    maxWidth: number;
}

export const UIText = defineComponent<UITextData>('UIText', {
    content: '',
    fontFamily: 'sans-serif',
    fontSizePx: 24,
    color: { r: 1, g: 1, b: 1, a: 1 },
    style: 0,
    layer: 0,
    richText: false,
    align: 0,
    lineHeight: 0,
    maxWidth: 0,
});

/**
 * Compose a column-major mat4 into `out` from translation, rotation quaternion,
 * and scale — the entity world transform applied to glyph local positions at
 * submit. Pure (gl-matrix fromRotationTranslationScale), so it is unit-testable.
 */
export function composeTRS(out: Float32Array, t: Vec3, q: Quat, s: Vec3): Float32Array {
    const { x, y, z, w } = q;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    const sx = s.x, sy = s.y, sz = s.z;

    out[0] = (1 - (yy + zz)) * sx; out[1] = (xy + wz) * sx; out[2] = (xz - wy) * sx; out[3] = 0;
    out[4] = (xy - wz) * sy; out[5] = (1 - (xx + zz)) * sy; out[6] = (yz + wx) * sy; out[7] = 0;
    out[8] = (xz + wy) * sz; out[9] = (yz - wx) * sz; out[10] = (1 - (xx + yy)) * sz; out[11] = 0;
    out[12] = t.x; out[13] = t.y; out[14] = t.z; out[15] = 1;
    return out;
}

/**
 * Place a text block inside a UIRect (REARCH_GUI P1.4c). The entity Transform
 * sits at the rect's pivot (UI layout positions the pivot), so glyph local
 * positions (baseline y=0, y-up) need offsetting to the rect's top-left, and the
 * rect width becomes the wrap/align box. Top-vertical-aligned; first line's
 * baseline sits one ascent below the rect top (ascent ≈ fontSize × 0.8). Pure.
 */
export function rectTextBox(
    pivotX: number, pivotY: number, width: number, height: number, fontSizePx: number,
): { originX: number; originY: number; maxWidth: number } {
    return {
        originX: -pivotX * width,                          // rect left edge, local to the pivot
        originY: (1 - pivotY) * height - fontSizePx * 0.8, // rect top (y-up) minus first-line ascent
        maxWidth: width,
    };
}
