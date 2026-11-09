// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    rigMesh.ts
 * @brief   From an image to a mesh that bends: cutting it into parts, covering a part, deciding what each vertex follows.
 *
 * @details A part is covered by a grid of cells, keeping those with something drawn in them. An outline hugging the picture saves
 *          triangles but bends badly: long thin triangles fold where a limb turns, and the even cells are what make a bend smooth.
 *          The empty corners of a kept cell are transparent, so the grid's stairs are never seen.
 */
import { RIG_MAX_INFLUENCES, rigBoneWorlds, type RigPart, type RigSource } from './rigSource';

/** Image coverage: `alpha(x, y)` in 0..255 for a pixel from the top left. @experimental */
export interface RigImage {
    width: number;
    height: number;
    alpha(x: number, y: number): number;
}

/** A rig image over RGBA bytes, row by row from the top. @experimental */
export function rigImageFromRGBA(width: number, height: number, rgba: ArrayLike<number>): RigImage {
    return { width, height, alpha: (x, y) => rgba[(y * width + x) * 4 + 3] ?? 0 };
}

/**
 * The separate pictures in an image, each what is joined by drawn pixels, largest first. What a sheet of a character's limbs is
 * cut into. Specks under `minArea` pixels are left out.
 * @experimental
 */
export function findRigParts(image: RigImage, opts: { threshold?: number; minArea?: number } = {}): { x: number; y: number; w: number; h: number }[] {
    const threshold = opts.threshold ?? 8, minArea = opts.minArea ?? 16, { width, height } = image;
    const seen = new Uint8Array(width * height), found: { rect: { x: number; y: number; w: number; h: number }; area: number }[] = [];
    const stack: number[] = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const start = y * width + x;
        if (seen[start] || image.alpha(x, y) < threshold) continue;
        seen[start] = 1;
        stack.push(start);
        let minX = x, maxX = x, minY = y, maxY = y, area = 0;
        while (stack.length > 0) {
            const at = stack.pop()!, px = at % width, py = (at - px) / width;
            area++;
            if (px < minX) minX = px; if (px > maxX) maxX = px;
            if (py < minY) minY = py; if (py > maxY) maxY = py;
            for (const [nx, ny] of [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]] as const) {
                if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                const next = ny * width + nx;
                if (seen[next] || image.alpha(nx, ny) < threshold) continue;
                seen[next] = 1;
                stack.push(next);
            }
        }
        if (area >= minArea) found.push({ rect: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }, area });
    }
    return found.sort((a, b) => b.area - a.area).map(f => f.rect);
}

/** Covers `rect` with square cells of `cell` pixels, wherever something is drawn. Vertices come back in pixels from the rect's corner. @experimental */
export function coverRigPart(image: RigImage, rect: RigPart['rect'], opts: { cell?: number; threshold?: number } = {}): { vertices: number[]; triangles: number[] } {
    const cell = Math.max(2, Math.round(opts.cell ?? 16)), threshold = opts.threshold ?? 8;
    const cols = Math.max(1, Math.ceil(rect.w / cell)), rows = Math.max(1, Math.ceil(rect.h / cell));
    const index = new Map<number, number>(), vertices: number[] = [], triangles: number[] = [];
    const corner = (cx: number, cy: number): number => {
        const key = cy * (cols + 1) + cx;
        let at = index.get(key);
        if (at === undefined) {
            at = vertices.length / 2;
            index.set(key, at);
            vertices.push(Math.min(cx * cell, rect.w), Math.min(cy * cell, rect.h));
        }
        return at;
    };
    const drawn = (cx: number, cy: number): boolean => {
        const x1 = Math.min(rect.x + (cx + 1) * cell, rect.x + rect.w), y1 = Math.min(rect.y + (cy + 1) * cell, rect.y + rect.h);
        for (let y = rect.y + cy * cell; y < y1; y++) for (let x = rect.x + cx * cell; x < x1; x++) {
            if (x >= 0 && y >= 0 && x < image.width && y < image.height && image.alpha(x, y) >= threshold) return true;
        }
        return false;
    };
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
        if (!drawn(cx, cy)) continue;
        const a = corner(cx, cy), b = corner(cx + 1, cy), c = corner(cx + 1, cy + 1), d = corner(cx, cy + 1);
        // The diagonal alternates, or a bend across the grid leans all one way. Wound counter-clockwise as seen with y up.
        if ((cx + cy) % 2 === 0) triangles.push(a, d, b, b, d, c);
        else triangles.push(a, d, c, a, c, b);
    }
    return { vertices, triangles };
}

/** Where a part's vertex sits in rig space. @experimental */
export function rigVertex(rig: RigSource, part: RigPart, vertex: number): { x: number; y: number } {
    return { x: part.x + part.vertices[vertex * 2]! * rig.unitsPerPixel, y: part.y - part.vertices[vertex * 2 + 1]! * rig.unitsPerPixel };
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax, dy = by - ay, lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function normalized(pairs: [number, number][]): number[] {
    const kept = pairs.filter(p => p[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, RIG_MAX_INFLUENCES);
    const sum = kept.reduce((total, p) => total + p[1], 0);
    return sum > 0 ? kept.flatMap(([bone, weight]) => [bone, weight / sum]) : [];
}

/**
 * Binds a part's vertices by how near each is to each bone. A good start and not the end: nearness cannot tell an arm from the
 * torso it hangs beside, which is what `bones` (only these may be followed) and painting are for. `falloff` is how sharply a bone's reach ends.
 * @experimental
 */
export function autoWeightPart(rig: RigSource, part: RigPart, opts: { bones?: readonly number[]; falloff?: number } = {}): void {
    const worlds = rigBoneWorlds(rig.bones), falloff = opts.falloff ?? 4;
    const candidates = opts.bones ?? rig.bones.map((_, i) => i);
    const ends = candidates.map((i) => {
        const w = worlds[i]!, length = rig.bones[i]!.length;
        return { bone: i, ax: w.x, ay: w.y, bx: w.x + Math.cos(w.rotation) * length, by: w.y + Math.sin(w.rotation) * length };
    });
    part.weights = [];
    for (let v = 0; v < part.vertices.length / 2; v++) {
        const at = rigVertex(rig, part, v);
        part.weights.push(normalized(ends.map(e => [
            e.bone, Math.pow(1 / (distanceToSegment(at.x, at.y, e.ax, e.ay, e.bx, e.by) + 1), falloff),
        ])));
    }
}

/** Every vertex of a part follows one bone, for a piece that does not bend: a helmet, a sword. @experimental */
export function bindPartToBone(part: RigPart, bone: number): void {
    part.weights = Array.from({ length: part.vertices.length / 2 }, () => [bone, 1]);
}

/** One dab of a weight brush. `add` and `remove` move `bone`'s share, `smooth` evens every bone with the vertices joined to each. @experimental */
export interface RigWeightDab {
    x: number;
    y: number;
    /** World units. */
    radius: number;
    bone: number;
    /** How far the centre of the brush goes, 0..1. */
    strength: number;
    mode: 'add' | 'remove' | 'smooth';
}

/** Applies a dab to a part, returning how many vertices changed. The weights still sum to 1 after it, which is why the others give way. @experimental */
export function paintPartWeights(rig: RigSource, part: RigPart, dab: RigWeightDab): number {
    const count = part.vertices.length / 2;
    let neighbours: Set<number>[] | null = null;
    if (dab.mode === 'smooth') {
        neighbours = Array.from({ length: count }, () => new Set<number>());
        for (let t = 0; t < part.triangles.length; t += 3) {
            const a = part.triangles[t]!, b = part.triangles[t + 1]!, c = part.triangles[t + 2]!;
            neighbours[a]!.add(b).add(c); neighbours[b]!.add(a).add(c); neighbours[c]!.add(a).add(b);
        }
    }
    const before = neighbours ? part.weights.map(w => w.slice()) : part.weights;
    let changed = 0;
    for (let v = 0; v < count; v++) {
        const at = rigVertex(rig, part, v), d = Math.hypot(at.x - dab.x, at.y - dab.y);
        if (d >= dab.radius) continue;
        const reach = (1 - d / dab.radius) ** 2 * dab.strength;
        const shares = new Map<number, number>();
        const w = before[v]!;
        for (let i = 0; i < w.length; i += 2) shares.set(w[i]!, w[i + 1]!);
        if (dab.mode === 'smooth') {
            const around = new Map<number, number>();
            const list = [...neighbours![v]!];
            for (const n of list) {
                const other = before[n]!;
                for (let i = 0; i < other.length; i += 2) around.set(other[i]!, (around.get(other[i]!) ?? 0) + other[i + 1]! / Math.max(list.length, 1));
            }
            for (const bone of new Set([...shares.keys(), ...around.keys()])) {
                const own = shares.get(bone) ?? 0;
                shares.set(bone, own + ((around.get(bone) ?? 0) - own) * reach);
            }
        } else {
            const own = shares.get(dab.bone) ?? 0;
            const next = dab.mode === 'add' ? own + (1 - own) * reach : own * (1 - reach);
            if (next === own) continue;
            const rest = 1 - own, left = 1 - next;
            for (const [bone, share] of shares) if (bone !== dab.bone) shares.set(bone, rest > 0 ? share * (left / rest) : 0);
            shares.set(dab.bone, next);
        }
        const result = normalized([...shares]);
        // A vertex stripped of everything would collapse onto the origin, so the last of it stays where it was.
        if (result.length === 0) continue;
        part.weights[v] = result;
        changed++;
    }
    return changed;
}

/** Pushes the vertices of every part around (x, y), by (dx, dy) at the centre and nothing at `radius`, into one deform. Returns how many moved. @experimental */
export function pushRigDeform(rig: RigSource, deformIndex: number, x: number, y: number, radius: number, dx: number, dy: number): number {
    const deform = rig.deforms[deformIndex];
    if (!deform) return 0;
    let moved = 0;
    for (const part of rig.parts) {
        const held = new Map<number, [number, number]>();
        const flat = deform.offsets[part.name] ?? [];
        for (let i = 0; i < flat.length; i += 3) held.set(flat[i]!, [flat[i + 1]!, flat[i + 2]!]);
        let touched = false;
        for (let v = 0; v < part.vertices.length / 2; v++) {
            const at = rigVertex(rig, part, v), [ox, oy] = held.get(v) ?? [0, 0];
            const d = Math.hypot(at.x + ox - x, at.y + oy - y);
            if (d >= radius) continue;
            const reach = (1 - d / radius) ** 2;
            held.set(v, [ox + dx * reach, oy + dy * reach]);
            touched = true;
            moved++;
        }
        if (touched) deform.offsets[part.name] = [...held].sort((a, b) => a[0] - b[0]).flatMap(([v, [ox, oy]]) => [v, ox, oy]);
    }
    return moved;
}

/** How much `bone` moves each vertex of a part, 0..1: what a weight view colours. @experimental */
export function partWeightsOf(part: RigPart, bone: number): Float32Array {
    const out = new Float32Array(part.vertices.length / 2);
    part.weights.forEach((w, v) => {
        for (let i = 0; i < w.length; i += 2) if (w[i] === bone) out[v] = w[i + 1]!;
    });
    return out;
}
