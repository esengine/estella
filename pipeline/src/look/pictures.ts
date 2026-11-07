// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  pictures.ts — pictures laid out so an agent can look at them together.
 *
 *        An agent judges a look by looking, so nothing here gives a verdict: it cuts, scales and lays pictures
 *        side by side, draws one over another to show whether the shapes line up, and reads the exact colours,
 *        which an eye cannot give as numbers to paint with.
 *        Pure: pixels in, pixels out, so a test and the editor run the same code.
 */

export interface RgbaImage {
    width: number;
    height: number;
    rgba: Uint8Array | Uint8ClampedArray;
}

export interface Region { x: number; y: number; w: number; h: number }

export interface PaletteEntry { color: string; share: number }

export interface PictureColors {
    /** What most of the picture is made of, largest first. */
    palette: PaletteEntry[];
    /** The colour each band of tones leans to, as a grade or a light would set it. */
    shadows: string;
    mids: string;
    highlights: string;
}

const COLOR_EDGE = 256;
const PALETTE_SIZE = 6;
/** A row or column this dark in nearly all of it is a bar around the picture, not the picture. */
const BAR_LEVEL = 14;
const BAR_SHARE = 0.985;
/** The share of a reference's pixels drawn as its outline: its strongest edges, whatever its contrast. */
const OUTLINE_SHARE = 0.08;
const OUTLINE_COLOR = [255, 225, 0] as const;
const LINE_GREY = 110;

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const labF = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

/** sRGB bytes to CIE Lab, through a table for speed: a picture has thousands of pixels and each needs three of these. */
const LINEAR = Float64Array.from({ length: 256 }, (_, i) => toLinear(i / 255));
function toLab(r: number, g: number, b: number, out: number[]): void {
    const [lr, lg, lb] = [LINEAR[r]!, LINEAR[g]!, LINEAR[b]!];
    const fx = labF((0.4124 * lr + 0.3576 * lg + 0.1805 * lb) / 0.95047);
    const fy = labF(0.2126 * lr + 0.7152 * lg + 0.0722 * lb);
    const fz = labF((0.0193 * lr + 0.1192 * lg + 0.9505 * lb) / 1.08883);
    out[0] = 116 * fy - 16;
    out[1] = 500 * (fx - fy);
    out[2] = 200 * (fy - fz);
}

const hex = (r: number, g: number, b: number): string =>
    `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

/** The picture inside any black bars: a recording of a film has them, and they are not part of what it shows. */
export function activeArea(image: RgbaImage): Region {
    const { width, height, rgba } = image;
    const darkRow = (y: number): boolean => {
        let dark = 0;
        for (let x = 0; x < width; x += 2) {
            const at = (y * width + x) * 4;
            if (rgba[at]! < BAR_LEVEL && rgba[at + 1]! < BAR_LEVEL && rgba[at + 2]! < BAR_LEVEL) dark++;
        }
        return dark >= (width / 2) * BAR_SHARE;
    };
    const darkColumn = (x: number): boolean => {
        let dark = 0;
        for (let y = 0; y < height; y += 2) {
            const at = (y * width + x) * 4;
            if (rgba[at]! < BAR_LEVEL && rgba[at + 1]! < BAR_LEVEL && rgba[at + 2]! < BAR_LEVEL) dark++;
        }
        return dark >= (height / 2) * BAR_SHARE;
    };
    let top = 0, bottom = height - 1, left = 0, right = width - 1;
    while (top < bottom && darkRow(top)) top++;
    while (bottom > top && darkRow(bottom)) bottom--;
    while (left < right && darkColumn(left)) left++;
    while (right > left && darkColumn(right)) right--;
    // A picture that is nearly all dark is a night scene, not a sliver between bars.
    if ((bottom - top + 1) * (right - left + 1) < width * height * 0.05) return { x: 0, y: 0, w: width, h: height };
    return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

/** A part of an image, by pixels. */
export function cropImage(image: RgbaImage, r: Region): RgbaImage {
    const [x0, y0] = [Math.max(0, Math.floor(r.x)), Math.max(0, Math.floor(r.y))];
    const width = Math.max(1, Math.min(image.width - x0, Math.round(r.w)));
    const height = Math.max(1, Math.min(image.height - y0, Math.round(r.h)));
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        const from = ((y0 + y) * image.width + x0) * 4;
        rgba.set(image.rgba.subarray(from, from + width * 4), y * width * 4);
    }
    return { width, height, rgba };
}

/** The picture at this size, each pixel the mean of what falls in it. */
export function resizeImage(image: RgbaImage, width: number, height: number): RgbaImage {
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        const [sy0, sy1] = [Math.floor((y * image.height) / height), Math.max(Math.floor((y * image.height) / height) + 1, Math.floor(((y + 1) * image.height) / height))];
        for (let x = 0; x < width; x++) {
            const [sx0, sx1] = [Math.floor((x * image.width) / width), Math.max(Math.floor((x * image.width) / width) + 1, Math.floor(((x + 1) * image.width) / width))];
            let [r, g, b, n] = [0, 0, 0, 0];
            for (let sy = sy0; sy < Math.min(sy1, image.height); sy++) {
                for (let sx = sx0; sx < Math.min(sx1, image.width); sx++) {
                    const at = (sy * image.width + sx) * 4;
                    r += image.rgba[at]!; g += image.rgba[at + 1]!; b += image.rgba[at + 2]!; n++;
                }
            }
            const to = (y * width + x) * 4;
            rgba[to] = r / n; rgba[to + 1] = g / n; rgba[to + 2] = b / n; rgba[to + 3] = 255;
        }
    }
    return { width, height, rgba };
}

/** A picture cut to a shape from its middle: stretching it would make every proportion in it wrong. */
export function toShape(image: RgbaImage, aspect: number): RgbaImage {
    const own = image.width / image.height;
    if (Math.abs(own - aspect) < 0.01) return image;
    return own > aspect
        ? cropImage(image, { x: (image.width - image.height * aspect) / 2, y: 0, w: image.height * aspect, h: image.height })
        : cropImage(image, { x: 0, y: (image.height - image.width / aspect) / 2, w: image.width, h: image.width / aspect });
}

/** Colours most of a picture is made of, largest first. The same picture gives the same answer: it starts from bands of lightness, not at random. */
function paletteOf(lab: Float64Array, rgba: ArrayLike<number>, count: number): PaletteEntry[] {
    const sorted = Array.from({ length: count }, (_, i) => i).sort((a, b) => lab[a * 3]! - lab[b * 3]!);
    const centres = Array.from({ length: PALETTE_SIZE }, (_, k) => {
        const i = sorted[Math.floor(((k + 0.5) / PALETTE_SIZE) * count)]!;
        return [lab[i * 3]!, lab[i * 3 + 1]!, lab[i * 3 + 2]!];
    });
    const owner = new Uint8Array(count);
    for (let pass = 0; pass < 8; pass++) {
        const sums = centres.map(() => [0, 0, 0, 0]);
        for (let i = 0; i < count; i++) {
            let best = Infinity;
            for (let k = 0; k < PALETTE_SIZE; k++) {
                const c = centres[k]!;
                const d = (lab[i * 3]! - c[0]!) ** 2 + (lab[i * 3 + 1]! - c[1]!) ** 2 + (lab[i * 3 + 2]! - c[2]!) ** 2;
                if (d < best) { best = d; owner[i] = k; }
            }
            const s = sums[owner[i]!]!;
            s[0]! += lab[i * 3]!; s[1]! += lab[i * 3 + 1]!; s[2]! += lab[i * 3 + 2]!; s[3]!++;
        }
        sums.forEach((s, k) => { if (s[3]) centres[k] = [s[0]! / s[3]!, s[1]! / s[3]!, s[2]! / s[3]!]; });
    }
    const totals = centres.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < count; i++) {
        const t = totals[owner[i]!]!;
        t[0]! += rgba[i * 4]!; t[1]! += rgba[i * 4 + 1]!; t[2]! += rgba[i * 4 + 2]!; t[3]!++;
    }
    return totals.filter((t) => t[3]! > 0)
        .map((t) => ({ color: hex(t[0]! / t[3]!, t[1]! / t[3]!, t[2]! / t[3]!), share: Math.round((t[3]! / count) * 1000) / 1000 }))
        .sort((a, b) => b.share - a.share);
}

/** The exact colours of a picture: what to paint with, as an eye reads colour well and its value badly. */
export function colorsOf(source: RgbaImage): PictureColors {
    const k = Math.min(1, COLOR_EDGE / Math.max(source.width, source.height));
    const image = k === 1 ? source : resizeImage(source, Math.max(1, Math.round(source.width * k)), Math.max(1, Math.round(source.height * k)));
    const { rgba } = image;
    const count = image.width * image.height;
    const lab = new Float64Array(count * 3);
    const px = [0, 0, 0];
    const bands = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    for (let i = 0; i < count; i++) {
        toLab(rgba[i * 4]!, rgba[i * 4 + 1]!, rgba[i * 4 + 2]!, px);
        lab[i * 3] = px[0]!; lab[i * 3 + 1] = px[1]!; lab[i * 3 + 2] = px[2]!;
        const band = bands[px[0]! < 30 ? 0 : px[0]! < 65 ? 1 : 2]!;
        band[0]! += rgba[i * 4]!; band[1]! += rgba[i * 4 + 1]!; band[2]! += rgba[i * 4 + 2]!; band[3]!++;
    }
    const bandColor = (b: number[]): string => (b[3] ? hex(b[0]! / b[3]!, b[1]! / b[3]!, b[2]! / b[3]!) : '#808080');
    return { palette: paletteOf(lab, rgba, count), shadows: bandColor(bands[0]!), mids: bandColor(bands[1]!), highlights: bandColor(bands[2]!) };
}

/** One picture seen through another at the same size: half of each. */
export function blendImages(under: RgbaImage, over: RgbaImage): RgbaImage {
    const top = over.width === under.width && over.height === under.height ? over : resizeImage(over, under.width, under.height);
    const rgba = new Uint8Array(under.width * under.height * 4);
    for (let i = 0; i < rgba.length; i += 4) {
        rgba[i] = (under.rgba[i]! + top.rgba[i]!) / 2;
        rgba[i + 1] = (under.rgba[i + 1]! + top.rgba[i + 1]!) / 2;
        rgba[i + 2] = (under.rgba[i + 2]! + top.rgba[i + 2]!) / 2;
        rgba[i + 3] = 255;
    }
    return { width: under.width, height: under.height, rgba };
}

/** A picture with the strongest edges of another drawn on it, to see whether the shapes in the two line up. */
export function outlineOver(under: RgbaImage, outlined: RgbaImage): RgbaImage {
    const { width, height } = under;
    const shape = outlined.width === width && outlined.height === height ? outlined : resizeImage(outlined, width, height);
    const gray = new Float32Array(width * height);
    for (let i = 0; i < gray.length; i++) gray[i] = shape.rgba[i * 4]! * 0.3 + shape.rgba[i * 4 + 1]! * 0.59 + shape.rgba[i * 4 + 2]! * 0.11;
    const edge = new Float32Array(width * height);
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const at = y * width + x;
            edge[at] = Math.abs(gray[at + 1]! - gray[at - 1]!) + Math.abs(gray[at + width]! - gray[at - width]!);
        }
    }
    const cut = Float32Array.from(edge).sort()[Math.floor(edge.length * (1 - OUTLINE_SHARE))]!;
    const rgba = Uint8Array.from(under.rgba);
    for (let i = 0; i < edge.length; i++) {
        if (edge[i]! > cut && edge[i]! > 0) rgba.set(OUTLINE_COLOR, i * 4);
    }
    return { width, height, rgba };
}

const filled = (width: number, height: number): Uint8Array => {
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) { rgba[i * 4] = LINE_GREY; rgba[i * 4 + 1] = LINE_GREY; rgba[i * 4 + 2] = LINE_GREY; rgba[i * 4 + 3] = 255; }
    return rgba;
};

/** A 3x5 digit, row by row from the top, one bit a column. */
const GLYPHS: Record<string, readonly number[]> = {
    '0': [7, 5, 5, 5, 7], '1': [2, 6, 2, 2, 7], '2': [7, 1, 7, 4, 7], '3': [7, 1, 7, 1, 7], '4': [5, 5, 7, 1, 1],
    '5': [7, 4, 7, 1, 7], '6': [7, 4, 7, 5, 7], '7': [7, 1, 2, 2, 2], '8': [7, 5, 7, 5, 7], '9': [7, 5, 7, 1, 7],
    '-': [0, 0, 7, 0, 0], '.': [0, 0, 0, 0, 2],
};
const GLYPH_SCALE = 2;
const RULER_WIDTH = 1400;

function label(image: RgbaImage, text: string, x: number, y: number): void {
    const { width, height, rgba } = image;
    const w = text.length * 4 * GLYPH_SCALE + GLYPH_SCALE, h = 7 * GLYPH_SCALE;
    const set = (px: number, py: number, v: number): void => {
        if (px < 0 || py < 0 || px >= width || py >= height) return;
        const at = (py * width + px) * 4;
        rgba[at] = v; rgba[at + 1] = v; rgba[at + 2] = v;
    };
    for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) set(x + px, y + py, 0);
    [...text].forEach((c, n) => {
        const rows = GLYPHS[c];
        if (!rows) return;
        rows.forEach((bits, row) => {
            for (let col = 0; col < 3; col++) {
                if (!((bits >> (2 - col)) & 1)) continue;
                for (let a = 0; a < GLYPH_SCALE; a++) for (let b = 0; b < GLYPH_SCALE; b++) set(x + GLYPH_SCALE + (n * 4 + col) * GLYPH_SCALE + a, y + GLYPH_SCALE + row * GLYPH_SCALE + b, 255);
            }
        });
    });
}

/** What a picture's edges are in some other measure: its left and right, its top and bottom. */
export interface RulerSpan { left: number; right: number; top: number; bottom: number }

/** A round distance between lines that puts about a dozen of them across this span. */
export function rulerStep(across: number): number {
    const rough = Math.abs(across) / 12;
    const power = 10 ** Math.floor(Math.log10(rough));
    return [1, 2, 5, 10].map((k) => k * power).find((k) => k >= rough)!;
}

/**
 * A picture with a numbered grid on it, so a place in it can be read off as coordinates: what is seen can then be written down
 * as an outline or a line to model. Enlarged first, as a close-up is few pixels and the numbers want room. Every fifth line is stronger.
 */
export function rulerOver(source: RgbaImage, span: RulerSpan, step = rulerStep(span.right - span.left)): RgbaImage {
    if (!(step > 0)) throw new Error(`step ${step} must be positive`);
    const k = Math.max(1, RULER_WIDTH / source.width);
    const scaled = k === 1 ? source : resizeImage(source, Math.round(source.width * k), Math.round(source.height * k));
    const image: RgbaImage = { width: scaled.width, height: scaled.height, rgba: Uint8Array.from(scaled.rgba) };
    const { width, height, rgba } = image;
    const lighten = (at: number, share: number): void => {
        rgba[at] = rgba[at]! + (255 - rgba[at]!) * share; rgba[at + 1] = rgba[at + 1]! + (255 - rgba[at + 1]!) * share; rgba[at + 2] = rgba[at + 2]! + (255 - rgba[at + 2]!) * share;
    };
    const digits = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
    const lines = (lo: number, hi: number): number[] => {
        const [a, b] = lo < hi ? [lo, hi] : [hi, lo];
        const out: number[] = [];
        for (let n = Math.ceil(a / step - 1e-9); n * step <= b + step * 1e-9; n++) out.push(n);
        return out;
    };
    const across = lines(span.left, span.right), down = lines(span.top, span.bottom);
    for (const n of across) {
        const x = Math.round(((n * step - span.left) / (span.right - span.left)) * (width - 1));
        for (let y = 0; y < height; y++) lighten((y * width + x) * 4, n % 5 === 0 ? 0.55 : 0.22);
    }
    for (const n of down) {
        const y = Math.round(((n * step - span.top) / (span.bottom - span.top)) * (height - 1));
        for (let x = 0; x < width; x++) lighten((y * width + x) * 4, n % 5 === 0 ? 0.55 : 0.22);
    }
    for (const n of across) label(image, (n * step).toFixed(digits), Math.round(((n * step - span.left) / (span.right - span.left)) * (width - 1)) + 2, 0);
    for (const n of down) label(image, (n * step).toFixed(digits), 0, Math.round(((n * step - span.top) / (span.bottom - span.top)) * (height - 1)) + 2);
    return image;
}

/** Pictures side by side at one height, with a thin line between. */
export function sideBySide(images: readonly RgbaImage[], height = 360): RgbaImage {
    const scaled = images.map((img) => resizeImage(img, Math.max(1, Math.round((img.width * height) / img.height)), height));
    const gap = 4;
    const width = scaled.reduce((sum, img) => sum + img.width, 0) + gap * (scaled.length - 1);
    const rgba = filled(width, height);
    let at = 0;
    for (const img of scaled) {
        for (let y = 0; y < height; y++) rgba.set(img.rgba.subarray(y * img.width * 4, (y + 1) * img.width * 4), (y * width + at) * 4);
        at += img.width + gap;
    }
    return { width, height, rgba };
}

/** A picture whole inside a cell of this size, centred on a grey ground: a video's frames need not all be one shape. */
function fitInto(image: RgbaImage, width: number, height: number): RgbaImage {
    const k = Math.min(width / image.width, height / image.height);
    const scaled = resizeImage(image, Math.max(1, Math.round(image.width * k)), Math.max(1, Math.round(image.height * k)));
    const rgba = filled(width, height);
    const [ox, oy] = [Math.floor((width - scaled.width) / 2), Math.floor((height - scaled.height) / 2)];
    for (let y = 0; y < scaled.height; y++) rgba.set(scaled.rgba.subarray(y * scaled.width * 4, (y + 1) * scaled.width * 4), ((oy + y) * width + ox) * 4);
    return { width, height, rgba };
}

/** Pictures in a grid of equal cells, row by row, each at its own shape: the cell is the size most of them have. */
export function gridOf(images: readonly RgbaImage[], columns: number): RgbaImage {
    const seen = new Map<string, number>();
    for (const img of images) seen.set(`${img.width}x${img.height}`, (seen.get(`${img.width}x${img.height}`) ?? 0) + 1);
    const common = [...seen.entries()].sort((a, b) => b[1] - a[1])[0]![0].split('x').map(Number);
    const [cw, ch] = [common[0]!, common[1]!];
    const rows = Math.ceil(images.length / columns);
    const gap = 3;
    const width = cw * columns + gap * (columns - 1), height = ch * rows + gap * (rows - 1);
    const rgba = filled(width, height);
    images.forEach((img, n) => {
        const [ox, oy] = [(n % columns) * (cw + gap), Math.floor(n / columns) * (ch + gap)];
        const fitted = img.width === cw && img.height === ch ? img : fitInto(img, cw, ch);
        for (let y = 0; y < ch; y++) rgba.set(fitted.rgba.subarray(y * cw * 4, (y + 1) * cw * 4), ((oy + y) * width + ox) * 4);
    });
    return { width, height, rgba };
}
