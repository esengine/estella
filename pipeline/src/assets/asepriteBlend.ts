// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Aseprite's layer blending, on 8-bit non-premultiplied RGBA.
 *
 *        Every mode the format can store is here rather than a subset with a
 *        warning attached, because a composite that is silently NOT what the
 *        artist drew is the one failure a pixel-art import must not have. The
 *        arithmetic is the editor's own — integer, with its rounding — so a
 *        frame composited here matches the one Aseprite shows, byte for byte.
 */
import { AsepriteBlend } from './asepriteFile';

/** Aseprite's rounded 8-bit multiply: exactly round(a*b/255). */
function mul8(a: number, b: number): number {
    const t = a * b + 0x80;
    return ((t >> 8) + t) >> 8;
}

/** Aseprite's 8-bit divide, rounded — only called where b < s, so it stays in range. */
function div8(a: number, b: number): number {
    return Math.min(255, Math.floor((a * 255 + Math.floor(b / 2)) / b));
}

const screen = (b: number, s: number): number => b + s - mul8(b, s);
const hardLight = (b: number, s: number): number =>
    (s < 128 ? mul8(b, s << 1) : screen(b, (s << 1) - 255));

function softLight(b: number, s: number): number {
    const bd = b / 255;
    const sd = s / 255;
    const d = bd <= 0.25 ? ((16 * bd - 12) * bd + 4) * bd : Math.sqrt(bd);
    const r = sd <= 0.5
        ? bd - (1 - 2 * sd) * bd * (1 - bd)
        : bd + (2 * sd - 1) * (d - bd);
    return Math.max(0, Math.min(255, Math.round(r * 255)));
}

function colorDodge(b: number, s: number): number {
    if (b === 0) return 0;
    const inv = 255 - s;
    return b >= inv ? 255 : div8(b, inv);
}

function colorBurn(b: number, s: number): number {
    if (b === 255) return 255;
    const inv = 255 - b;
    return inv >= s ? 0 : 255 - div8(inv, s);
}

function divide(b: number, s: number): number {
    if (b === 0) return 0;
    return b >= s ? 255 : div8(b, s);
}

// The four HSL modes work on all three channels at once, so they carry their own
// triple-valued helpers. Photoshop's definitions, which is what Aseprite implements.

const luminosity = (c: number[]): number => 0.3 * c[0]! + 0.59 * c[1]! + 0.11 * c[2]!;
const saturation = (c: number[]): number => Math.max(...c) - Math.min(...c);

function clipColor(c: number[]): number[] {
    const l = luminosity(c);
    const min = Math.min(...c);
    const max = Math.max(...c);
    let out = c;
    if (min < 0) out = out.map((v) => l + ((v - l) * l) / (l - min || 1));
    if (max > 1) out = out.map((v) => l + ((v - l) * (1 - l)) / ((max - l) || 1));
    return out;
}

function setLum(c: number[], l: number): number[] {
    const d = l - luminosity(c);
    return clipColor(c.map((v) => v + d));
}

function setSat(c: number[], s: number): number[] {
    const max = Math.max(...c);
    const min = Math.min(...c);
    const range = max - min;
    return c.map((v) => (range > 0 ? ((v - min) * s) / range : 0));
}

/** The blended colour of one mode, before the alpha compositing every mode shares. */
function blendChannels(mode: AsepriteBlend, b: number[], s: number[]): number[] {
    switch (mode) {
        case AsepriteBlend.Multiply: return b.map((v, i) => mul8(v, s[i]!));
        case AsepriteBlend.Screen: return b.map((v, i) => screen(v, s[i]!));
        case AsepriteBlend.Overlay: return b.map((v, i) => hardLight(s[i]!, v));
        case AsepriteBlend.Darken: return b.map((v, i) => Math.min(v, s[i]!));
        case AsepriteBlend.Lighten: return b.map((v, i) => Math.max(v, s[i]!));
        case AsepriteBlend.ColorDodge: return b.map((v, i) => colorDodge(v, s[i]!));
        case AsepriteBlend.ColorBurn: return b.map((v, i) => colorBurn(v, s[i]!));
        case AsepriteBlend.HardLight: return b.map((v, i) => hardLight(v, s[i]!));
        case AsepriteBlend.SoftLight: return b.map((v, i) => softLight(v, s[i]!));
        case AsepriteBlend.Difference: return b.map((v, i) => Math.abs(v - s[i]!));
        case AsepriteBlend.Exclusion: return b.map((v, i) => v + s[i]! - 2 * mul8(v, s[i]!));
        case AsepriteBlend.Addition: return b.map((v, i) => Math.min(255, v + s[i]!));
        case AsepriteBlend.Subtract: return b.map((v, i) => Math.max(0, v - s[i]!));
        case AsepriteBlend.Divide: return b.map((v, i) => divide(v, s[i]!));
        case AsepriteBlend.Hue:
        case AsepriteBlend.Saturation:
        case AsepriteBlend.Color:
        case AsepriteBlend.Luminosity: {
            const bf = b.map((v) => v / 255);
            const sf = s.map((v) => v / 255);
            const out = mode === AsepriteBlend.Hue
                ? setLum(setSat(sf, saturation(bf)), luminosity(bf))
                : mode === AsepriteBlend.Saturation
                    ? setLum(setSat(bf, saturation(sf)), luminosity(bf))
                    : mode === AsepriteBlend.Color
                        ? setLum(sf, luminosity(bf))
                        : setLum(bf, luminosity(sf));
            return out.map((v) => Math.max(0, Math.min(255, Math.round(v * 255))));
        }
        default: return s;
    }
}

/**
 * Blend one source pixel over one backdrop pixel, in place in `dst` at `di`.
 *
 * `opacity` is the layer's times the cel's — the two multipliers Aseprite applies
 * before any mode sees the pixel. Alpha stays straight, never premultiplied: that
 * is what the format stores and what a PNG expects.
 */
export function blendPixel(dst: Uint8Array, di: number, src: Uint8Array, si: number,
                           mode: AsepriteBlend, opacity: number): void {
    const sa = mul8(src[si + 3]!, opacity);
    if (sa === 0) return;
    const ba = dst[di + 3]!;

    let sr = src[si]!;
    let sg = src[si + 1]!;
    let sb = src[si + 2]!;
    if (mode !== AsepriteBlend.Normal && ba !== 0) {
        const [r, g, b] = blendChannels(mode, [dst[di]!, dst[di + 1]!, dst[di + 2]!], [sr, sg, sb]);
        sr = r!; sg = g!; sb = b!;
    }

    if (ba === 0) {
        dst[di] = sr; dst[di + 1] = sg; dst[di + 2] = sb; dst[di + 3] = sa;
        return;
    }

    // Straight-alpha "over": the result's alpha first, because the colour is a
    // walk from backdrop to source weighted by how much of the result is source.
    const ra = sa + ba - mul8(ba, sa);
    dst[di] = dst[di]! + Math.round(((sr - dst[di]!) * sa) / ra);
    dst[di + 1] = dst[di + 1]! + Math.round(((sg - dst[di + 1]!) * sa) / ra);
    dst[di + 2] = dst[di + 2]! + Math.round(((sb - dst[di + 2]!) * sa) / ra);
    dst[di + 3] = ra;
}
