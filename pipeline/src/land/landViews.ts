// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  landViews.ts — a baked land as pictures and numbers: what an author who cannot walk it reads it by.
 *
 * From above: relief (height as colour under a low light, water where it lies), slope (walkable, steep, cliff), contours and the
 * layers. From the side: an oblique view, drawn near to far so what stands in front hides what is behind. Along a line: a profile,
 * with how steep each stretch is. And at a place: its height, slope, layers and how far it is from water and road. No scene, no
 * engine: it draws from the heights alone, so it shows the land before anything is built on it.
 */
import { landBend, type BakedLand } from './landBake';
import type { Point2 } from './landSource';

export interface LandPictureOut { width: number; height: number; rgba: Uint8Array }

export type LandViewName = 'relief' | 'slope' | 'creases' | 'contours' | 'layers' | 'oblique';
export const LAND_VIEWS: readonly LandViewName[] = ['relief', 'slope', 'creases', 'contours', 'layers', 'oblique'];

export interface LandViewOptions {
    /** The part looked at: its middle and its size in world units. Default the whole land. */
    region?: { at: Point2; size: readonly [number, number] };
    /** Pixels along the longer side of a view. */
    size?: number;
    /** An oblique view: the way the eye looks, in degrees (0 looks toward -z, 90 toward +x), and how far down, in degrees. */
    heading?: number;
    pitch?: number;
}

const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

type Rgb = readonly [number, number, number];
const ramp = (stops: readonly (readonly [number, Rgb])[], t: number): Rgb => {
    for (let i = 0; i + 1 < stops.length; i++) {
        const [a, ca] = stops[i]!, [b, cb] = stops[i + 1]!;
        if (t <= b) { const u = clamp((t - a) / Math.max(b - a, 1e-9), 0, 1); return [mix(ca[0], cb[0], u), mix(ca[1], cb[1], u), mix(ca[2], cb[2], u)]; }
    }
    return stops[stops.length - 1]![1];
};
// Height above the sea, as a share of the land's own range: lowland greens, upland tans, rock, snow.
const LAND_RAMP: readonly (readonly [number, Rgb])[] = [[0, [116, 168, 96]], [0.12, [150, 190, 104]], [0.3, [190, 196, 120]], [0.5, [178, 158, 116]], [0.72, [150, 140, 132]], [0.9, [222, 222, 226]], [1, [250, 250, 252]]];
const SEA_RAMP: readonly (readonly [number, Rgb])[] = [[0, [140, 200, 214]], [0.25, [84, 152, 196]], [1, [28, 60, 120]]];
const LAYER_COLOURS: readonly Rgb[] = [[110, 170, 84], [168, 126, 84], [226, 208, 156], [140, 136, 132], [240, 244, 250], [84, 120, 70], [196, 110, 80], [120, 150, 190]];
const RIVER: Rgb = [40, 110, 220], ROAD: Rgb = [110, 70, 40], GRID: Rgb = [20, 20, 30];

/** Reads the land at a world place: its height, between samples, and its slope in degrees. */
function sampler(land: BakedLand): { height(x: number, z: number): number; slope(x: number, z: number): number; index(x: number, z: number): number } {
    const n = land.n, [sx, sz] = land.size, [cx, cz] = land.center, cellX = sx / (n - 1), cellZ = sz / (n - 1), h = land.heights;
    const fi = (x: number): number => clamp((x - cx) / sx * (n - 1) + (n - 1) / 2, 0, n - 1.001);
    const fj = (z: number): number => clamp((z - cz) / sz * (n - 1) + (n - 1) / 2, 0, n - 1.001);
    const height = (x: number, z: number): number => {
        const a = fi(x), b = fj(z), i = Math.floor(a), j = Math.floor(b), u = a - i, v = b - j, k = j * n + i;
        return mix(mix(h[k]!, h[k + 1]!, u), mix(h[k + n]!, h[k + n + 1]!, u), v);
    };
    return {
        height,
        slope: (x, z) => Math.atan(Math.hypot((height(x + cellX, z) - height(x - cellX, z)) / (2 * cellX), (height(x, z + cellZ) - height(x, z - cellZ)) / (2 * cellZ))) * 180 / Math.PI,
        index: (x, z) => Math.round(fj(z)) * n + Math.round(fi(x)),
    };
}

/** A round number of world units that puts four to eight lines across `span`. */
export function gridStepFor(span: number): number {
    const rough = span / 6, pow = 10 ** Math.floor(Math.log10(rough)), m = rough / pow;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * pow;
}

function colourAt(land: BakedLand, view: LandViewName, read: ReturnType<typeof sampler>, x: number, z: number, light: readonly [number, number, number], exaggerate: number): Rgb {
    const { min, max, sea } = land.report;
    const y = read.height(x, z);
    const cell = land.size[0] / (land.n - 1);
    const gx = (read.height(x + cell, z) - read.height(x - cell, z)) / (2 * cell), gz = (read.height(x, z + cell) - read.height(x, z - cell)) / (2 * cell);
    if (view === 'slope') {
        if (sea !== null && y < sea) return [70, 110, 170];
        const deg = Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI;
        // Under 25 a character walks it, to 45 it is steep going, past that it is a cliff.
        return deg < 12 ? [96, 170, 96] : deg < 25 ? [150, 196, 96] : deg < 35 ? [236, 212, 80] : deg < 45 ? [236, 150, 60] : [212, 60, 52];
    }
    if (view === 'creases') {
        // Where the ground bends sharply from one sample to the next: an edge the eye reads as a facet. Pale is round.
        const n = land.n, i = Math.round(clamp((x - land.center[0]) / land.size[0] + 0.5, 0, 1) * (n - 1)), j = Math.round(clamp((z - land.center[1]) / land.size[1] + 0.5, 0, 1) * (n - 1));
        const bend = landBend(land.heights, n, land.size[0] / (n - 1), land.size[1] / (n - 1), i, j);
        if (sea !== null && y < sea) return [200, 214, 232];
        return bend < 6 ? [236, 240, 232] : bend < 14 ? [226, 214, 150] : bend < 25 ? [236, 160, 70] : [212, 50, 46];
    }
    if (view === 'layers' && land.weights.length > 0) {
        const k = Math.min(Math.round(clamp((z - land.center[1]) / land.size[1] + 0.5, 0, 1) * (land.m - 1)), land.m - 1) * land.m + Math.min(Math.round(clamp((x - land.center[0]) / land.size[0] + 0.5, 0, 1) * (land.m - 1)), land.m - 1);
        let r = 0, g = 0, b = 0, sum = 0;
        land.weights.forEach((layer, i) => { const w = layer.values[k]! / 255, c = LAYER_COLOURS[i % LAYER_COLOURS.length]!; r += c[0] * w; g += c[1] * w; b += c[2] * w; sum += w; });
        return sum > 0 ? [r / sum, g / sum, b / sum] : [0, 0, 0];
    }
    // Relief: the height's colour under a low light from the north-west.
    const nx = -gx * exaggerate, nz = -gz * exaggerate, len = Math.hypot(nx, 1, nz);
    const shade = clamp((nx * light[0] + light[1] + nz * light[2]) / len, 0, 1);
    let base: Rgb;
    if (sea !== null && y < sea) base = ramp(SEA_RAMP, clamp((sea - y) / Math.max(sea - min, 1e-6), 0, 1));
    else base = ramp(LAND_RAMP, clamp((y - (sea ?? min)) / Math.max(max - (sea ?? min), 1e-6), 0, 1));
    const lit = sea !== null && y < sea ? 0.85 + 0.15 * shade : 0.45 + 0.75 * shade;
    if (view === 'contours') {
        const step = gridStepFor((max - min) * 0.9) / 2, slope = Math.hypot(gx, gz) * cell * 1.5;
        const near = Math.abs(y / step - Math.round(y / step)) * step;
        if (near < Math.max(slope, step * 0.02)) return [60, 40, 30];
        return [mix(base[0], 255, 0.45), mix(base[1], 255, 0.45), mix(base[2], 255, 0.45)];
    }
    return [Math.min(base[0] * lit, 255), Math.min(base[1] * lit, 255), Math.min(base[2] * lit, 255)];
}

/** One view from above, with the rivers, roads and lakes the land has drawn over it and a grid to read places off. */
function topView(land: BakedLand, view: LandViewName, options: LandViewOptions): LandPictureOut & { region: { at: [number, number]; size: [number, number] }; grid: number } {
    const at: [number, number] = options.region ? [options.region.at[0], options.region.at[1]] : [land.center[0], land.center[1]];
    const size: [number, number] = options.region ? [options.region.size[0], options.region.size[1]] : [land.size[0], land.size[1]];
    const long = clamp(Math.round(options.size ?? 640), 128, 1536);
    const width = size[0] >= size[1] ? long : Math.max(32, Math.round(long * size[0] / size[1])), height = size[0] >= size[1] ? Math.max(32, Math.round(long * size[1] / size[0])) : long;
    const rgba = new Uint8Array(width * height * 4), read = sampler(land);
    const { min, max } = land.report;
    // Enough exaggeration that low country still shows its shape under the light.
    const exaggerate = clamp(0.35 * Math.max(land.size[0], land.size[1]) / Math.max(max - min, 1e-6) / 6, 1, 12);
    const light: [number, number, number] = [-0.5, 0.62, -0.6];
    const wx = (px: number): number => at[0] + ((px + 0.5) / width - 0.5) * size[0], wz = (py: number): number => at[1] + ((py + 0.5) / height - 0.5) * size[1];
    for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
        const c = colourAt(land, view, read, wx(px), wz(py), light, exaggerate), o = (py * width + px) * 4;
        rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255;
    }
    const put = (px: number, py: number, c: Rgb, a = 1): void => {
        if (px < 0 || py < 0 || px >= width || py >= height) return;
        const o = (Math.floor(py) * width + Math.floor(px)) * 4;
        rgba[o] = mix(rgba[o]!, c[0], a); rgba[o + 1] = mix(rgba[o + 1]!, c[1], a); rgba[o + 2] = mix(rgba[o + 2]!, c[2], a);
    };
    const sxOf = (x: number): number => ((x - at[0]) / size[0] + 0.5) * width, syOf = (z: number): number => ((z - at[1]) / size[1] + 0.5) * height;
    const stroke = (points: readonly { x: number; z: number }[], c: Rgb, thick: number): void => {
        for (let i = 0; i + 1 < points.length; i++) {
            const ax = sxOf(points[i]!.x), ay = syOf(points[i]!.z), bx = sxOf(points[i + 1]!.x), by = syOf(points[i + 1]!.z);
            const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
            for (let s = 0; s <= steps; s++) {
                const x = mix(ax, bx, s / steps), y = mix(ay, by, s / steps);
                for (let dy = -thick; dy <= thick; dy++) for (let dx = -thick; dx <= thick; dx++) if (dx * dx + dy * dy <= thick * thick + 0.5) put(x + dx, y + dy, c);
            }
        }
    };
    // A grid to read places off: the report says how far apart its lines are.
    const grid = gridStepFor(Math.max(size[0], size[1]));
    for (let gx = Math.ceil((at[0] - size[0] / 2) / grid) * grid; gx <= at[0] + size[0] / 2; gx += grid) { const px = Math.round(sxOf(gx)); for (let py = 0; py < height; py++) put(px, py, GRID, gx === 0 ? 0.5 : 0.22); }
    for (let gz = Math.ceil((at[1] - size[1] / 2) / grid) * grid; gz <= at[1] + size[1] / 2; gz += grid) { const py = Math.round(syOf(gz)); for (let px = 0; px < width; px++) put(px, py, GRID, gz === 0 ? 0.5 : 0.22); }
    const pxPerUnit = width / size[0];
    for (const lake of land.report.lakes) {
        const ring: { x: number; z: number }[] = [];
        for (let a = 0; a <= 48; a++) ring.push({ x: lake.at[0] + Math.cos(a / 48 * Math.PI * 2) * lake.radius, z: lake.at[1] + Math.sin(a / 48 * Math.PI * 2) * lake.radius });
        stroke(ring, RIVER, 0);
    }
    for (const river of land.report.rivers) {
        stroke(river.points, RIVER, clamp(Math.round(river.points[0]!.width * pxPerUnit / 2), 0, 4));
        // A fall is a bar across the river: white, where the water drops.
        for (const fall of river.falls) for (let d = -3; d <= 3; d++) for (let e = -3; e <= 3; e++) if (Math.abs(d) + Math.abs(e) <= 3) put(sxOf(fall.at[0]) + d, syOf(fall.at[2]) + e, [255, 255, 255]);
    }
    for (const road of land.report.roads) stroke(road.points, ROAD, 0);
    return { width, height, rgba, region: { at, size }, grid };
}

/** The land seen from a height, looking along `heading`: drawn near to far, so each column keeps the highest thing it has shown. */
function obliqueView(land: BakedLand, options: LandViewOptions): LandPictureOut {
    const at: Point2 = options.region?.at ?? land.center, size: readonly [number, number] = options.region?.size ?? land.size;
    const width = clamp(Math.round((options.size ?? 640) * 1.4), 160, 1800), height = Math.round(width * 0.58);
    const rgba = new Uint8Array(width * height * 4), read = sampler(land);
    const { min, max, sea } = land.report;
    for (let i = 0; i < width * height; i++) { rgba[i * 4] = 208; rgba[i * 4 + 1] = 224; rgba[i * 4 + 2] = 240; rgba[i * 4 + 3] = 255; }
    const heading = ((options.heading ?? 0) * Math.PI) / 180, pitch = (clamp(options.pitch ?? 32, 8, 80) * Math.PI) / 180;
    // The eye's right and forward on the ground: heading 0 looks toward -z.
    const fx = Math.sin(heading), fz = -Math.cos(heading), rx = -fz, rz = fx;
    const span = Math.hypot(size[0], size[1]), scale = width / (span * 1.02);
    const exaggerate = clamp(0.35 * span / Math.max(max - min, 1e-6) / 6, 1, 12), light: [number, number, number] = [-0.5, 0.62, -0.6];
    const rows = Math.ceil(span * scale * 1.2), horizon = new Int32Array(width).fill(height);
    const depthPx = Math.sin(pitch), heightPx = Math.cos(pitch);
    const floor = sea ?? min, base = height - 4 + (span / 2) * scale * depthPx * 0 - 0;
    for (let row = 0; row < rows; row++) {
        const v = -span / 2 + (row / (rows - 1)) * span;                          // near to far along the eye's forward
        for (let px = 0; px < width; px++) {
            const u = (px - width / 2) / scale;
            const x = at[0] + rx * u + fx * v, z = at[1] + rz * u + fz * v;
            if (Math.abs(x - at[0]) > size[0] / 2 || Math.abs(z - at[1]) > size[1] / 2) continue;
            const ground = read.height(x, z), y = sea !== null && ground < sea ? sea : ground;
            const py = Math.round(base - (v + span / 2) * scale * depthPx - (y - floor) * scale * heightPx * Math.min(exaggerate, 2.5));
            if (py >= horizon[px]!) continue;
            const c = colourAt(land, 'relief', read, x, z, light, exaggerate);
            // Further off is paler: the air between, which is what gives a far valley its distance.
            const haze = clamp((v + span / 2) / span, 0, 1) * 0.35;
            for (let q = Math.max(py, 0); q < horizon[px]!; q++) {
                const o = (q * width + px) * 4;
                rgba[o] = mix(c[0], 208, haze); rgba[o + 1] = mix(c[1], 224, haze); rgba[o + 2] = mix(c[2], 240, haze);
            }
            horizon[px] = Math.max(py, 0);
        }
    }
    return { width, height, rgba };
}

/** Views side by side on one sheet, in the order asked. */
export function renderLandSheet(land: BakedLand, views: readonly LandViewName[] = ['relief', 'slope'], options: LandViewOptions = {}): LandPictureOut & { region: { at: [number, number]; size: [number, number] }; grid: number; views: string[] } {
    if (views.length === 0) throw new Error('name at least one view');
    for (const v of views) if (!LAND_VIEWS.includes(v)) throw new Error(`unknown view "${v}"; there are ${LAND_VIEWS.join(', ')}`);
    const top = topView(land, 'relief', options);
    const cells = views.map((v) => (v === 'oblique' ? obliqueView(land, options) : v === 'relief' ? top : topView(land, v, options)));
    const gap = 6, height = Math.max(...cells.map((c) => c.height)), width = cells.reduce((w, c) => w + c.width, 0) + gap * (cells.length - 1);
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) { rgba[i * 4] = 32; rgba[i * 4 + 1] = 34; rgba[i * 4 + 2] = 40; rgba[i * 4 + 3] = 255; }
    let x0 = 0;
    for (const cell of cells) {
        for (let y = 0; y < cell.height; y++) rgba.set(cell.rgba.subarray(y * cell.width * 4, (y + 1) * cell.width * 4), (y * width + x0) * 4);
        x0 += cell.width + gap;
    }
    return { width, height, rgba, region: top.region, grid: top.grid, views: [...views] };
}

export interface LandProfile {
    length: number;
    min: number;
    max: number;
    /** The steepest stretch: rise over run, in degrees, and where it is. */
    steepest: { grade: number; degrees: number; at: [number, number]; distance: number };
    /** The share of the way that is walkable (under 25 degrees), steep (to 45) and cliff. */
    going: { walkable: number; steep: number; cliff: number };
    samples: { distance: number; x: number; z: number; height: number; degrees: number }[];
}

/** The ground along a line: its heights, and how steep each stretch is to someone walking the line. */
export function landProfile(land: BakedLand, line: readonly Point2[], count = 240): LandProfile {
    if (line.length < 2) throw new Error('a profile runs along at least two [x, z] points');
    const read = sampler(land);
    const at: number[] = [0];
    for (let i = 1; i < line.length; i++) at.push(at[i - 1]! + Math.hypot(line[i]![0] - line[i - 1]![0], line[i]![1] - line[i - 1]![1]));
    const length = at[at.length - 1]!;
    const samples: LandProfile['samples'] = [];
    for (let s = 0; s < count; s++) {
        const d = (s / (count - 1)) * length;
        let seg = 0;
        while (seg + 2 < at.length && at[seg + 1]! < d) seg++;
        const t = clamp((d - at[seg]!) / Math.max(at[seg + 1]! - at[seg]!, 1e-9), 0, 1);
        const x = mix(line[seg]![0], line[seg + 1]![0], t), z = mix(line[seg]![1], line[seg + 1]![1], t);
        samples.push({ distance: d, x, z, height: read.height(x, z), degrees: 0 });
    }
    let min = Infinity, max = -Infinity, steep = 0, steepAt = 0, walk = 0, hard = 0, cliff = 0;
    for (let s = 0; s < count; s++) {
        const a = samples[Math.max(s - 1, 0)]!, b = samples[Math.min(s + 1, count - 1)]!;
        const grade = Math.abs(b.height - a.height) / Math.max(b.distance - a.distance, 1e-9), deg = Math.atan(grade) * 180 / Math.PI;
        samples[s]!.degrees = deg;
        if (grade > steep) { steep = grade; steepAt = s; }
        if (deg < 25) walk++; else if (deg < 45) hard++; else cliff++;
        min = Math.min(min, samples[s]!.height); max = Math.max(max, samples[s]!.height);
    }
    const worst = samples[steepAt]!;
    return {
        length, min, max,
        steepest: { grade: steep, degrees: Math.atan(steep) * 180 / Math.PI, at: [worst.x, worst.z], distance: worst.distance },
        going: { walkable: walk / count, steep: hard / count, cliff: cliff / count },
        samples,
    };
}

/** A profile as a picture: the ground's line in section, coloured by how steep it is, at true proportion where that fits. */
export function renderLandProfile(profile: LandProfile, sea: number | null, width = 900, height = 300): LandPictureOut {
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) { rgba[i * 4] = 246; rgba[i * 4 + 1] = 246; rgba[i * 4 + 2] = 244; rgba[i * 4 + 3] = 255; }
    const pad = 14, lo = Math.min(profile.min, sea ?? profile.min), span = Math.max(profile.max - lo, 1e-6);
    // True to scale when the rise fits the picture; stretched up to fill it when the line is long and the country low.
    const sx = (width - pad * 2) / Math.max(profile.length, 1e-6), sy = Math.min(Math.max(sx, (height - pad * 2) / span * 0.25), (height - pad * 2) / span);
    const yOf = (h: number): number => height - pad - (h - lo) * sy;
    const set = (x: number, y: number, c: Rgb): void => { if (x < 0 || y < 0 || x >= width || y >= height) return; const o = (Math.floor(y) * width + Math.floor(x)) * 4; rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; };
    if (sea !== null) for (let x = pad; x < width - pad; x++) set(x, yOf(sea), [90, 140, 210]);
    for (let x = pad; x < width - pad; x++) {
        const d = (x - pad) / sx, s = clamp(d / profile.length * (profile.samples.length - 1), 0, profile.samples.length - 1.001);
        const a = profile.samples[Math.floor(s)]!, b = profile.samples[Math.floor(s) + 1]!, t = s - Math.floor(s);
        const top = yOf(mix(a.height, b.height, t)), deg = mix(a.degrees, b.degrees, t);
        const c: Rgb = deg < 12 ? [96, 170, 96] : deg < 25 ? [150, 196, 96] : deg < 35 ? [236, 212, 80] : deg < 45 ? [236, 150, 60] : [212, 60, 52];
        for (let y = Math.max(Math.round(top), 0); y < height - pad; y++) set(x, y, y < top + 3 ? [50, 44, 40] : c);
    }
    return { width, height, rgba };
}

export interface LandProbe {
    x: number;
    z: number;
    height: number;
    /** Degrees from level, and the way the ground falls (degrees, 0 toward -z, 90 toward +x). */
    slope: number;
    falls: number;
    /** Above the sea by this much (negative under it), when the land has a sea. */
    aboveSea?: number;
    layers?: Record<string, number>;
    /** How far the nearest water's edge, road's edge, lake's shore and coast are (negative inside it; the coast positive inland). */
    river?: number;
    road?: number;
    lake?: number;
    coast?: number;
}

/** What the land is at each of some places. */
export function probeLand(land: BakedLand, points: readonly Point2[]): LandProbe[] {
    const read = sampler(land), cell = land.size[0] / (land.n - 1);
    return points.map(([x, z]) => {
        const k = read.index(x, z);
        const gx = (read.height(x + cell, z) - read.height(x - cell, z)) / (2 * cell), gz = (read.height(x, z + cell) - read.height(x, z - cell)) / (2 * cell);
        const out: LandProbe = { x, z, height: +read.height(x, z).toFixed(2), slope: +(Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI).toFixed(1), falls: +(((Math.atan2(-gx, gz) * 180 / Math.PI) + 360) % 360).toFixed(0) };
        if (land.report.sea !== null) out.aboveSea = +(out.height - land.report.sea).toFixed(2);
        if (land.weights.length > 0) {
            const km = Math.min(Math.floor(k / land.n), land.m - 1) * land.m + Math.min(k % land.n, land.m - 1);
            out.layers = Object.fromEntries(land.weights.map((w) => [w.name, +(w.values[km]! / 255).toFixed(2)]).filter(([, v]) => (v as number) > 0));
        }
        for (const key of ['river', 'road', 'lake', 'coast'] as const) {
            const field = land.fields[key];
            if (field && field[k]! < 1e8) out[key] = +field[k]!.toFixed(1);
        }
        return out;
    });
}
