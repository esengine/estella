// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  trace.ts — shapes read out of a picture as lines of points.
 *
 *        An eye reading coordinates off a grid is out by a centimetre, which a face shows. So a part of a picture is
 *        grown from a place inside it, by colour, and its outline comes back as points; or the strongest edges come back as
 *        lines, for folds and strands. Nothing here says whether what it found is right: the caller looks at it on the picture.
 *        Pure: pixels in, points out.
 */
import type { RgbaImage } from './pictures';

export type PixelPoint = readonly [number, number];

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const labF = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
const LINEAR = Float64Array.from({ length: 256 }, (_, i) => toLinear(i / 255));

/** The picture in CIE Lab, softened by a pixel: a video frame's compression would otherwise break every region into specks. */
function labOf(image: RgbaImage): Float32Array {
    const { width, height, rgba } = image;
    const out = new Float32Array(width * height * 3);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let [r, g, b, n] = [0, 0, 0, 0];
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const [qx, qy] = [x + dx, y + dy];
                    if (qx < 0 || qy < 0 || qx >= width || qy >= height) continue;
                    const at = (qy * width + qx) * 4;
                    r += LINEAR[rgba[at]!]!; g += LINEAR[rgba[at + 1]!]!; b += LINEAR[rgba[at + 2]!]!; n++;
                }
            }
            [r, g, b] = [r / n, g / n, b / n];
            const fx = labF((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
            const fy = labF(0.2126 * r + 0.7152 * g + 0.0722 * b);
            const fz = labF((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
            const to = (y * width + x) * 3;
            out[to] = 116 * fy - 16; out[to + 1] = 500 * (fx - fy); out[to + 2] = 200 * (fy - fz);
        }
    }
    return out;
}

/** Morphology by a square: true grows what is set, false shrinks it. */
function widen(mask: Uint8Array, width: number, height: number, radius: number, grow: boolean): Uint8Array {
    if (radius <= 0) return mask;
    const pass = (from: Uint8Array, horizontal: boolean): Uint8Array => {
        const out = new Uint8Array(from.length);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let hit = grow ? 0 : 1;
                for (let d = -radius; d <= radius; d++) {
                    const [qx, qy] = horizontal ? [x + d, y] : [x, y + d];
                    // Off the picture counts as more of what is there: a part cut by the edge of a crop is not eaten from it.
                    const v = qx < 0 || qy < 0 || qx >= width || qy >= height ? (grow ? 0 : 1) : from[qy * width + qx]!;
                    if (grow ? v : !v) { hit = grow ? 1 : 0; break; }
                }
                out[y * width + x] = hit;
            }
        }
        return out;
    };
    return pass(pass(mask, true), false);
}

export interface GrowOptions {
    /** How far a colour may be from the seed's and still be the same thing, as a difference in Lab. Default 14: about what shading across one cloth comes to. */
    tolerance?: number;
    /** Pixels of fuzz taken off the outline, closing small gaps and dropping thin spurs. Default 2. */
    smooth?: number;
    /** Places known to be outside, which stop it where a colour alone would run on. */
    not?: readonly PixelPoint[];
}

/** What is connected to the seeds and looks like one of them, with its holes filled: a face is one thing with an eye in it. */
export function growRegion(image: RgbaImage, seeds: readonly PixelPoint[], options: GrowOptions = {}): Uint8Array {
    const { width, height } = image;
    if (seeds.length === 0) throw new Error('give at least one place inside what to trace');
    const inPicture = ([x, y]: PixelPoint): boolean => x >= 0 && y >= 0 && x < width && y < height;
    for (const seed of seeds) if (!inPicture(seed)) throw new Error(`a seed at ${seed[0].toFixed(1)}, ${seed[1].toFixed(1)} is off the picture, ${width} by ${height}`);
    const tolerance = options.tolerance ?? 14;
    if (!(tolerance > 0)) throw new Error(`tolerance ${tolerance} must be positive`);
    const smooth = options.smooth ?? 2;
    const lab = labOf(image);
    const colourAt = ([sx, sy]: PixelPoint): [number, number, number] => {
        const sum = [0, 0, 0];
        let n = 0;
        for (let y = Math.max(0, Math.round(sy) - 2); y <= Math.min(height - 1, Math.round(sy) + 2); y++) {
            for (let x = Math.max(0, Math.round(sx) - 2); x <= Math.min(width - 1, Math.round(sx) + 2); x++) {
                const at = (y * width + x) * 3;
                sum[0]! += lab[at]!; sum[1]! += lab[at + 1]!; sum[2]! += lab[at + 2]!; n++;
            }
        }
        return [sum[0]! / n, sum[1]! / n, sum[2]! / n];
    };
    const targets = seeds.map(colourAt);
    const avoid = (options.not ?? []).filter(inPicture).map(colourAt);
    const limit = tolerance * tolerance;
    const distance = (at: number, c: readonly number[]): number => (lab[at]! - c[0]!) ** 2 + (lab[at + 1]! - c[1]!) ** 2 + (lab[at + 2]! - c[2]!) ** 2;
    const fits = (i: number): boolean => {
        const at = i * 3;
        let best = Infinity;
        for (const t of targets) best = Math.min(best, distance(at, t));
        if (best > limit) return false;
        // Nearer something known to be outside than anything known to be in: not part of it.
        for (const a of avoid) if (distance(at, a) < best) return false;
        return true;
    };
    const flood = (allowed: (i: number) => boolean, starts: readonly number[]): Uint8Array => {
        const seen = new Uint8Array(width * height);
        const stack: number[] = [];
        for (const s of starts) if (!seen[s]) { seen[s] = 1; stack.push(s); }
        while (stack.length) {
            const i = stack.pop()!;
            const [x, y] = [i % width, Math.floor(i / width)];
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                const [qx, qy] = [x + dx, y + dy];
                if (qx < 0 || qy < 0 || qx >= width || qy >= height) continue;
                const q = qy * width + qx;
                if (seen[q] || !allowed(q)) continue;
                seen[q] = 1;
                stack.push(q);
            }
        }
        return seen;
    };
    const starts = seeds.map(([x, y]) => Math.round(y) * width + Math.round(x)).map((i) => Math.min(i, width * height - 1));
    const grown = flood(fits, starts);
    // Closed, then opened: gaps go first, so a thin place is not cut through by the second.
    const tidy = widen(widen(widen(grown, width, height, smooth, true), width, height, smooth * 2, false), width, height, smooth, true);
    // Only what is still joined to a seed; a seed the tidying ate holds its own place.
    for (const s of starts) tidy[s] = 1;
    const kept = flood((i) => tidy[i] === 1, starts);
    // The holes: whatever the outside cannot reach.
    const border: number[] = [];
    for (let x = 0; x < width; x++) { if (!kept[x]) border.push(x); if (!kept[(height - 1) * width + x]) border.push((height - 1) * width + x); }
    for (let y = 0; y < height; y++) { if (!kept[y * width]) border.push(y * width); if (!kept[y * width + width - 1]) border.push(y * width + width - 1); }
    const outside = flood((i) => !kept[i], border);
    const filled = new Uint8Array(width * height);
    for (let i = 0; i < filled.length; i++) filled[i] = outside[i] ? 0 : 1;
    return filled;
}

const CLOCKWISE: readonly PixelPoint[] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

/** The outer edge of the largest piece of a mask, as a walk round its border pixels, clockwise on screen. */
export function outlineOfMask(mask: Uint8Array, width: number, height: number): PixelPoint[] {
    // The largest piece, then its top-left pixel: the first of it a scan meets, whose neighbours above and to the left are not in it.
    const label = new Int32Array(width * height).fill(-1);
    let best = -1, bestSize = 0, bestStart = -1, next = 0;
    for (let i = 0; i < mask.length; i++) {
        if (!mask[i] || label[i] !== -1) continue;
        const stack = [i];
        label[i] = next;
        let size = 0;
        while (stack.length) {
            const at = stack.pop()!;
            size++;
            const [x, y] = [at % width, Math.floor(at / width)];
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                const [qx, qy] = [x + dx, y + dy];
                if (qx < 0 || qy < 0 || qx >= width || qy >= height) continue;
                const q = qy * width + qx;
                if (mask[q] && label[q] === -1) { label[q] = next; stack.push(q); }
            }
        }
        if (size > bestSize) { best = next; bestSize = size; bestStart = i; }
        next++;
    }
    if (best < 0) return [];
    const isIn = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height && label[y * width + x] === best;
    const start: PixelPoint = [bestStart % width, Math.floor(bestStart / width)];
    const out: PixelPoint[] = [start];
    let [x, y] = start;
    // Came from the left: nothing is there, as this is the first of it in its row.
    let from = 4;
    const firstFrom = from;
    for (let guard = 0; guard < mask.length * 4; guard++) {
        let moved = false;
        for (let turn = 1; turn <= 8; turn++) {
            const dir = (from + turn) % 8;
            const [dx, dy] = CLOCKWISE[dir]!;
            if (!isIn(x + dx, y + dy)) continue;
            x += dx; y += dy;
            // Looking back the way it came, less one, so as to hug the outside.
            from = (dir + 4) % 8;
            moved = true;
            break;
        }
        if (!moved) break;
        if (x === start[0] && y === start[1]) {
            // Home, and about to leave the way it left the first time: the walk is closed. A thin neck is passed twice, so home alone is not enough.
            let first = -1;
            for (let turn = 1; turn <= 8; turn++) {
                const dir = (from + turn) % 8;
                const [dx, dy] = CLOCKWISE[dir]!;
                if (isIn(x + dx, y + dy)) { first = dir; break; }
            }
            let original = -1;
            for (let turn = 1; turn <= 8; turn++) {
                const dir = (firstFrom + turn) % 8;
                const [dx, dy] = CLOCKWISE[dir]!;
                if (isIn(start[0] + dx, start[1] + dy)) { original = dir; break; }
            }
            if (first === original) break;
        }
        out.push([x, y]);
    }
    return out;
}

/** Fewer points along much the same line: none of those dropped was further than @p tolerance from it. */
export function simplifyLine(points: readonly PixelPoint[], tolerance: number, closed = false): PixelPoint[] {
    if (points.length < 3) return [...points];
    const keep = new Uint8Array(points.length);
    const distanceFrom = (p: PixelPoint, a: PixelPoint, b: PixelPoint): number => {
        const [ex, ey] = [b[0] - a[0], b[1] - a[1]];
        const len = ex * ex + ey * ey;
        const t = len > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / len)) : 0;
        return Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ey * t);
    };
    const run = (lo: number, hi: number): void => {
        const stack: [number, number][] = [[lo, hi]];
        while (stack.length) {
            const [a, b] = stack.pop()!;
            let far = -1, worst = tolerance;
            for (let i = a + 1; i < b; i++) {
                const d = distanceFrom(points[i]!, points[a]!, points[b]!);
                if (d > worst) { worst = d; far = i; }
            }
            if (far >= 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
        }
    };
    if (closed) {
        // A closed line has no ends: the two points furthest apart serve.
        let split = 0, widest = -1;
        for (let i = 0; i < points.length; i++) {
            const d = Math.hypot(points[i]![0] - points[0]![0], points[i]![1] - points[0]![1]);
            if (d > widest) { widest = d; split = i; }
        }
        keep[0] = 1; keep[split] = 1;
        if (split > 0) run(0, split);
        const wrapped = [...points.slice(split), points[0]!];
        const inner = simplifyLine(wrapped, tolerance, false);
        const firstHalf = points.filter((_, i) => i <= split && keep[i]);
        return [...firstHalf, ...inner.slice(1, -1)];
    }
    keep[0] = 1; keep[points.length - 1] = 1;
    run(0, points.length - 1);
    return points.filter((_, i) => keep[i]);
}

export interface EdgeLineOptions {
    /** The share of the picture's pixels that may be edge, strongest first. Default 0.04. */
    share?: number;
    /** Lines shorter than this many pixels are left out. Default 24. */
    minLength?: number;
    /** How far a line may be simplified from what was found, in pixels. Default 1.5. */
    simplify?: number;
    /** At most this many lines come back, longest first. Default 24. */
    most?: number;
}

/** The strongest edges of a picture as lines, one pixel wide and joined up, longest first: folds, strands, the edge of a sleeve. */
export function traceEdgeLines(image: RgbaImage, options: EdgeLineOptions = {}): PixelPoint[][] {
    const { width, height } = image;
    const lab = labOf(image);
    const light = new Float32Array(width * height);
    // Softened further: what a fold is, is broader than what a video's blocks are.
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let [sum, n] = [0, 0];
            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                    const [qx, qy] = [x + dx, y + dy];
                    if (qx < 0 || qy < 0 || qx >= width || qy >= height) continue;
                    sum += lab[(qy * width + qx) * 3]!; n++;
                }
            }
            light[y * width + x] = sum / n;
        }
    }
    const strength = new Float32Array(width * height);
    const gx = new Float32Array(width * height), gy = new Float32Array(width * height);
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const at = y * width + x;
            gx[at] = light[at + 1]! - light[at - 1]!;
            gy[at] = light[at + width]! - light[at - width]!;
            strength[at] = Math.hypot(gx[at]!, gy[at]!);
        }
    }
    // Only the crest of each edge: one pixel wide, so it can be followed.
    const crest = new Float32Array(width * height);
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const at = y * width + x;
            const s = strength[at]!;
            if (s <= 0) continue;
            const [ux, uy] = [Math.round(gx[at]! / s), Math.round(gy[at]! / s)];
            if (s >= strength[at + uy * width + ux]! && s >= strength[at - uy * width - ux]!) crest[at] = s;
        }
    }
    const sorted = Float32Array.from(crest.filter((v) => v > 0)).sort();
    if (sorted.length === 0) return [];
    const share = options.share ?? 0.04;
    const strong = sorted[Math.max(0, sorted.length - Math.max(1, Math.floor(width * height * share)))]!;
    const weak = strong * 0.5;
    const used = new Uint8Array(width * height);
    const isEdge = (x: number, y: number): boolean => x > 0 && y > 0 && x < width - 1 && y < height - 1 && crest[y * width + x]! >= weak && !used[y * width + x];
    const follow = (x0: number, y0: number, dx0: number, dy0: number): PixelPoint[] => {
        const line: PixelPoint[] = [];
        let [x, y, dx, dy] = [x0, y0, dx0, dy0];
        for (;;) {
            let bestScore = -Infinity, bx = 0, by = 0;
            for (const [ax, ay] of CLOCKWISE) {
                if (!isEdge(x + ax, y + ay)) continue;
                // Straight on, by preference: a crossing should not turn a line round a corner.
                const score = (dx * ax + dy * ay) / Math.hypot(ax, ay);
                if (score > bestScore) { bestScore = score; bx = ax; by = ay; }
            }
            if (bestScore === -Infinity || bestScore < -0.2) return line;
            x += bx; y += by; dx = dx * 0.7 + bx * 0.3; dy = dy * 0.7 + by * 0.3;
            used[y * width + x] = 1;
            line.push([x, y]);
        }
    };
    const lines: PixelPoint[][] = [];
    const order: number[] = [];
    for (let i = 0; i < crest.length; i++) if (crest[i]! >= strong) order.push(i);
    order.sort((a, b) => crest[b]! - crest[a]!);
    for (const i of order) {
        if (used[i]) continue;
        const [x, y] = [i % width, Math.floor(i / width)];
        used[i] = 1;
        // Along the edge: square to which way the light changes.
        const s = strength[i]! || 1;
        const [ex, ey] = [-gy[i]! / s, gx[i]! / s];
        const ahead = follow(x, y, ex, ey), behind = follow(x, y, -ex, -ey);
        lines.push([...behind.reverse(), [x, y], ...ahead]);
    }
    const minLength = options.minLength ?? 24;
    const simplify = options.simplify ?? 1.5;
    return lines.filter((l) => l.length >= minLength)
        .sort((a, b) => b.length - a.length)
        .slice(0, options.most ?? 24)
        .map((l) => simplifyLine(l, simplify, false));
}

export interface PatchColor { hex: string; linear: [number, number, number] }

/** The colour of a small round patch of a picture, averaged in light rather than in the numbers that encode it. */
export function colorOfPatch(image: RgbaImage, x: number, y: number, radius: number): PatchColor {
    const { width, height, rgba } = image;
    let [r, g, b, n] = [0, 0, 0, 0];
    for (let qy = Math.max(0, Math.floor(y - radius)); qy <= Math.min(height - 1, Math.ceil(y + radius)); qy++) {
        for (let qx = Math.max(0, Math.floor(x - radius)); qx <= Math.min(width - 1, Math.ceil(x + radius)); qx++) {
            if (Math.hypot(qx - x, qy - y) > radius + 0.5) continue;
            const at = (qy * width + qx) * 4;
            r += LINEAR[rgba[at]!]!; g += LINEAR[rgba[at + 1]!]!; b += LINEAR[rgba[at + 2]!]!; n++;
        }
    }
    if (n === 0) throw new Error(`${x.toFixed(1)}, ${y.toFixed(1)} is off the picture, ${width} by ${height}`);
    const linear: [number, number, number] = [r / n, g / n, b / n];
    const encode = (c: number): number => Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055));
    return { hex: `#${linear.map((c) => encode(c).toString(16).padStart(2, '0')).join('')}`, linear: [Number(linear[0].toFixed(4)), Number(linear[1].toFixed(4)), Number(linear[2].toFixed(4))] };
}

/** A line drawn on a picture in place. */
export function drawLine(image: RgbaImage, points: readonly PixelPoint[], color: readonly [number, number, number], closed = false): void {
    const { width, height, rgba } = image;
    const put = (x: number, y: number): void => {
        if (x < 0 || y < 0 || x >= width || y >= height) return;
        rgba.set(color, (y * width + x) * 4);
    };
    const count = closed ? points.length : points.length - 1;
    for (let i = 0; i < count; i++) {
        const [a, b] = [points[i]!, points[(i + 1) % points.length]!];
        const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
        for (let s = 0; s <= steps; s++) {
            const [x, y] = [Math.round(a[0] + ((b[0] - a[0]) * s) / steps), Math.round(a[1] + ((b[1] - a[1]) * s) / steps)];
            put(x, y); put(x + 1, y); put(x, y + 1);
        }
    }
}

/** The mask of what differs between two pictures of one size. */
export function differenceMask(a: RgbaImage, b: RgbaImage, least = 6): Uint8Array {
    const out = new Uint8Array(a.width * a.height);
    for (let i = 0; i < out.length; i++) {
        const at = i * 4;
        out[i] = Math.abs(a.rgba[at]! - b.rgba[at]!) + Math.abs(a.rgba[at + 1]! - b.rgba[at + 1]!) + Math.abs(a.rgba[at + 2]! - b.rgba[at + 2]!) > least ? 1 : 0;
    }
    return out;
}

/** A picture with the border of a mask drawn on it, whatever the two sizes. */
export function maskEdgeOver(under: RgbaImage, mask: Uint8Array, maskWidth: number, maskHeight: number, color: readonly [number, number, number]): RgbaImage {
    const { width, height } = under;
    const rgba = Uint8Array.from(under.rgba);
    const at = (x: number, y: number): number => (mask[Math.min(maskHeight - 1, Math.floor((y * maskHeight) / height)) * maskWidth + Math.min(maskWidth - 1, Math.floor((x * maskWidth) / width))]!);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const here = at(x, y);
            if (here && (!at(x - (x > 0 ? 1 : 0), y) || !at(x + (x < width - 1 ? 1 : 0), y) || !at(x, y - (y > 0 ? 1 : 0)) || !at(x, y + (y < height - 1 ? 1 : 0)))) rgba.set(color, (y * width + x) * 4);
        }
    }
    return { width, height, rgba };
}
