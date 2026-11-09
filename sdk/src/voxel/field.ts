// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    field.ts
 * @brief   The ground as a volume: a signed distance at every point of a grid, cut into chunks, that can be carved and filled.
 *
 * @details Below zero is solid. A height field has one answer per column, so it cannot hold a cave or an overhang; this has one per point.
 *          A chunk keeps its own copy of a margin one sample wide round it, so that it can be meshed alone and two chunks still agree where
 *          they meet. Only what was edited has to be kept: the rest is the source's answer, made again when it is next needed, which is what
 *          lets a world without end cost what the player changed in it. Distances are stored in a byte, clamped to a few cells: a
 *          surface needs to know its distance only close by.
 */

/** How many layers of material a volume has. */
export const VOXEL_MATERIALS = 4;

/** How many cells a stored distance reaches. */
const RANGE_CELLS = 4;

/** What a place in the volume is. @experimental */
export interface VoxelSample {
    /** How far to the surface, in world units: below zero is solid. Near the surface it should be about true; far from it, only the sign counts. */
    distance: number;
    /** Which of the volume's materials it is, 0 to 3. */
    material: number;
}

/** Says what is at a place, relative to the volume's entity, into `out`. The same place must always get the same answer. @experimental */
export type VoxelSource = (x: number, y: number, z: number, out: VoxelSample) => void;

/** @experimental */
export interface VoxelPoint { x: number; y: number; z: number }

/** A shape to carve with or fill by, in the coordinates of the field. @experimental */
export type VoxelShape =
    | { kind: 'sphere'; center: VoxelPoint; radius: number }
    | { kind: 'box'; center: VoxelPoint; halfExtents: VoxelPoint }
    | { kind: 'capsule'; from: VoxelPoint; to: VoxelPoint; radius: number };

/** @experimental */
export type VoxelOp = 'subtract' | 'add' | 'paint';

/** @experimental */
export interface VoxelEditOptions {
    /** What `add` fills with and `paint` paints. Defaults to 0. */
    material?: number;
    /** How far the shape's edge melts into what it meets, in world units. 0 keeps it sharp. */
    smooth?: number;
    /** Materials this edit cannot change, by a function of the material: stone a pick cannot break. */
    keep?: (material: number) => boolean;
}

/** What an edit did. @experimental */
export interface VoxelEditResult {
    /** The volume taken out of each material, in cubic world units: what a miner carries away. */
    removed: number[];
    /** The volume added, in cubic world units. */
    added: number;
    /** How many chunks changed. */
    chunks: number;
}

/** Where a ray met a volume. @experimental */
export interface VoxelHit {
    point: VoxelPoint;
    normal: VoxelPoint;
    distance: number;
    material: number;
}

/** A volume's changes, as a save stores them, chunk by chunk. Plain JSON. @experimental */
export interface VoxelFieldData {
    version: 1;
    cellSize: number;
    chunkCells: number;
    /** By `cx,cy,cz`: its distances and materials, run-length coded, in base64. */
    chunks: Record<string, string>;
}

export interface VoxelFieldOptions {
    cellSize: number;
    chunkCells: number;
    minY: number;
    maxY: number;
    source: VoxelSource;
    /** How many chunks nothing edited are held once read, so a ray or a dig does not ask the source again. Defaults to 64. */
    cached?: number;
}

/** One chunk: `(cells + 2)` samples a side, from -1 to `cells`. */
export interface VoxelChunk {
    readonly cx: number;
    readonly cy: number;
    readonly cz: number;
    readonly key: string;
    distances: Int8Array | null;
    materials: Uint8Array | null;
    edited: boolean;
    /** Whether any sample is solid and any is not. Known once it has been read. */
    surfaced: boolean;
    revision: number;
    savedRevision: number;
    touched: number;
}

export const chunkKey = (cx: number, cy: number, cz: number): string => `${cx},${cy},${cz}`;

const clampByte = (v: number): number => (v > 127 ? 127 : v < -127 ? -127 : Math.round(v));
const smoothMax = (a: number, b: number, k: number): number => {
    if (k <= 0) return Math.max(a, b);
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.max(a, b) + h * h * k * 0.25;
};
const smoothMin = (a: number, b: number, k: number): number => -smoothMax(-a, -b, k);

function shapeDistance(shape: VoxelShape, x: number, y: number, z: number): number {
    if (shape.kind === 'sphere') return Math.hypot(x - shape.center.x, y - shape.center.y, z - shape.center.z) - shape.radius;
    if (shape.kind === 'box') {
        const dx = Math.abs(x - shape.center.x) - shape.halfExtents.x, dy = Math.abs(y - shape.center.y) - shape.halfExtents.y, dz = Math.abs(z - shape.center.z) - shape.halfExtents.z;
        return Math.hypot(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dy, dz), 0);
    }
    const ax = shape.to.x - shape.from.x, ay = shape.to.y - shape.from.y, az = shape.to.z - shape.from.z;
    const px = x - shape.from.x, py = y - shape.from.y, pz = z - shape.from.z;
    const length2 = ax * ax + ay * ay + az * az;
    const t = length2 > 0 ? Math.min(1, Math.max(0, (px * ax + py * ay + pz * az) / length2)) : 0;
    return Math.hypot(px - ax * t, py - ay * t, pz - az * t) - shape.radius;
}

function shapeBounds(shape: VoxelShape): [number, number, number, number, number, number] {
    if (shape.kind === 'sphere') {
        const { center: c, radius: r } = shape;
        return [c.x - r, c.y - r, c.z - r, c.x + r, c.y + r, c.z + r];
    }
    if (shape.kind === 'box') {
        const { center: c, halfExtents: h } = shape;
        return [c.x - h.x, c.y - h.y, c.z - h.z, c.x + h.x, c.y + h.y, c.z + h.z];
    }
    const { from: a, to: b, radius: r } = shape;
    return [Math.min(a.x, b.x) - r, Math.min(a.y, b.y) - r, Math.min(a.z, b.z) - r, Math.max(a.x, b.x) + r, Math.max(a.y, b.y) + r, Math.max(a.z, b.z) + r];
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toBase64(bytes: Uint8Array): string {
    const parts: string[] = [];
    for (let i = 0; i < bytes.length; i += 3) {
        const a = bytes[i]!, b = bytes[i + 1] ?? 0, c = bytes[i + 2] ?? 0;
        parts.push(BASE64[a >> 2]!, BASE64[((a & 3) << 4) | (b >> 4)]!,
            i + 1 < bytes.length ? BASE64[((b & 15) << 2) | (c >> 6)]! : '=', i + 2 < bytes.length ? BASE64[c & 63]! : '=');
    }
    return parts.join('');
}

function fromBase64(text: string): Uint8Array | null {
    if (text.length % 4 !== 0) return null;
    const pad = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
    const out = new Uint8Array(text.length / 4 * 3 - pad);
    let n = 0;
    for (let i = 0; i < text.length; i += 4) {
        const v = [0, 1, 2, 3].map((k) => (text[i + k] === '=' ? 0 : BASE64.indexOf(text[i + k]!)));
        if (v.some((x) => x < 0)) return null;
        if (n < out.length) out[n++] = (v[0]! << 2) | (v[1]! >> 4);
        if (n < out.length) out[n++] = ((v[1]! & 15) << 4) | (v[2]! >> 2);
        if (n < out.length) out[n++] = ((v[2]! & 3) << 6) | v[3]!;
    }
    return out;
}

/** Runs of (count 1..255, byte). Below ground and in the air a chunk is long runs, and a save is mostly these. */
function runLength(input: Uint8Array, out: number[]): void {
    for (let i = 0; i < input.length;) {
        let run = 1;
        while (run < 255 && i + run < input.length && input[i + run] === input[i]) run++;
        out.push(run, input[i]!);
        i += run;
    }
}

function unRunLength(input: Uint8Array, target: Uint8Array): boolean {
    let at = 0;
    for (let i = 0; i + 1 < input.length; i += 2) {
        const run = input[i]!;
        if (at + run > target.length) return false;
        target.fill(input[i + 1]!, at, at + run);
        at += run;
    }
    return at === target.length;
}

export class VoxelField {
    readonly cellSize: number;
    readonly chunkCells: number;
    readonly side: number;
    readonly rowMin: number;
    readonly rowMax: number;
    private readonly floorY_: number;
    private readonly ceilingY_: number;
    /** The world distance a stored byte's 127 stands for. */
    private readonly range_: number;
    private readonly source_: VoxelSource;
    private readonly cached_: number;
    private readonly chunks_ = new Map<string, VoxelChunk>();
    private readonly dirty_ = new Set<VoxelChunk>();
    private readonly sample_: VoxelSample = { distance: 0, material: 0 };
    private clock_ = 0;

    constructor(options: VoxelFieldOptions) {
        this.cellSize = Math.max(options.cellSize, 1e-3);
        this.chunkCells = Math.max(4, Math.min(64, Math.floor(options.chunkCells)));
        this.side = this.chunkCells + 2;
        const span = this.cellSize * this.chunkCells;
        this.floorY_ = options.minY + this.cellSize;
        this.ceilingY_ = options.maxY - this.cellSize;
        this.rowMin = Math.floor(options.minY / span);
        this.rowMax = Math.max(this.rowMin, Math.ceil(options.maxY / span) - 1);
        this.range_ = this.cellSize * RANGE_CELLS;
        this.source_ = options.source;
        this.cached_ = options.cached ?? 64;
    }

    /** The chunk, holding its samples. Asks the source when nothing holds them. */
    chunk(cx: number, cy: number, cz: number): VoxelChunk {
        const key = chunkKey(cx, cy, cz);
        let chunk = this.chunks_.get(key);
        if (!chunk) {
            chunk = { cx, cy, cz, key, distances: null, materials: null, edited: false, surfaced: false, revision: 0, savedRevision: 0, touched: 0 };
            this.chunks_.set(key, chunk);
        }
        if (!chunk.distances) this.generate_(chunk);
        chunk.touched = ++this.clock_;
        return chunk;
    }

    private generate_(chunk: VoxelChunk): void {
        const n = this.chunkCells, s = this.side, cell = this.cellSize, scale = 127 / this.range_;
        const distances = new Int8Array(s * s * s), materials = new Uint8Array(s * s * s);
        const out = this.sample_;
        let i = 0, solid = 0;
        for (let z = -1; z <= n; z++) {
            const wz = (chunk.cz * n + z) * cell;
            for (let y = -1; y <= n; y++) {
                const wy = (chunk.cy * n + y) * cell;
                for (let x = -1; x <= n; x++, i++) {
                    out.distance = 1;
                    out.material = 0;
                    this.source_((chunk.cx * n + x) * cell, wy, wz, out);
                    // Closed at both ends: a floor nothing digs through, and nothing standing past the top of what is built.
                    const d = Math.min(Math.max(out.distance, wy - this.ceilingY_), wy - this.floorY_);
                    const byte = clampByte(d * scale);
                    distances[i] = byte;
                    materials[i] = out.material;
                    if (byte < 0) solid++;
                }
            }
        }
        chunk.distances = distances;
        chunk.materials = materials;
        chunk.surfaced = solid > 0 && solid < i;
    }

    /** Lets go of what the source can make again, oldest first, past the number to hold. What `keep` names stays and is not counted: asking the source again is what a dig must not wait on. */
    trim(keep?: (chunk: VoxelChunk) => boolean): void {
        const free = [...this.chunks_.values()].filter((c) => !c.edited && c.distances && !keep?.(c));
        if (free.length <= this.cached_) return;
        free.sort((a, b) => a.touched - b.touched);
        for (let i = 0; i < free.length - this.cached_; i++) {
            if (!this.dirty_.has(free[i]!)) this.chunks_.delete(free[i]!.key);
        }
    }

    /** The chunks changed since this was last asked. */
    takeDirty(): VoxelChunk[] {
        const out = [...this.dirty_];
        this.dirty_.clear();
        return out;
    }

    /** Carves, fills or paints with a shape. Everything it reaches, the margins of the chunks round it included, changes together. */
    apply(shape: VoxelShape, op: VoxelOp, options: VoxelEditOptions = {}): VoxelEditResult {
        const cell = this.cellSize, n = this.chunkCells, s = this.side;
        const k = Math.max(options.smooth ?? 0, 0);
        const margin = op === 'paint' ? cell : this.range_ + k;
        const b = shapeBounds(shape);
        const g0 = [b[0] - margin, b[1] - margin, b[2] - margin].map((v) => Math.floor(v / cell));
        const g1 = [b[3] + margin, b[4] + margin, b[5] + margin].map((v) => Math.ceil(v / cell));
        const first = (g: number): number => Math.ceil((g - n) / n);
        const last = (g: number): number => Math.floor((g + 1) / n);
        const material = Math.max(0, Math.min(VOXEL_MATERIALS - 1, Math.floor(options.material ?? 0)));
        const removed = new Array<number>(VOXEL_MATERIALS).fill(0);
        let added = 0, touched = 0;
        const scale = 127 / this.range_, unit = this.range_ / 127, volume = cell * cell * cell;
        for (let cz = first(g0[2]!); cz <= last(g1[2]!); cz++) {
            for (let cy = Math.max(first(g0[1]!), this.rowMin); cy <= Math.min(last(g1[1]!), this.rowMax); cy++) {
                for (let cx = first(g0[0]!); cx <= last(g1[0]!); cx++) {
                    const chunk = this.chunk(cx, cy, cz);
                    const distances = chunk.distances!, materials = chunk.materials!;
                    let changed = false;
                    const zFrom = Math.max(-1, g0[2]! - cz * n), zTo = Math.min(n, g1[2]! - cz * n);
                    const yFrom = Math.max(-1, g0[1]! - cy * n), yTo = Math.min(n, g1[1]! - cy * n);
                    const xFrom = Math.max(-1, g0[0]! - cx * n), xTo = Math.min(n, g1[0]! - cx * n);
                    for (let z = zFrom; z <= zTo; z++) {
                        const wz = (cz * n + z) * cell;
                        for (let y = yFrom; y <= yTo; y++) {
                            const wy = (cy * n + y) * cell;
                            if (op === 'subtract' ? wy <= this.floorY_ : op === 'add' && wy >= this.ceilingY_) continue;
                            for (let x = xFrom; x <= xTo; x++) {
                                const i = (x + 1) + (y + 1) * s + (z + 1) * s * s;
                                const held = materials[i]!, before = distances[i]!;
                                if (options.keep?.(held) && before < 0) continue;
                                const d = shapeDistance(shape, (cx * n + x) * cell, wy, wz);
                                if (op === 'paint') {
                                    if (d < 0 && before < 0 && held !== material) { materials[i] = material; changed = true; }
                                    continue;
                                }
                                const was = before * unit;
                                const after = clampByte((op === 'subtract' ? smoothMax(was, -d, k) : smoothMin(was, d, k)) * scale);
                                if (after === before) continue;
                                distances[i] = after;
                                changed = true;
                                const owned = x >= 0 && x < n && y >= 0 && y < n && z >= 0 && z < n;
                                if (before < 0 && after >= 0 && owned) removed[held]! += volume;
                                if (before >= 0 && after < 0) {
                                    materials[i] = material;
                                    if (owned) added += volume;
                                }
                            }
                        }
                    }
                    if (changed) {
                        chunk.edited = true;
                        chunk.revision++;
                        this.refreshSurfaced_(chunk);
                        this.dirty_.add(chunk);
                        touched++;
                    }
                }
            }
        }
        return { removed, added, chunks: touched };
    }

    private refreshSurfaced_(chunk: VoxelChunk): void {
        const d = chunk.distances!;
        let solid = 0;
        for (let i = 0; i < d.length; i++) if (d[i]! < 0) solid++;
        chunk.surfaced = solid > 0 && solid < d.length;
    }

    private at_(gx: number, gy: number, gz: number): number {
        const n = this.chunkCells, s = this.side;
        const cy = Math.floor(gy / n);
        if (cy < this.rowMin) return -this.range_;
        if (cy > this.rowMax) return this.range_;
        const cx = Math.floor(gx / n), cz = Math.floor(gz / n);
        const chunk = this.chunk(cx, cy, cz);
        return chunk.distances![(gx - cx * n + 1) + (gy - cy * n + 1) * s + (gz - cz * n + 1) * s * s]! * (this.range_ / 127);
    }

    /** The signed distance at a place, read between the samples. */
    distanceAt(x: number, y: number, z: number): number {
        const cell = this.cellSize;
        const fx = x / cell, fy = y / cell, fz = z / cell;
        const gx = Math.floor(fx), gy = Math.floor(fy), gz = Math.floor(fz);
        const tx = fx - gx, ty = fy - gy, tz = fz - gz;
        const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
        const row = (dy: number, dz: number): number => lerp(this.at_(gx, gy + dy, gz + dz), this.at_(gx + 1, gy + dy, gz + dz), tx);
        return lerp(lerp(row(0, 0), row(1, 0), ty), lerp(row(0, 1), row(1, 1), ty), tz);
    }

    /** The material of the deepest solid sample round a place, or -1 where all round it is air. */
    materialAt(x: number, y: number, z: number): number {
        const cell = this.cellSize, n = this.chunkCells, s = this.side;
        const gx = Math.floor(x / cell), gy = Math.floor(y / cell), gz = Math.floor(z / cell);
        let best = -1, deepest = 0;
        for (let k = 0; k < 8; k++) {
            const ax = gx + (k & 1), ay = gy + ((k >> 1) & 1), az = gz + ((k >> 2) & 1);
            const cy = Math.floor(ay / n);
            if (cy < this.rowMin || cy > this.rowMax) continue;
            const cx = Math.floor(ax / n), cz = Math.floor(az / n);
            const chunk = this.chunk(cx, cy, cz);
            const i = (ax - cx * n + 1) + (ay - cy * n + 1) * s + (az - cz * n + 1) * s * s;
            if (chunk.distances![i]! < deepest) { deepest = chunk.distances![i]!; best = chunk.materials![i]!; }
        }
        return best;
    }

    /** Where a ray from `origin` first meets something solid, within `maxDistance`. `direction` need not be of any length. */
    raycast(origin: VoxelPoint, direction: VoxelPoint, maxDistance: number): VoxelHit | null {
        const length = Math.hypot(direction.x, direction.y, direction.z);
        if (!(length > 0)) return null;
        const dx = direction.x / length, dy = direction.y / length, dz = direction.z / length;
        const at = (t: number): number => this.distanceAt(origin.x + dx * t, origin.y + dy * t, origin.z + dz * t);
        let before = 0, t = 0, d = at(0);
        if (d < 0) return this.hit_(origin, dx, dy, dz, 0);
        while (t < maxDistance) {
            before = t;
            t = Math.min(maxDistance, t + Math.max(d * 0.75, this.cellSize * 0.25));
            d = at(t);
            if (d < 0) {
                let lo = before, hi = t;
                for (let i = 0; i < 12; i++) {
                    const mid = (lo + hi) * 0.5;
                    if (at(mid) < 0) hi = mid; else lo = mid;
                }
                return this.hit_(origin, dx, dy, dz, hi);
            }
        }
        return null;
    }

    private hit_(o: VoxelPoint, dx: number, dy: number, dz: number, t: number): VoxelHit {
        const x = o.x + dx * t, y = o.y + dy * t, z = o.z + dz * t, e = this.cellSize * 0.5;
        const nx = this.distanceAt(x + e, y, z) - this.distanceAt(x - e, y, z);
        const ny = this.distanceAt(x, y + e, z) - this.distanceAt(x, y - e, z);
        const nz = this.distanceAt(x, y, z + e) - this.distanceAt(x, y, z - e);
        const len = Math.hypot(nx, ny, nz) || 1;
        return { point: { x, y, z }, normal: { x: nx / len, y: ny / len, z: nz / len }, distance: t, material: Math.max(0, this.materialAt(x, y, z)) };
    }

    /** What the save holds: every chunk edited, or only those changed since the last call that asked for `changedOnly`. */
    serialize(changedOnly = false): VoxelFieldData {
        const chunks: Record<string, string> = {};
        for (const chunk of this.chunks_.values()) {
            if (!chunk.edited || (changedOnly && chunk.revision === chunk.savedRevision)) continue;
            const bytes: number[] = [];
            runLength(new Uint8Array(chunk.distances!.buffer), bytes);
            runLength(chunk.materials!, bytes);
            chunks[chunk.key] = toBase64(Uint8Array.from(bytes));
            chunk.savedRevision = chunk.revision;
        }
        return { version: 1, cellSize: this.cellSize, chunkCells: this.chunkCells, chunks };
    }

    /**
     * Puts saved chunks back over the volume. With `merge` those not named stay as they are; otherwise they go back to the source. A save cut from another grid cannot
     * be read and changes nothing: false. A chunk that cannot be read is left as it was, and named in `skipped`.
     */
    restore(data: VoxelFieldData, merge = false, skipped?: string[]): boolean {
        if (data?.version !== 1 || data.cellSize !== this.cellSize || data.chunkCells !== this.chunkCells) return false;
        if (!merge) {
            for (const chunk of [...this.chunks_.values()]) {
                if (!chunk.edited || data.chunks[chunk.key] !== undefined) continue;
                chunk.distances = null;
                chunk.materials = null;
                chunk.edited = false;
                chunk.revision++;
                this.generate_(chunk);
                this.dirty_.add(chunk);
            }
        }
        const total = this.side ** 3;
        for (const [key, text] of Object.entries(data.chunks)) {
            const place = key.split(',').map(Number);
            const bytes = fromBase64(text);
            if (place.length !== 3 || place.some((v) => !Number.isInteger(v)) || !bytes) { skipped?.push(key); continue; }
            const distances = new Int8Array(total), materials = new Uint8Array(total);
            let split = 0, count = 0;
            while (split + 1 < bytes.length && count < total) { count += bytes[split]!; split += 2; }
            if (count !== total || !unRunLength(bytes.subarray(0, split), new Uint8Array(distances.buffer)) || !unRunLength(bytes.subarray(split), materials)) { skipped?.push(key); continue; }
            const chunk = this.chunk(place[0]!, place[1]!, place[2]!);
            chunk.distances = distances;
            chunk.materials = materials;
            chunk.edited = true;
            chunk.revision++;
            chunk.savedRevision = chunk.revision;
            this.refreshSurfaced_(chunk);
            this.dirty_.add(chunk);
        }
        return true;
    }

    /** How many chunks are held with their samples, and how many of those were edited. */
    get held(): { chunks: number; edited: number } {
        let chunks = 0, edited = 0;
        for (const c of this.chunks_.values()) {
            if (c.distances) chunks++;
            if (c.edited) edited++;
        }
        return { chunks, edited };
    }
}
