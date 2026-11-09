// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** A volume and its skin, with no engine: what can be dug, what it gives back, that chunks meet with no crack, and what a save holds. */
import { describe, expect, it } from 'vitest';
import { VoxelField, type VoxelFieldData, type VoxelSource } from '../src/voxel/field';
import { heightVoxelSource, noiseVoxelSource, VoxelMaterial } from '../src/voxel/source';
import { surfaceNets, type VoxelSurface } from '../src/voxel/surfaceNets';

const flat: VoxelSource = (_x, y, _z, out) => { out.distance = y; out.material = 2; };
const make = (source: VoxelSource = flat, cached = 64) => new VoxelField({ cellSize: 1, chunkCells: 8, minY: -16, maxY: 16, source, cached });
const skinOf = (f: VoxelField, cx: number, cy: number, cz: number): VoxelSurface | null => {
    const c = f.chunk(cx, cy, cz);
    return surfaceNets(c.distances!, c.materials!, f.chunkCells, f.cellSize);
};
const rows = (f: VoxelField) => { const out: number[] = []; for (let y = f.rowMin; y <= f.rowMax; y++) out.push(y); return out; };

/** Every skin of a square of columns, in world positions, each triangle as its three vertices. */
function world(f: VoxelField, from: number, to: number): { x: number; y: number; z: number; nx: number; ny: number; nz: number }[][] {
    const span = f.cellSize * f.chunkCells, out: { x: number; y: number; z: number; nx: number; ny: number; nz: number }[][] = [];
    for (let cz = from; cz <= to; cz++) for (const cy of rows(f)) for (let cx = from; cx <= to; cx++) {
        const s = skinOf(f, cx, cy, cz);
        if (!s) continue;
        for (let i = 0; i < s.indices.length; i += 3) {
            out.push([0, 1, 2].map((k) => {
                const v = s.indices[i + k]!;
                return { x: s.positions[v * 3]! + cx * span, y: s.positions[v * 3 + 1]! + cy * span, z: s.positions[v * 3 + 2]! + cz * span, nx: s.normals[v * 3]!, ny: s.normals[v * 3 + 1]!, nz: s.normals[v * 3 + 2]! };
            }));
        }
    }
    return out;
}

/** Edges not matched by as many running the other way: a hole, or a surface not closed where chunks meet. Inside the square only. */
function openEdges(tris: ReturnType<typeof world>, inside: (x: number, z: number) => boolean): number {
    const key = (p: { x: number; y: number; z: number }) => `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`;
    const edges = new Map<string, number>();
    for (const t of tris) for (let k = 0; k < 3; k++) {
        const a = t[k]!, b = t[(k + 1) % 3]!;
        if (!inside(a.x, a.z) || !inside(b.x, b.z)) continue;
        edges.set(`${key(a)}|${key(b)}`, (edges.get(`${key(a)}|${key(b)}`) ?? 0) + 1);
    }
    let open = 0;
    for (const e of edges.keys()) {
        const [a, b] = e.split('|');
        // Equal both ways, not once each: a cell where two sheets touch shares an edge between four faces, and that is no gap.
        if ((edges.get(`${b}|${a}`) ?? 0) !== edges.get(e)) open++;
    }
    return open;
}

describe('a volume', () => {
    it('reads what its source says, and is solid below zero', () => {
        const f = make();
        expect(f.distanceAt(3.5, 2, 3.5)).toBeCloseTo(2, 1);
        expect(f.distanceAt(3.5, -2, 3.5)).toBeCloseTo(-2, 1);
        expect(f.materialAt(3.5, -2, 3.5)).toBe(2);
        expect(f.materialAt(3.5, 3, 3.5)).toBe(-1);
    });

    it('holds what a height field cannot: air under solid, in one column', () => {
        const f = make();
        f.apply({ kind: 'sphere', center: { x: 4, y: -8, z: 4 }, radius: 3 }, 'subtract');
        expect(f.distanceAt(4, 1, 4)).toBeGreaterThan(0);
        expect(f.distanceAt(4, -2, 4)).toBeLessThan(0);
        expect(f.distanceAt(4, -8, 4)).toBeGreaterThan(0);
        expect(f.distanceAt(4, -13, 4)).toBeLessThan(0);
    });

    it('says how much came out of each material, about the volume of the shape', () => {
        const f = make();
        const r = f.apply({ kind: 'sphere', center: { x: 0.3, y: -8.2, z: 0.1 }, radius: 3 }, 'subtract');
        expect(r.removed[2]!).toBeGreaterThan(4 / 3 * Math.PI * 27 * 0.85);
        expect(r.removed[2]!).toBeLessThan(4 / 3 * Math.PI * 27 * 1.15);
        expect(r.removed[0]).toBe(0);
        expect(r.chunks).toBeGreaterThan(1);
    });

    it('counts a place on a border once, however many chunks hold a copy of it', () => {
        const f = make();
        const box = f.apply({ kind: 'box', center: { x: 8, y: -8, z: 8 }, halfExtents: { x: 2.5, y: 2.5, z: 2.5 } }, 'subtract');
        expect(box.removed[2]).toBe(125);
    });

    it('fills with the material it is told, and digging it gives that back', () => {
        const f = make();
        const up = f.apply({ kind: 'box', center: { x: 4, y: 5, z: 4 }, halfExtents: { x: 1.5, y: 1.5, z: 1.5 } }, 'add', { material: 3 });
        expect(up.added).toBe(27);
        expect(f.materialAt(4, 5, 4)).toBe(3);
        const down = f.apply({ kind: 'box', center: { x: 4, y: 5, z: 4 }, halfExtents: { x: 1.5, y: 1.5, z: 1.5 } }, 'subtract');
        expect(down.removed[3]).toBe(27);
    });

    it('paints without changing the shape', () => {
        const f = make();
        const before = f.distanceAt(4, -3, 4);
        f.apply({ kind: 'sphere', center: { x: 4, y: -3, z: 4 }, radius: 2 }, 'paint', { material: 1 });
        expect(f.materialAt(4, -3, 4)).toBe(1);
        expect(f.distanceAt(4, -3, 4)).toBe(before);
        expect(f.materialAt(4, -9, 4)).toBe(2);
    });

    it('leaves alone what the edit is told to keep', () => {
        const f = make();
        const r = f.apply({ kind: 'sphere', center: { x: 4, y: -8, z: 4 }, radius: 3 }, 'subtract', { keep: (m) => m === 2 });
        expect(r.chunks).toBe(0);
        expect(f.distanceAt(4, -8, 4)).toBeLessThan(0);
    });

    it('has a floor nothing digs through and a top nothing is built past', () => {
        const f = make();
        f.apply({ kind: 'sphere', center: { x: 4, y: -16, z: 4 }, radius: 6 }, 'subtract');
        expect(f.distanceAt(4, -15.5, 4)).toBeLessThan(0);
        f.apply({ kind: 'sphere', center: { x: 4, y: 16, z: 4 }, radius: 6 }, 'add');
        expect(f.distanceAt(4, 15.5, 4)).toBeGreaterThan(0);
    });

    it('carves a capsule along its length, and melts a smooth edge', () => {
        const f = make();
        f.apply({ kind: 'capsule', from: { x: 0, y: -6, z: 0 }, to: { x: 20, y: -6, z: 0 }, radius: 2 }, 'subtract');
        for (const x of [0, 7, 16, 20]) expect(f.distanceAt(x, -6, 0)).toBeGreaterThan(0);
        expect(f.distanceAt(26, -6, 0)).toBeLessThan(0);
        const sharp = make(), soft = make();
        sharp.apply({ kind: 'sphere', center: { x: 4, y: 0, z: 4 }, radius: 3 }, 'subtract');
        soft.apply({ kind: 'sphere', center: { x: 4, y: 0, z: 4 }, radius: 3 }, 'subtract', { smooth: 3 });
        expect(soft.distanceAt(7.6, -0.5, 4)).toBeGreaterThan(sharp.distanceAt(7.6, -0.5, 4));
    });
});

describe('the skin', () => {
    it('lies on the surface, faces out of the solid and is lit from there', () => {
        const f = make();
        const tris = world(f, 0, 0);
        expect(tris.length).toBeGreaterThan(0);
        for (const t of tris) {
            for (const v of t) {
                expect(v.y).toBeCloseTo(0, 1);
                expect(v.ny).toBeCloseTo(1, 2);
            }
            const [a, b, c] = t as [typeof t[0], typeof t[0], typeof t[0]];
            const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
            expect(ny).toBeGreaterThan(0);
        }
    });

    it('has none where nothing passes', () => {
        const f = make();
        expect(f.chunk(0, 1, 0).surfaced).toBe(false);
        expect(skinOf(f, 0, 1, 0)).toBeNull();
    });

    it('closes across chunks, edited or not: no edge is left open inside', () => {
        const f = make(noiseVoxelSource({ seed: 3, surfaceHeight: 0, hillHeight: 6, hillScale: 14, caveWidth: 2, caveScale: 12, soilDepth: 3, oreAmount: 0.1 }));
        const inside = (x: number, z: number): boolean => x > 2 && x < 22 && z > 2 && z < 22;
        expect(openEdges(world(f, -1, 3), inside)).toBe(0);
        f.apply({ kind: 'sphere', center: { x: 8, y: 0, z: 8 }, radius: 5 }, 'subtract');
        f.apply({ kind: 'capsule', from: { x: 8, y: -2, z: 8 }, to: { x: 16, y: -4, z: 16 }, radius: 2 }, 'subtract');
        f.apply({ kind: 'box', center: { x: 16, y: 3, z: 8 }, halfExtents: { x: 3, y: 3, z: 3 } }, 'add', { material: 1 });
        expect(openEdges(world(f, -1, 3), inside)).toBe(0);
    });

    it('weighs a vertex by the materials of the corners round it', () => {
        const half: VoxelSource = (x, y, _z, out) => { out.distance = y; out.material = x < 4 ? 0 : 3; };
        const f = make(half);
        const s = skinOf(f, 0, -1, 0)!;
        const seen = new Set<string>();
        for (let v = 0; v < s.positions.length / 3; v++) {
            const w = [...s.weights.subarray(v * 4, v * 4 + 4)];
            expect(w[0]! + w[1]! + w[2]! + w[3]!).toBeGreaterThanOrEqual(254);
            seen.add(s.positions[v * 3]! < 3 ? 'left' : s.positions[v * 3]! > 4 ? 'right' : 'middle');
            if (s.positions[v * 3]! < 3) expect(w[0]).toBe(255);
            if (s.positions[v * 3]! > 4) expect(w[3]).toBe(255);
        }
        expect(seen.has('left') && seen.has('right')).toBe(true);
    });
});

describe('a ray', () => {
    it('stops at the surface from above, facing back up', () => {
        const hit = make().raycast({ x: 3, y: 10, z: 3 }, { x: 0, y: -5, z: 0 }, 40)!;
        expect(hit.point.y).toBeCloseTo(0, 1);
        expect(hit.distance).toBeCloseTo(10, 1);
        expect(hit.normal.y).toBeCloseTo(1, 1);
        expect(hit.material).toBe(2);
    });

    it('passes down a shaft that was dug, and finds its bottom', () => {
        const f = make();
        f.apply({ kind: 'capsule', from: { x: 3, y: 0, z: 3 }, to: { x: 3, y: -8, z: 3 }, radius: 2 }, 'subtract');
        expect(f.raycast({ x: 3, y: 5, z: 3 }, { x: 0, y: -1, z: 0 }, 40)!.point.y).toBeCloseTo(-10, 0);
    });

    it('finds nothing past its reach or pointing away, and starts inside at once', () => {
        const f = make();
        expect(f.raycast({ x: 3, y: 10, z: 3 }, { x: 0, y: -1, z: 0 }, 5)).toBeNull();
        expect(f.raycast({ x: 3, y: 10, z: 3 }, { x: 0, y: 1, z: 0 }, 5)).toBeNull();
        expect(f.raycast({ x: 3, y: -3, z: 3 }, { x: 0, y: 1, z: 0 }, 5)!.distance).toBe(0);
    });
});

describe('a save', () => {
    const dig = (f: VoxelField) => f.apply({ kind: 'sphere', center: { x: 4, y: -2, z: 4 }, radius: 3 }, 'subtract');

    it('holds only the chunks that were edited, and is small for what it holds', () => {
        const f = make();
        f.chunk(40, 0, 40);
        dig(f);
        const data = f.serialize();
        expect(Object.keys(data.chunks).length).toBe(f.held.edited);
        expect(data.chunks['40,0,40']).toBeUndefined();
        const raw = f.held.edited * 10 ** 3 * 2;
        expect(JSON.stringify(data).length).toBeLessThan(raw);
    });

    it('comes back through JSON to the same volume', () => {
        const a = make();
        dig(a);
        a.apply({ kind: 'box', center: { x: 4, y: 3, z: 4 }, halfExtents: { x: 1.5, y: 1.5, z: 1.5 } }, 'add', { material: 3 });
        const b = make();
        expect(b.restore(JSON.parse(JSON.stringify(a.serialize())) as VoxelFieldData)).toBe(true);
        for (const p of [[4, -2, 4], [4, 3, 4], [1, -2, 4], [7.5, -1, 4], [20, -1, 20]] as const) {
            expect(b.distanceAt(p[0], p[1], p[2])).toBe(a.distanceAt(p[0], p[1], p[2]));
            expect(b.materialAt(p[0], p[1], p[2])).toBe(a.materialAt(p[0], p[1], p[2]));
        }
        expect(b.held.edited).toBe(a.held.edited);
        const skinA = skinOf(a, 0, 0, 0)!, skinB = skinOf(b, 0, 0, 0)!;
        expect([...skinB.positions]).toEqual([...skinA.positions]);
    });

    it('can be taken chunk by chunk: only what changed since the last time', () => {
        const f = make();
        dig(f);
        expect(Object.keys(f.serialize(true).chunks).length).toBeGreaterThan(0);
        expect(Object.keys(f.serialize(true).chunks).length).toBe(0);
        f.apply({ kind: 'sphere', center: { x: 44, y: -2, z: 4 }, radius: 2 }, 'subtract');
        const next = Object.keys(f.serialize(true).chunks);
        expect(next.length).toBeGreaterThan(0);
        expect(next.every((k) => Number(k.split(',')[0]) >= 4)).toBe(true);
        expect(Object.keys(f.serialize().chunks).length).toBe(f.held.edited);
    });

    it('merges a part over what is there, and otherwise puts all back to the source', () => {
        const a = make();
        dig(a);
        const part = a.serialize();
        const b = make();
        b.apply({ kind: 'sphere', center: { x: 44, y: -2, z: 4 }, radius: 2 }, 'subtract');
        b.restore(part, true);
        expect(b.distanceAt(4, -2, 4)).toBeGreaterThan(0);
        expect(b.distanceAt(44, -2, 4)).toBeGreaterThan(0);
        b.restore(part);
        expect(b.distanceAt(4, -2, 4)).toBeGreaterThan(0);
        expect(b.distanceAt(44, -2, 4)).toBeLessThan(0);
    });

    it('refuses a save cut from another grid, and skips a chunk it cannot read', () => {
        const a = make();
        dig(a);
        const other = new VoxelField({ cellSize: 2, chunkCells: 8, minY: -16, maxY: 16, source: flat });
        expect(other.restore(a.serialize())).toBe(false);
        const data = a.serialize();
        const key = Object.keys(data.chunks)[0]!;
        data.chunks[key] = 'not a chunk!';
        data.chunks['a,b,c'] = 'AAAA';
        const skipped: string[] = [];
        const b = make();
        expect(b.restore(data, false, skipped)).toBe(true);
        expect(skipped.sort()).toEqual([key, 'a,b,c'].sort());
    });

    it('survives what it can make again being let go, and keeps what was dug', () => {
        const asked = { n: 0 };
        const counted: VoxelSource = (x, y, z, out) => { asked.n++; flat(x, y, z, out); };
        const f = make(counted, 2);
        dig(f);
        for (let x = 10; x < 20; x++) f.chunk(x, 0, 0);
        f.trim();
        expect(f.held.chunks).toBe(f.held.edited + 2);
        const before = asked.n;
        expect(f.distanceAt(4, -2, 4)).toBeGreaterThan(0);
        expect(asked.n).toBe(before);
        expect(f.distanceAt(100, -2, 4)).toBeLessThan(0);
        expect(asked.n).toBeGreaterThan(before);
    });
});

describe('the stock ground', () => {
    const source = noiseVoxelSource({ seed: 5, surfaceHeight: 0, hillHeight: 10, hillScale: 40, caveWidth: 3, caveScale: 30, soilDepth: 4, oreAmount: 0.1 });
    const probe = (x: number, y: number, z: number) => { const out = { distance: 0, material: 0 }; source(x, y, z, out); return out; };

    it('is the same each time it is asked, in any order', () => {
        const a = probe(13, -6, 7);
        probe(-40, 3, 90);
        expect(probe(13, -6, 7)).toEqual(a);
    });

    it('is air high up and solid soil just under its surface, and has rock and ore further down', () => {
        expect(probe(0, 40, 0).distance).toBeGreaterThan(0);
        let solid = 0, air = 0;
        const seen = new Set<number>();
        for (let x = 0; x < 80; x += 2) for (let z = 0; z < 80; z += 2) for (let y = -40; y < -6; y += 2) {
            const s = probe(x, y, z);
            if (s.distance < 0) { solid++; seen.add(s.material); } else air++;
        }
        expect(solid).toBeGreaterThan(air);
        expect(air).toBeGreaterThan(0);
        expect(seen.has(VoxelMaterial.Rock)).toBe(true);
        expect(seen.has(VoxelMaterial.Ore)).toBe(true);
    });
});

describe('a body under a height field', () => {
    it('is solid to the height and can be dug as a volume', () => {
        const f = make(heightVoxelSource((x) => x * 0.5));
        expect(f.distanceAt(4, 3, 4)).toBeGreaterThan(0);
        expect(f.distanceAt(4, 1, 4)).toBeLessThan(0);
        f.apply({ kind: 'sphere', center: { x: 4, y: 0, z: 4 }, radius: 1.5 }, 'subtract');
        expect(f.distanceAt(4, 0, 4)).toBeGreaterThan(0);
    });

    it('is air where it knows no height', () => {
        const f = make(heightVoxelSource((x) => (x < 100 ? 0 : null)));
        expect(f.distanceAt(200, -3, 0)).toBeGreaterThan(0);
    });
});
