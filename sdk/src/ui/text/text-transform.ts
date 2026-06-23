// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/text/text-transform.ts
 * @brief   Pure placement helpers for SDF text: the entity
 *          world matrix and the rect→text-box mapping. No component here — the
 *          canonical text component is core/text.ts `Text`, rendered by the SDF
 *          text plugin.
 */
import type { Vec3, Quat } from '../../types';

/** Style bit flags — bold | italic (the atlas cache-key + rasterizer style arg). */
export const UI_TEXT_BOLD = 1;
export const UI_TEXT_ITALIC = 2;

/**
 * Compose a column-major mat4 into `out` from translation, rotation quaternion,
 * and scale — the entity world transform applied to glyph local positions at
 * submit. Pure (gl-matrix fromRotationTranslationScale), unit-testable.
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
 * Place a text block inside a UINode box. The entity Transform sits at the box's
 * pivot (UI layout positions the pivot), so glyph local positions (baseline y=0,
 * y-up) are offset to the box's top-left; the box width is the wrap/align area
 * and `boxHeight` lets the renderer apply vertical alignment. Top-vertical by
 * default: the first line's baseline is one ascent below the box top
 * (ascent ≈ fontSize × 0.8). Pure.
 */
export function rectTextBox(
    pivotX: number, pivotY: number, width: number, height: number, fontSizePx: number,
): { originX: number; originY: number; maxWidth: number; boxHeight: number } {
    return {
        originX: -pivotX * width,
        originY: (1 - pivotY) * height - fontSizePx * 0.8,
        maxWidth: width,
        boxHeight: height,
    };
}
