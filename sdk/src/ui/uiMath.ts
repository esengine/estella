export interface ScreenRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export function intersectRects(a: ScreenRect, b: ScreenRect): ScreenRect {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const r = Math.min(a.x + a.w, b.x + b.w);
    const t = Math.min(a.y + a.h, b.y + b.h);
    return { x, y, w: Math.max(0, r - x), h: Math.max(0, t - y) };
}

export function worldRectToScreen(
    worldX: number, worldY: number,
    worldW: number, worldH: number,
    pivotX: number, pivotY: number,
    vp: Float32Array,
    vpX: number, vpY: number, vpW: number, vpH: number
): ScreenRect {
    const left = worldX - worldW * pivotX;
    const right = worldX + worldW * (1 - pivotX);
    const bottom = worldY - worldH * pivotY;
    const top = worldY + worldH * (1 - pivotY);

    function toScreen(wx: number, wy: number): [number, number] {
        const clipX = vp[0] * wx + vp[4] * wy + vp[12];
        const clipY = vp[1] * wx + vp[5] * wy + vp[13];
        const clipW = vp[3] * wx + vp[7] * wy + vp[15];
        const ndcX = clipX / clipW;
        const ndcY = clipY / clipW;
        return [
            vpX + (ndcX * 0.5 + 0.5) * vpW,
            vpY + (ndcY * 0.5 + 0.5) * vpH,
        ];
    }

    const [px0, py0] = toScreen(left, bottom);
    const [px1, py1] = toScreen(right, top);

    const minX = Math.min(px0, px1);
    const maxX = Math.max(px0, px1);
    const minY = Math.min(py0, py1);
    const maxY = Math.max(py0, py1);

    return {
        x: Math.round(minX),
        y: Math.round(minY),
        w: Math.round(maxX - minX),
        h: Math.round(maxY - minY),
    };
}

export function invertMatrix4(m: Float32Array, result?: Float32Array): Float32Array {
    const out = result ?? new Float32Array(16);

    const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
    const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
    const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
    const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];

    const b00 = a00 * a11 - a01 * a10;
    const b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11;
    const b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30;
    const b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31;
    const b11 = a22 * a33 - a23 * a32;

    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (Math.abs(det) < 1e-8) return out;
    det = 1.0 / det;

    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;

    return out;
}

export function screenToWorld(
    screenX: number, screenY: number,
    inverseVP: Float32Array,
    vpX: number, vpY: number, vpW: number, vpH: number
): { x: number; y: number } {
    const ndcX = ((screenX - vpX) / vpW) * 2 - 1;
    const ndcY = ((screenY - vpY) / vpH) * 2 - 1;

    const wx = inverseVP[0] * ndcX + inverseVP[4] * ndcY + inverseVP[12];
    const wy = inverseVP[1] * ndcX + inverseVP[5] * ndcY + inverseVP[13];
    const ww = inverseVP[3] * ndcX + inverseVP[7] * ndcY + inverseVP[15];

    return { x: wx / ww, y: wy / ww };
}

export function pointInWorldRect(
    px: number, py: number,
    worldX: number, worldY: number,
    worldW: number, worldH: number,
    pivotX: number, pivotY: number
): boolean {
    const left = worldX - worldW * pivotX;
    const right = worldX + worldW * (1 - pivotX);
    const bottom = worldY - worldH * pivotY;
    const top = worldY + worldH * (1 - pivotY);
    return px >= left && px <= right && py >= bottom && py <= top;
}
