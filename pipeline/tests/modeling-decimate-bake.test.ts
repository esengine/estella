// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** Fewer triangles over the same surface, and that surface's detail read back out of the map. */
import { beforeAll, describe, expect, it } from 'vitest';
import { MeshChannel } from 'esengine';
import { applyModelEdits, bakeModel, bakeNormalMap, prepareModeling, validateModelSource, type BakedModel, type ModelStep } from '../src/modeling';

beforeAll(() => prepareModeling());

const model = (...steps: ModelStep[]): BakedModel => bakeModel({ version: 1, steps });
const ball: ModelStep = { op: 'sphere', radius: 1, rings: 48, sides: 96, tag: 'ball', color: [1, 1, 1] };

function volume(m: BakedModel): number {
    let v = 0;
    for (const { v: [a, b, c] } of m.triangles) {
        const [p, q, r] = [m.poly.positions[a]!, m.poly.positions[b]!, m.poly.positions[c]!];
        v += p[0] * (q[1] * r[2] - q[2] * r[1]) + p[1] * (q[2] * r[0] - q[0] * r[2]) + p[2] * (q[0] * r[1] - q[1] * r[0]);
    }
    return v / 6;
}

function channel(m: BakedModel, semantic: number, components: number): Float32Array {
    const { data } = m;
    const { offset } = data.channels.find((c) => c.semantic === semantic)!;
    const view = new DataView(data.vertices.buffer, data.vertices.byteOffset, data.vertices.byteLength);
    const out = new Float32Array(data.vertexCount * components);
    for (let v = 0; v < data.vertexCount; v++) for (let k = 0; k < components; k++) out[v * components + k] = view.getFloat32(v * data.vertexStride + offset + k * 4, true);
    return out;
}

/** What the shader makes of the map at a point of a triangle: the texel there, in the frame the mesh carries, in model space. */
function shadedNormal(m: BakedModel, rgba: Uint8Array, size: number, triangle: number, w: readonly [number, number, number]): { normal: number[]; at: number[] } {
    const [uv, n, t, p] = [channel(m, MeshChannel.TexCoord0, 2), channel(m, MeshChannel.Normal, 3), channel(m, MeshChannel.Tangent, 4), channel(m, MeshChannel.Position, 3)];
    const corners = [m.data.indices[triangle * 3]!, m.data.indices[triangle * 3 + 1]!, m.data.indices[triangle * 3 + 2]!];
    const mix = (a: Float32Array, per: number, k: number): number => corners.reduce((sum, c, i) => sum + a[c * per + k]! * w[i]!, 0);
    const x = Math.min(size - 1, Math.floor(mix(uv, 2, 0) * size));
    const y = Math.min(size - 1, Math.floor((1 - mix(uv, 2, 1)) * size));
    const texel = (y * size + x) * 4;
    const tx = rgba[texel]! / 255 * 2 - 1, ty = rgba[texel + 1]! / 255 * 2 - 1;
    const tz = Math.sqrt(Math.max(0, 1 - tx * tx - ty * ty));
    const nl = Math.hypot(mix(n, 3, 0), mix(n, 3, 1), mix(n, 3, 2));
    const N = [mix(n, 3, 0) / nl, mix(n, 3, 1) / nl, mix(n, 3, 2) / nl] as const;
    const raw = [mix(t, 4, 0), mix(t, 4, 1), mix(t, 4, 2)] as const;
    const lean = raw[0] * N[0] + raw[1] * N[1] + raw[2] * N[2];
    const g = [raw[0] - N[0] * lean, raw[1] - N[1] * lean, raw[2] - N[2] * lean];
    const gl = Math.hypot(g[0]!, g[1]!, g[2]!) || 1;
    const T = [g[0]! / gl, g[1]! / gl, g[2]! / gl] as const;
    const hand = mix(t, 4, 3);
    const B = [(N[1] * T[2] - N[2] * T[1]) * hand, (N[2] * T[0] - N[0] * T[2]) * hand, (N[0] * T[1] - N[1] * T[0]) * hand] as const;
    const out = [0, 1, 2].map((k) => T[k]! * tx + B[k]! * ty + N[k]! * tz);
    const l = Math.hypot(out[0]!, out[1]!, out[2]!) || 1;
    return { normal: out.map((c) => c / l), at: [mix(p, 3, 0), mix(p, 3, 1), mix(p, 3, 2)] };
}

const MIDDLE = [1 / 3, 1 / 3, 1 / 3] as const;

const degrees = (a: readonly number[], b: readonly number[]): number =>
    (Math.acos(Math.max(-1, Math.min(1, a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!))) * 180) / Math.PI;

describe('decimate', () => {
    it('keeps the asked share and the shape: closed, the same size, nearly the same volume', () => {
        const full = model(ball);
        const light = model(ball, { op: 'decimate', ratio: 0.1, error: 0.05 });
        expect(light.report.triangles).toBeLessThanOrEqual(Math.ceil(full.report.triangles * 0.11));
        expect(light.report.openEdges).toBe(0);
        expect(light.report.nonManifoldEdges).toBe(0);
        expect(light.report.insideOutShells).toBe(0);
        expect(Math.abs(volume(light) - volume(full)) / volume(full)).toBeLessThan(0.05);
        expect(light.report.bounds.size[0]).toBeGreaterThan(1.9);
    });

    it('`triangles` ends near that many, and the report says what it was given and what it left', () => {
        const m = model(ball, { op: 'decimate', triangles: 400, error: 0.1 });
        expect(m.report.triangles).toBeLessThanOrEqual(400);
        const step = m.report.steps.at(-1)!;
        expect(step.trianglesBefore).toBeGreaterThan(5000);
        expect(step.trianglesAfter).toBe(m.report.triangles);
    });

    it('says when the error limit stopped it short of what was asked', () => {
        const m = model(ball, { op: 'decimate', triangles: 20, error: 0.0005 });
        expect(m.report.triangles).toBeGreaterThan(22);
        expect(m.report.warnings.join()).toMatch(/stopped at \d+ triangles of the 20 asked/);
    });

    it('a flat grid goes to almost nothing, because nothing is lost', () => {
        const m = model({ op: 'plane', size: 2 }, { op: 'slice', axis: 'x', at: [-0.5, 0, 0.5] }, { op: 'slice', axis: 'z', at: [-0.5, 0, 0.5] }, { op: 'weld' }, { op: 'decimate', ratio: 0.2 });
        expect(m.report.bounds.size).toEqual([2, 0, 2]);
        expect(m.report.openEdges).toBeGreaterThan(0);
        // The rim is held, so it can only lose what lies inside it.
        expect(m.report.triangles).toBeLessThan(18);
    });

    it('keeps paint and tags on the side they were on', () => {
        const m = model(
            { op: 'organic', resolution: 48, blend: 0, parts: [
                { shape: 'sphere', radius: 1, at: [-1.2, 0, 0], tag: 'left', color: [1, 0, 0] },
                { shape: 'sphere', radius: 1, at: [1.2, 0, 0], tag: 'right', color: [0, 0, 1] },
            ] },
            { op: 'decimate', ratio: 0.2, error: 0.05 },
        );
        expect(m.report.tags.left).toBeGreaterThan(0);
        expect(m.report.tags.right).toBeGreaterThan(0);
        for (const face of m.poly.faces) {
            const x = face.v.reduce((sum, v) => sum + m.poly.positions[v]![0], 0) / face.v.length;
            expect(face.tag).toBe(x < 0 ? 'left' : 'right');
            expect(face.color![0]).toBe(x < 0 ? 1 : 0);
            expect(face.smooth).toBe(true);
        }
    });

    it('`faces` leaves the rest as they were, and the seam between them stays shut', () => {
        const eye: ModelStep = { op: 'sphere', radius: 0.2, rings: 16, sides: 32, at: [5, 0, 0], tag: 'eye' };
        const m = model(ball, eye, { op: 'decimate', faces: 'ball', ratio: 0.1, error: 0.05 });
        const before = model(ball, eye);
        expect(m.report.tags.eye).toBe(before.report.tags.eye);
        expect(m.report.tags.ball).toBeLessThan(before.report.tags.ball! * 0.2);
        expect(m.report.openEdges).toBe(0);
    });

    it('a rig is found on what is left, not on what was', () => {
        const m = bakeModel({
            version: 1,
            rig: { joints: [{ name: 'root', at: [0, -1, 0] }, { name: 'top', at: [0, 1, 0], parent: 'root' }] },
            steps: [ball, { op: 'decimate', ratio: 0.1, error: 0.05 }],
        });
        expect(m.rig!.skin.joints.length).toBe(m.poly.positions.length * 4);
        expect(m.data.channels.some((c) => c.semantic === MeshChannel.Joints)).toBe(true);
    });

    it('`from` thins the surface before its fine detail, so the triangles go to the form and not to the noise', () => {
        const box: ModelStep = { id: 'form', op: 'organic', resolution: 64, blend: 0.02, parts: [{ shape: 'box', size: [2, 2, 2], rounding: 0.05 }] };
        const noise: ModelStep = { op: 'displace', pattern: 'bumps', amplitude: 0.04, scale: 0.1, octaves: 2, detail: 0.025 };
        const after = model(box, noise, { op: 'decimate', triangles: 300, error: 0.5 });
        const before = model(box, noise, { op: 'decimate', from: 'form', triangles: 300, error: 0.5 });
        // Its corners are where the form put them: the noise cannot have moved or spent them.
        const reach = (m: BakedModel): number => Math.max(...m.poly.positions.map((p) => Math.min(Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2]))));
        expect(reach(before)).toBeGreaterThan(0.9);
        expect(reach(before)).toBeLessThanOrEqual(1.001);
        expect(before.report.steps.at(-1)!.trianglesBefore).toBeLessThan(after.report.steps.at(-1)!.trianglesBefore!);
    }, 60000);

    it('`from` with a bake carries what the step before it made onto what it left', () => {
        const m = bakeModel({ version: 1, normalBake: { size: 128 }, steps: [{ ...ball, id: 'form' }, { op: 'displace', pattern: 'bumps', amplitude: 0.04, scale: 0.2, octaves: 2, detail: 0.03 }, { op: 'decimate', from: 'form', triangles: 300, error: 0.5 }] });
        const map = bakeNormalMap(m);
        expect(map.report.from).toBeGreaterThan(map.report.to * 10);
        expect(map.report.meanBend).toBeGreaterThan(3);
        expect(map.report.missed).toBeLessThan(0.05);
    }, 60000);

    it('`from` must name an earlier step', () => {
        expect(() => validateModelSource({ steps: [ball, { op: 'decimate', from: 'nope', ratio: 0.5 }] })).toThrow(/no earlier step's id/);
        expect(() => validateModelSource({ steps: [{ op: 'decimate', from: 'later', ratio: 0.5 }, { ...ball, id: 'later' }] })).toThrow(/no earlier step's id/);
    });

    it('refuses what cannot be meant', () => {
        expect(() => model(ball, { op: 'decimate' })).toThrow(/one of `ratio` and `triangles`/);
        expect(() => model(ball, { op: 'decimate', ratio: 0.5, triangles: 10 })).toThrow(/one of `ratio` and `triangles`/);
        expect(() => model(ball, { op: 'decimate', ratio: 2 })).toThrow(/must be in \(0, 1\]/);
        expect(() => model(ball, { op: 'decimate', faces: 'nothing', ratio: 0.5 })).toThrow(/matched no face/);
    });
});

describe('normalBake', () => {
    const bakeOf = (extra: Record<string, unknown>, steps: ModelStep[]) => {
        const m = bakeModel({ version: 1, ...extra, steps });
        return { m, map: bakeNormalMap(m) };
    };

    it('brings a round surface back on a coarse one: at the middle of each triangle the map says the true normal', () => {
        const { m, map } = bakeOf({ normalBake: { size: 256 } }, [ball, { op: 'decimate', triangles: 300, error: 0.2 }]);
        expect(map.report.missed).toBe(0);
        expect(map.report.from).toBeGreaterThan(5000);
        expect(map.report.to).toBeLessThanOrEqual(300);
        const off: number[] = [];
        for (let t = 0; t < m.data.indices.length / 3; t++) {
            const { normal, at } = shadedNormal(m, map.rgba, map.size, t, MIDDLE);
            const l = Math.hypot(at[0]!, at[1]!, at[2]!);
            off.push(degrees(normal, at.map((x) => x / l)));
        }
        expect(Math.max(...off)).toBeLessThan(6);
    });

    it('carries a slope in the direction it runs: red and green are not swapped or flipped', () => {
        // A tilted square is the detail; a flat one under it is the mesh. Tilt toward +x, then toward +z.
        for (const [rotate, want] of [[[0, 0, -20], [Math.sin(20 * Math.PI / 180), Math.cos(20 * Math.PI / 180), 0]], [[20, 0, 0], [0, Math.cos(20 * Math.PI / 180), Math.sin(20 * Math.PI / 180)]]] as const) {
            const { m, map } = bakeOf({ normalBake: { size: 128, from: 'tilted', distance: 2 } }, [
                { op: 'plane', size: 4 }, { id: 'tilted', op: 'transform', rotate: rotate as unknown as number[] },
                { op: 'delete', faces: 'all' }, { op: 'plane', size: 1 },
            ]);
            for (let t = 0; t < m.data.indices.length / 3; t++) expect(degrees(shadedNormal(m, map.rgba, map.size, t, MIDDLE).normal, want)).toBeLessThan(3);
        }
    });

    it('reads a texel where its v says: the map is not upside down', () => {
        // Only the side at -z is tilted. A row counted from the wrong end would read the other side's texels.
        const { m, map } = bakeOf({ smoothAngle: 0, normalBake: { size: 128, from: 'bent', distance: 2 } }, [
            { op: 'plane', size: 4 }, { op: 'slice', axis: 'z', at: 0 },
            { id: 'bent', op: 'transform', faces: { within: { max: [null, null, 0] } }, rotate: [-25, 0, 0], pivot: [0, 0, 0] },
            { op: 'delete', faces: 'all' }, { op: 'plane', size: 3 },
        ]);
        const seen = { flat: 0, bent: 0 };
        // Near each corner of each triangle, well away from the crease at z 0.
        for (let t = 0; t < m.data.indices.length / 3; t++) {
            for (const w of [[0.9, 0.05, 0.05], [0.05, 0.9, 0.05], [0.05, 0.05, 0.9]] as const) {
                const { normal, at } = shadedNormal(m, map.rgba, map.size, t, w);
                if (Math.abs(at[2]!) < 0.5) continue;
                const lean = degrees(normal, [0, 1, 0]);
                if (at[2]! > 0) { expect(lean).toBeLessThan(3); seen.flat++; } else { expect(lean).toBeGreaterThan(15); seen.bent++; }
            }
        }
        expect(seen.flat).toBeGreaterThan(0);
        expect(seen.bent).toBeGreaterThan(0);
    });

    it('gives the mesh texels of its own and a frame, on a rigged and shaped mesh too', () => {
        const { m, map } = bakeOf({
            normalBake: { size: 128 },
            rig: { joints: [{ name: 'root', at: [0, -1, 0] }, { name: 'top', at: [0, 1, 0], parent: 'root' }] },
            shapes: [{ name: 'puff', moves: [{ near: { at: [0, 1, 0], radius: 0.5 }, translate: [0, 0.2, 0] }] }],
        }, [ball, { op: 'decimate', ratio: 0.1, error: 0.05 }]);
        for (const semantic of [MeshChannel.Tangent, MeshChannel.Joints, MeshChannel.Weights]) expect(m.data.channels.some((c) => c.semantic === semantic)).toBe(true);
        expect(m.data.morph!.deltas.length).toBe(m.data.vertexCount * 6);
        const uv = channel(m, MeshChannel.TexCoord0, 2);
        for (const x of uv) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(1); }
        expect(map.report.coverage).toBeGreaterThan(0.2);
    });

    it('fills past the charts\' edges, so a bilinear read never meets the empty colour next to one', () => {
        const { map } = bakeOf({ normalBake: { size: 256 } }, [ball, { op: 'decimate', triangles: 300, error: 0.2 }]);
        let filled = 0;
        for (let i = 0; i < 256 * 256; i++) if (map.rgba[i * 4] !== 128 || map.rgba[i * 4 + 1] !== 128) filled++;
        expect(filled / (256 * 256)).toBeGreaterThan(map.report.coverage);
    });

    it('warns when the map found nothing, and when there was nothing to find', () => {
        const far = bakeOf({ normalBake: { size: 64, from: 'away', distance: 0.1 } }, [
            { op: 'plane', size: 4, at: [0, 5, 0] }, { id: 'away', op: 'transform', scale: 1 }, { op: 'delete', faces: 'all' }, { op: 'plane', size: 1 },
        ]);
        expect(far.map.report.missed).toBe(1);
        expect(far.map.warnings.join()).toMatch(/found no surface/);
        const same = bakeOf({ normalBake: { size: 64, from: 'same' } }, [{ id: 'same', op: 'box', size: 1 }]);
        expect(same.map.warnings.join()).toMatch(/no detail to carry/);
    });

    it('refuses a bake with nothing to read from, a size no texture has, and a step that is not there', () => {
        expect(() => validateModelSource({ steps: [ball], normalBake: {} })).toThrow(/a decimate step, or `from`/);
        expect(() => validateModelSource({ steps: [{ op: 'decimate', ratio: 0.5 }], normalBake: {} })).toThrow(/first step/);
        expect(() => validateModelSource({ steps: [ball, { op: 'decimate', ratio: 0.5 }], normalBake: { size: 1000 } })).toThrow(/power of two/);
        expect(() => validateModelSource({ steps: [ball], normalBake: { from: 'nope' } })).toThrow(/no step's id/);
        expect(() => validateModelSource({ steps: [ball, { op: 'decimate', ratio: 0.5 }], normalBake: { sizes: 64 } })).toThrow(/unknown field "sizes"/);
    });

    it('a model without one is drawn as it always was: no frame, and the box UVs', () => {
        const m = model(ball);
        expect(m.detail).toBeUndefined();
        expect(m.data.channels.some((c) => c.semantic === MeshChannel.Tangent)).toBe(false);
        expect(() => bakeNormalMap(m)).toThrow(/no normalBake/);
    });

    it('an edit can add it and take it away', () => {
        const source = validateModelSource({ steps: [ball, { op: 'decimate', ratio: 0.5 }] });
        const baked = applyModelEdits(source, [{ op: 'settings', fields: { normalBake: { size: 64 } } }]);
        expect(baked.normalBake).toEqual({ size: 64 });
        const off = applyModelEdits(baked, [{ op: 'settings', fields: { normalBake: null as never } }]);
        expect(off.normalBake).toBeUndefined();
    });
});
