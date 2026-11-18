// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * A sparse probe grid: fine bricks where geometry is, coarse ones in the air. What is claimed here is what a pixel
 * gate cannot see — that the bricks tile the grid exactly, that the fine ones are where the geometry is, and that a
 * probe a sparse bake solves is the probe a dense bake solves at the same place.
 */
import { describe, it, expect } from 'vitest';
import { bakeLightmap, planProbes, probeAt, stitchBricks, BRICK_CELLS, BRICK_PROBES, type BakeSurface, type ProbeGrid }
    from '../src/lightmap';
import { MeshChannel, MeshChannelType, type MeshData } from '../src/asset/meshFormat';

/** A floor quad at y = 0 across x, z in [-half, half], facing up. */
function floor(half: number): MeshData {
    const p = [[-half, 0, -half], [half, 0, -half], [half, 0, half], [-half, 0, half]];
    const stride = 24;
    const vertices = new Uint8Array(p.length * stride);
    const view = new DataView(vertices.buffer);
    p.forEach((q, i) => {
        for (let k = 0; k < 3; k++) view.setFloat32(i * stride + k * 4, q[k]!, true);
        view.setFloat32(i * stride + 16, 1, true);
    });
    return {
        channels: [
            { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32, offset: 0 },
            { semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32, offset: 12 },
        ],
        vertexStride: stride, vertexCount: 4, vertices,
        indices: Uint32Array.from([0, 2, 1, 0, 3, 2]),
        aabbMin: [-half, 0, -half], aabbMax: [half, 0, half],
    };
}
const IDENTITY = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** 33 x 17 x 33 probes, 8 x 4 x 8 finest-brick cells, over a box from y 0 up. */
const GRID: ProbeGrid = { min: [-160, 0, -160], max: [160, 160, 160], resolution: [33, 17, 33] };

/** Which brick covers each finest-brick cell; throws on a gap or an overlap. */
function coverage(bricks: Int32Array, cells: number[]): Int32Array {
    const owner = new Int32Array(cells[0]! * cells[1]! * cells[2]!).fill(-1);
    for (let b = 0; b < bricks.length / 4; b++) {
        const [x0, y0, z0, span] = [bricks[b * 4]!, bricks[b * 4 + 1]!, bricks[b * 4 + 2]!, bricks[b * 4 + 3]!];
        expect(x0 % span).toBe(0); expect(y0 % span).toBe(0); expect(z0 % span).toBe(0);
        for (let z = z0; z < Math.min(z0 + span, cells[2]!); z++) {
            for (let y = y0; y < Math.min(y0 + span, cells[1]!); y++) {
                for (let x = x0; x < Math.min(x0 + span, cells[0]!); x++) {
                    const at = x + cells[0]! * (y + cells[1]! * z);
                    if (owner[at] !== -1) throw new Error(`cell ${x},${y},${z} is covered twice`);
                    owner[at] = b;
                }
            }
        }
    }
    if (owner.includes(-1)) throw new Error('a cell is covered by no brick');
    return owner;
}

describe('a sparse probe grid', () => {
    it('is the dense grid at one level, in its order', () => {
        const layout = planProbes(GRID, () => true);
        expect(layout.bricks).toBeUndefined();
        expect(layout.positions.length).toBe(33 * 17 * 33 * 3);
        expect(layout.positions[3]).toBe(probeAt(-160, 160, 1, 33));
    });

    it('with geometry everywhere, is the dense grid again: no brick would be coarse', () => {
        const layout = planProbes({ ...GRID, levels: 3 }, () => true);
        expect(layout.bricks).toBeUndefined();
        expect(layout.positions.length).toBe(33 * 17 * 33 * 3);
    });

    it('with nothing near, is a handful of coarse bricks that tile the grid', () => {
        const layout = planProbes({ ...GRID, levels: 3 }, () => false);
        expect(Array.from(new Set(Array.from(layout.bricks!).filter((_, i) => i % 4 === 3)))).toEqual([4]);
        coverage(layout.bricks!, [8, 4, 8]);
        // 2 x 1 x 2 bricks of span 4 sharing faces: 9 x 5 x 9 distinct probes, against 33 x 17 x 33.
        expect(layout.positions.length / 3).toBe(9 * 5 * 9);
        expect(layout.brickProbes!.length).toBe((layout.bricks!.length / 4) * BRICK_PROBES);
    });

    it('is fine only near what is there, and still tiles the grid', () => {
        // Geometry in a slab along y 0 only: the bricks touching it split down to span 1, the rest stay coarse.
        const near = (lo: number[], hi: number[]) => lo[1]! <= 0 && hi[1]! >= 0;
        const layout = planProbes({ ...GRID, levels: 3 }, near);
        const bricks = layout.bricks!;
        coverage(bricks, [8, 4, 8]);
        for (let b = 0; b < bricks.length / 4; b++) {
            if (bricks[b * 4 + 1] === 0) expect(bricks[b * 4 + 3]).toBe(1);
        }
        expect(Array.from(bricks).some((v, i) => i % 4 === 3 && v > 1)).toBe(true);
        // A floor across the whole box is near the worst case: two layers of fine bricks, the air above coarse.
        expect(layout.positions.length / 3).toBeLessThan(33 * 17 * 33 * 0.7);
    });

    it('solves each probe as the dense bake solves the probe at the same place', () => {
        const surface: BakeSurface = { mesh: floor(200), transform: IDENTITY, albedo: [0.8, 0.6, 0.4] };
        const options = { ambient: [0.5, 0.5, 0.6] as [number, number, number], probeSamples: 32, bounces: 1,
                          samples: 16, atlasSize: 64, texelsPerUnit: 0.1 };
        // The floor is unwrapped by the bake's caller in practice; a quad's own UVs are one chart already.
        const mesh = surface.mesh;
        const withUv: MeshData = {
            ...mesh,
            channels: [...mesh.channels, { semantic: MeshChannel.TexCoord1, components: 2, type: MeshChannelType.Float32, offset: 24 }],
            vertexStride: 32,
            vertices: (() => {
                const out = new Uint8Array(4 * 32);
                const src = new DataView(mesh.vertices.buffer), dst = new DataView(out.buffer);
                const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
                for (let i = 0; i < 4; i++) {
                    for (let k = 0; k < 6; k++) dst.setFloat32(i * 32 + k * 4, src.getFloat32(i * 24 + k * 4, true), true);
                    dst.setFloat32(i * 32 + 24, uv[i]![0]!, true); dst.setFloat32(i * 32 + 28, uv[i]![1]!, true);
                }
                return out;
            })(),
        };
        const lit: BakeSurface = { ...surface, mesh: withUv };
        const dense = bakeLightmap([lit], [], { ...options, probeGrids: [GRID] });
        const sparse = bakeLightmap([lit], [], { ...options, probeGrids: [{ ...GRID, levels: 3 }] });
        expect(dense.probeBricks[0]).toBeNull();
        const bricks = sparse.probeBricks[0]!;
        expect(bricks).not.toBeNull();
        const side = BRICK_CELLS + 1;
        const coarsest = Math.max(...Array.from(bricks).filter((_, i) => i % 4 === 3));
        let compared = 0, worst = 0;
        for (let b = 0; b < bricks.length / 4; b++) {
            const span = bricks[b * 4 + 3]!;
            for (let t = 0; t < BRICK_PROBES; t++) {
                // A face a coarser brick touches is stitched to it (below); the rest is the solve's own.
                const onFace = [t % side, Math.floor(t / side) % side, Math.floor(t / (side * side))]
                    .some((v) => v === 0 || v === BRICK_CELLS);
                if (onFace && span < coarsest) continue;
                const f = [t % side, Math.floor(t / side) % side, Math.floor(t / (side * side))]
                    .map((v, a) => Math.min(bricks[b * 4 + a]! * BRICK_CELLS + v * span, GRID.resolution[a]! - 1));
                const d = (f[0]! + 33 * (f[1]! + 17 * f[2]!)) * 27;
                for (let c = 0; c < 27; c++) {
                    worst = Math.max(worst, Math.abs(sparse.probes[0]![(b * BRICK_PROBES + t) * 27 + c]! - dense.probes[0]![d + c]!));
                }
                compared++;
            }
        }
        expect(compared).toBeGreaterThan(BRICK_PROBES);
        expect(worst).toBe(0);
    });

    describe('stitched where bricks of two sizes meet', () => {
        // 17 x 9 x 9 probes, 4 x 2 x 2 finest-brick cells: one span-2 brick on the low half of x, eight span-1 on the high.
        const res: [number, number, number] = [17, 9, 9];
        const cells = [4, 2, 2];
        const bricks = Int32Array.from([0, 0, 0, 2,
            ...[2, 3].flatMap((x) => [0, 1].flatMap((y) => [0, 1].flatMap((z) => [x, y, z, 1])))]);
        // A field a bilinear face cannot hold, so the coarse face and the fine probes on it disagree.
        const field = (f: number[]) => 0.01 * f[0]! * f[0]! + 0.05 * f[1]! * f[1]! + 0.03 * f[2]! * f[2]! + 0.02 * f[1]! * f[2]!;
        const fill = (): Float32Array => {
            const data = new Float32Array((bricks.length / 4) * BRICK_PROBES);
            for (let b = 0; b < bricks.length / 4; b++) {
                for (let t = 0; t < BRICK_PROBES; t++) {
                    const f = [t % 5, Math.floor(t / 5) % 5, Math.floor(t / 25)].map((v, a) => bricks[b * 4 + a]! * 4 + v * bricks[b * 4 + 3]!);
                    data[b * BRICK_PROBES + t] = field(f);
                }
            }
            return data;
        };
        /** The runtime's read: the cell under the point names a brick, the brick blends its own probes. */
        const read = (data: Float32Array, p: number[]): number => {
            const c = p.map((v, a) => Math.min(Math.floor(v / 4), cells[a]! - 1));
            let b = -1;
            for (let k = 0; k < bricks.length / 4; k++) {
                const s = bricks[k * 4 + 3]!;
                if ([0, 1, 2].every((a) => c[a]! >= bricks[k * 4 + a]! && c[a]! < bricks[k * 4 + a]! + s)) { b = k; break; }
            }
            const span = bricks[b * 4 + 3]!;
            const lo = [0, 0, 0], fr = [0, 0, 0];
            for (let a = 0; a < 3; a++) {
                const local = (p[a]! - bricks[b * 4 + a]! * 4) / span;
                lo[a] = Math.min(Math.max(Math.floor(local), 0), 3);
                fr[a] = local - lo[a]!;
            }
            let v = 0;
            for (let k = 0; k < 8; k++) {
                const d = [k & 1, (k >> 1) & 1, (k >> 2) & 1];
                const w = d.reduce((acc, di, a) => acc * (di ? fr[a]! : 1 - fr[a]!), 1);
                v += w * data[b * BRICK_PROBES + (lo[0]! + d[0]!) + 5 * ((lo[1]! + d[1]!) + 5 * (lo[2]! + d[2]!))]!;
            }
            return v;
        };
        /** The largest step a read takes crossing the x = 8 face, sampled over the face. */
        const seam = (data: Float32Array): number => {
            let worst = 0;
            for (let y = 0; y <= 8; y += 0.25) {
                for (let z = 0; z <= 8; z += 0.25) worst = Math.max(worst, Math.abs(read(data, [8 - 1e-4, y, z]) - read(data, [8 + 1e-4, y, z])));
            }
            return worst;
        };

        it('jumps across the face before, and not after', () => {
            const data = fill();
            const before = seam(data);
            stitchBricks(res, bricks, data, 1);
            const after = seam(data);
            expect(before).toBeGreaterThan(0.01);
            expect(after).toBeLessThan(1e-4);
        });

        it('changes only the fine bricks\' faces the coarse brick touches', () => {
            const data = fill();
            const original = data.slice();
            stitchBricks(res, bricks, data, 1);
            for (let t = 0; t < BRICK_PROBES; t++) expect(data[t]).toBe(original[t]);
            for (let b = 1; b < bricks.length / 4; b++) {
                for (let t = 0; t < BRICK_PROBES; t++) {
                    const tx = t % 5;
                    const touches = bricks[b * 4] === 2 && tx === 0;
                    if (!touches) expect(data[b * BRICK_PROBES + t]).toBe(original[b * BRICK_PROBES + t]);
                }
            }
        });

        it('is continuous across every face, edge and corner of a three-level plan', () => {
            const grid: ProbeGrid = { min: [0, 0, 0], max: [32, 32, 32], resolution: [33, 33, 33], levels: 3 };
            // Geometry near one corner only: span 1 there, 2 around it, 4 beyond.
            const layout = planProbes(grid, (lo) => lo[0] < 6 && lo[1] < 6 && lo[2] < 6);
            const b3 = layout.bricks!;
            expect(new Set(Array.from(b3).filter((_, i) => i % 4 === 3))).toEqual(new Set([1, 2, 4]));
            const f3 = (f: number[]) => 0.003 * f[0]! * f[0]! + 0.002 * f[1]! * f[2]! + 0.004 * f[2]! * f[2]! + 0.001 * f[0]! * f[1]!;
            const data = new Float32Array((b3.length / 4) * BRICK_PROBES);
            for (let b = 0; b < b3.length / 4; b++) {
                for (let t = 0; t < BRICK_PROBES; t++) {
                    const f = [t % 5, Math.floor(t / 5) % 5, Math.floor(t / 25)].map((v, a) => Math.min(b3[b * 4 + a]! * 4 + v * b3[b * 4 + 3]!, 32));
                    data[b * BRICK_PROBES + t] = f3(f);
                }
            }
            const cells3 = [8, 8, 8];
            const read3 = (p: number[]): number => {
                const c = p.map((v, a) => Math.min(Math.floor(v / 4), cells3[a]! - 1));
                let b = 0;
                for (; b < b3.length / 4; b++) {
                    const s = b3[b * 4 + 3]!;
                    if ([0, 1, 2].every((a) => c[a]! >= b3[b * 4 + a]! && c[a]! < b3[b * 4 + a]! + s)) break;
                }
                const span = b3[b * 4 + 3]!;
                let v = 0;
                const lo = [0, 0, 0], fr = [0, 0, 0];
                for (let a = 0; a < 3; a++) {
                    const local = (p[a]! - b3[b * 4 + a]! * 4) / span;
                    lo[a] = Math.min(Math.max(Math.floor(local), 0), 3);
                    fr[a] = local - lo[a]!;
                }
                for (let k = 0; k < 8; k++) {
                    const d = [k & 1, (k >> 1) & 1, (k >> 2) & 1];
                    const w = d.reduce((acc, di, a) => acc * (di ? fr[a]! : 1 - fr[a]!), 1);
                    v += w * data[b * BRICK_PROBES + (lo[0]! + d[0]!) + 5 * ((lo[1]! + d[1]!) + 5 * (lo[2]! + d[2]!))]!;
                }
                return v;
            };
            const worstJump = (): number => {
                let worst = 0;
                let seed = 7;
                const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
                for (let i = 0; i < 4000; i++) {
                    const axis = i % 3;
                    const p = [rnd() * 32, rnd() * 32, rnd() * 32];
                    p[axis] = 4 * (1 + Math.floor(rnd() * 7));
                    const a = p.slice(), q = p.slice();
                    a[axis]! -= 1e-4; q[axis]! += 1e-4;
                    worst = Math.max(worst, Math.abs(read3(a) - read3(q)));
                }
                return worst;
            };
            const before = worstJump();
            stitchBricks(layout.resolution, b3, data, 1);
            const after = worstJump();
            expect(before).toBeGreaterThan(0.005);
            expect(after).toBeLessThan(1e-4);
        });

        it('stitches every number of a probe (an irradiance\'s 27)', () => {
            const one = fill();
            const wide = new Float32Array(one.length * 27);
            for (let i = 0; i < one.length; i++) for (let k = 0; k < 27; k++) wide[i * 27 + k] = one[i]! * (k + 1);
            stitchBricks(res, bricks, one, 1);
            stitchBricks(res, bricks, wide, 27);
            for (let i = 0; i < one.length; i++) for (let k = 0; k < 27; k++) expect(wide[i * 27 + k]).toBeCloseTo(one[i]! * (k + 1), 4);
        });
    });
});
