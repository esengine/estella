// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The modeling kernel, held to what geometry can prove: a surface that closes, faces
 * that point out, and volumes that match the sums. A count of faces passes a bevel
 * that is inside out, so the counts here are never the only thing asked.
 */
import { describe, expect, it } from 'vitest';
import { decodeMesh, encodeMesh, MeshChannel } from 'esengine';
import {
    applyModelEdits, bakeModel, describeModelOps, UNOFFERED_OPS, MODEL_OPS, ModelBuildError, renderModelSheet, validateModelSource,
    type BakedModel, type ModelStep,
} from '../src/modeling';

const model = (...steps: ModelStep[]): BakedModel => bakeModel({ version: 1, steps });

/** Divergence theorem over the triangles: the volume enclosed, positive when the faces point out. */
function volume(m: BakedModel): number {
    let v = 0;
    for (const { v: [a, b, c] } of m.triangles) {
        const [p, q, r] = [m.poly.positions[a]!, m.poly.positions[b]!, m.poly.positions[c]!];
        v += p[0] * (q[1] * r[2] - q[2] * r[1]) + p[1] * (q[2] * r[0] - q[0] * r[2]) + p[2] * (q[0] * r[1] - q[1] * r[0]);
    }
    return v / 6;
}

function expectSound(m: BakedModel): void {
    expect(m.report.openEdges).toBe(0);
    expect(m.report.nonManifoldEdges).toBe(0);
    expect(m.report.insideOutShells).toBe(0);
    expect(m.report.degenerateFaces).toBe(0);
    expect(m.report.warnings).toEqual([]);
}

const cube: ModelStep = { op: 'box', size: 1, tag: 'body' };

describe('primitives', () => {
    it.each<[string, ModelStep, number, number]>([
        ['box', { op: 'box', size: [1, 2, 3] }, 6, 0.0001],
        ['cylinder', { op: 'cylinder', radius: 1, height: 2, sides: 64 }, 2 * Math.PI, 0.02],
        ['tapered', { op: 'cylinder', radius: 1, radiusTop: 0.5, height: 3, sides: 64 }, (Math.PI * 3 * (1 + 0.5 + 0.25)) / 3, 0.02],
        ['cone', { op: 'cone', radius: 1, height: 3, sides: 64 }, Math.PI, 0.02],
        ['sphere', { op: 'sphere', radius: 1, rings: 32, sides: 64 }, (4 / 3) * Math.PI, 0.03],
        ['prism', { op: 'prism', points: [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]], height: 1 }, 3, 0.0001],
    ])('%s closes, faces out and holds the right volume', (_, step, expected, tolerance) => {
        const m = model(step);
        expectSound(m);
        expect(Math.abs(volume(m) - expected)).toBeLessThan(tolerance);
    });

    it('a prism walked the other way round is the same solid', () => {
        const m = model({ op: 'prism', points: [[0, 2], [1, 2], [1, 1], [2, 1], [2, 0], [0, 0]], height: 1 });
        expectSound(m);
        expect(volume(m)).toBeCloseTo(3, 5);
    });

    it('`at` moves the shell and a second primitive adds one', () => {
        const m = model({ op: 'box', size: 2, at: [0, 1, 0] }, { op: 'box', size: 1, at: [5, 0, 0] });
        expect(m.report.shells).toBe(2);
        expect(m.report.bounds.max).toEqual([5.5, 2, 1]);
        expect(m.report.bounds.min).toEqual([-1, -0.5, -1]);
        expect(volume(m)).toBeCloseTo(9, 5);
    });
});

describe('selection', () => {
    it('finds faces by axis, tag, box and extreme, and ANDs the keys', () => {
        const painted = (faces: unknown): number => {
            const m = model(cube, { op: 'box', size: 1, at: [3, 0, 0], tag: 'other' }, { op: 'paint', faces, color: [1, 0, 0] } as ModelStep);
            return m.poly.faces.filter((f) => f.color).length;
        };
        expect(painted('+y')).toBe(2);
        expect(painted('other')).toBe(6);
        expect(painted({ tag: 'other', facing: '+y' })).toBe(1);
        expect(painted({ facing: '+y', within: { max: [1, null, null] } })).toBe(1);
        expect(painted({ extreme: '+x' })).toBe(1);
        expect(painted({ any: ['+y', '-y'] })).toBe(4);
        expect(painted({ tag: 'body', not: '+y' })).toBe(5);
    });

    it('a selector matching nothing stops the build and lists the tags there are', () => {
        expect(() => model(cube, { op: 'extrude', faces: 'roof', distance: 1 })).toThrow(/step 1 \(extrude\).*matched no face.*body/);
    });
});

describe('extrude and inset', () => {
    it('pushing the top up grows the box by exactly the prism it adds', () => {
        const m = model(cube, { op: 'extrude', faces: '+y', distance: 2 });
        expectSound(m);
        expect(volume(m)).toBeCloseTo(3, 6);
        expect(m.report.bounds.max[1]).toBeCloseTo(2.5, 6);
    });

    it('a negative distance recesses, and still closes', () => {
        const m = model(cube, { op: 'extrude', faces: '+y', distance: -0.25 });
        expectSound(m);
        expect(volume(m)).toBeCloseTo(0.75, 6);
    });

    it('an inset then recess cuts a window-shaped pocket out of a wall', () => {
        const m = model(cube, { op: 'inset', faces: '+z', amount: 0.25, tag: 'window' }, { op: 'extrude', faces: 'window', distance: -0.1 });
        expectSound(m);
        expect(volume(m)).toBeCloseTo(1 - 0.5 * 0.5 * 0.1, 6);
    });

    it('walls take the tag of the face they came from, unless sideTag names them apart', () => {
        const same = model(cube, { op: 'inset', faces: '+z', amount: 0.25, tag: 'window' }, { op: 'extrude', faces: 'window', distance: -0.1 });
        expect(same.report.tags.window).toBe(5);
        const apart = model(cube, { op: 'inset', faces: '+z', amount: 0.25, tag: 'window' }, { op: 'extrude', faces: 'window', distance: -0.1, sideTag: 'reveal' });
        expect(apart.report.tags).toMatchObject({ window: 1, reveal: 4 });
    });

    it('two adjacent faces extrude as a run with no wall between, individually with their own', () => {
        const run = model(cube, { op: 'slice', axis: 'x', at: 0 }, { op: 'extrude', faces: '+y', distance: 1 });
        expectSound(run);
        expect(volume(run)).toBeCloseTo(2, 6);
        const apart = model(cube, { op: 'slice', axis: 'x', at: 0 }, { op: 'extrude', faces: '+y', distance: 1, individual: true });
        expect(volume(apart)).toBeCloseTo(2, 6);
        expect(apart.report.faces).toBe(run.report.faces + 2);
    });

    it('refuses an inset wider than the face rather than turning it inside out', () => {
        expect(() => model(cube, { op: 'inset', faces: '+z', amount: 0.6 })).toThrow(/amount 0\.6 .*collapses/);
    });
});

describe('slice', () => {
    it('cuts a face into two without changing the solid, and neighbours take the new vertices', () => {
        const m = model(cube, { op: 'slice', faces: '+z', axis: 'x', at: [-0.2, 0.2] });
        expectSound(m);
        expect(volume(m)).toBeCloseTo(1, 6);
        expect(m.report.faces).toBe(8);
    });

    it('lets a window be placed off-centre: seams, then recess the piece between them', () => {
        const m = model(
            { op: 'box', size: [4, 3, 1], at: [0, 1.5, 0], tag: 'wall' },
            { op: 'slice', faces: '+z', axis: 'x', at: [0.5, 1.5] },
            { op: 'slice', faces: '+z', axis: 'y', at: [1, 2] },
            { op: 'tag', faces: { facing: '+z', within: { min: [0.5, 1, null], max: [1.5, 2, null] } }, tag: 'window' },
            { op: 'extrude', faces: 'window', distance: -0.2, sideTag: 'reveal' },
        );
        expectSound(m);
        expect(m.report.tags).toMatchObject({ window: 1, reveal: 4 });
        expect(volume(m)).toBeCloseTo(12 - 0.2, 6);
    });

    it('says so when a plane misses, with the range the mesh does span', () => {
        expect(() => model(cube, { op: 'slice', axis: 'x', at: 9 })).toThrow(/no chosen face crosses x = 9.*-0\.5,0\.5/);
    });
});

describe('array, mirror, weld', () => {
    it('array counts the original and copies its tags', () => {
        const m = model({ op: 'box', size: 1, tag: 'col' }, { op: 'array', faces: 'col', count: 4, offset: [2, 0, 0] });
        expectSound(m);
        expect(m.report.shells).toBe(4);
        expect(volume(m)).toBeCloseTo(4, 6);
        expect(m.report.bounds.max[0]).toBeCloseTo(6.5, 6);
    });

    it('a rotated array makes a ring around its pivot', () => {
        const m = model({ op: 'box', size: 1, at: [5, 0, 0] }, { op: 'array', count: 4, rotate: [0, 90, 0], pivot: [0, 0, 0] });
        expectSound(m);
        expect(m.report.bounds.max[2]).toBeCloseTo(5.5, 5);
        expect(m.report.bounds.min[0]).toBeCloseTo(-5.5, 5);
    });

    it('a mirrored copy points outward, not inward', () => {
        const m = model({ op: 'box', size: 1, at: [2, 0, 0] }, { op: 'mirror', axis: 'x' });
        expectSound(m);
        expect(volume(m)).toBeCloseTo(2, 6);
        expect(m.report.bounds.min[0]).toBeCloseTo(-2.5, 6);
    });

    it('welding a half to its mirror leaves one closed solid with no wall inside', () => {
        const m = model({ op: 'box', size: [1, 1, 1], at: [0.5, 0, 0] }, { op: 'mirror', axis: 'x' }, { op: 'weld' });
        expectSound(m);
        expect(m.report.shells).toBe(1);
        expect(m.report.faces).toBe(10);
        expect(volume(m)).toBeCloseTo(2, 6);
    });

    it('delete leaves a hole the report names', () => {
        const m = model(cube, { op: 'delete', faces: '+y' });
        expect(m.report.openEdges).toBe(4);
        expect(m.report.warnings.join()).toMatch(/4 open edges/);
    });
});

describe('transform', () => {
    it('scaling the top in makes a frustum of the box under it', () => {
        const m = model(cube, { op: 'transform', faces: '+y', scale: [0.5, 1, 0.5] });
        expectSound(m);
        expect(volume(m)).toBeCloseTo((1 + 0.25 + 0.5) / 3, 6);
    });

    it('rotates about the selection centre by default', () => {
        const m = model({ op: 'box', size: [2, 1, 1], at: [5, 0, 0] }, { op: 'transform', rotate: [0, 90, 0] });
        expect(m.report.bounds.size[0]).toBeCloseTo(1, 5);
        expect(m.report.bounds.center[0]).toBeCloseTo(5, 5);
    });

    it('refuses a negative scale: that is what mirror is for', () => {
        expect(() => model(cube, { op: 'transform', scale: [-1, 1, 1] })).toThrow(/mirror/);
    });
});

describe('bevel', () => {
    it('one edge of a cube: cuts off exactly the triangular prism under it', () => {
        const w = 0.2;
        const m = model(cube, { op: 'bevel', edges: { between: ['+y', '+z'] }, width: w });
        expectSound(m);
        expect(m.report.faces).toBe(7);
        expect(volume(m)).toBeCloseTo(1 - (w * w) / 2, 6);
    });

    it('a rim: the four top edges mitre at the corners and close', () => {
        const w = 0.1;
        const m = model(cube, { op: 'bevel', edges: { of: '+y' }, width: w });
        expectSound(m);
        expect(m.report.faces).toBe(10);
        // The solid is the cube under the plane through each chamfer; integrate the height over the top.
        const n = 400;
        let sum = 0;
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                const dx = 0.5 - Math.abs((i + 0.5) / n - 0.5);
                const dz = 0.5 - Math.abs((j + 0.5) / n - 0.5);
                sum += 1 - Math.max(0, w - Math.min(dx, dz));
            }
        }
        expect(Math.abs(volume(m) - sum / (n * n))).toBeLessThan(1e-3);
    });

    it('every edge of a cube: three meet at each corner and a small triangle closes it', () => {
        const w = 0.1;
        const m = model(cube, { op: 'bevel', edges: 'all', width: w });
        expectSound(m);
        expect(m.report.faces).toBe(6 + 12 + 8);
        // Against the planes that define that shape, integrated on a grid.
        const n = 96;
        let inside = 0;
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                for (let k = 0; k < n; k++) {
                    const x = Math.abs((i + 0.5) / n - 0.5), y = Math.abs((j + 0.5) / n - 0.5), z = Math.abs((k + 0.5) / n - 0.5);
                    if (x + y <= 1 - w && y + z <= 1 - w && x + z <= 1 - w && x + y + z <= 1.5 - 2 * w) inside++;
                }
            }
        }
        expect(Math.abs(volume(m) - inside / n ** 3)).toBeLessThan(0.003);
    });

    it('two edges meeting at a corner mitre with no cap, and remove what the two chamfers remove', () => {
        const w = 0.2;
        const m = model(cube, { op: 'bevel', edges: { between: ['+y', { any: ['+z', '+x'] }] }, width: w });
        expectSound(m);
        expect(m.report.faces).toBe(8);
        const n = 400;
        let sum = 0;
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                sum += 1 - Math.max(0, w - Math.min(1 - (i + 0.5) / n, 1 - (j + 0.5) / n));
            }
        }
        expect(Math.abs(volume(m) - sum / (n * n))).toBeLessThan(1e-3);
    });

    it('a seam across a flat face is not an edge to bevel', () => {
        const m = model(cube, { op: 'slice', axis: 'x', at: 0 }, { op: 'bevel', edges: { of: '+y' }, width: 0.1 });
        expectSound(m);
        // Ten faces once sliced, and a strip along each of the rim's six runs: none along the seam.
        expect(m.report.faces).toBe(10 + 6);
    });

    it('holds on a concave corner', () => {
        const m = model(
            { op: 'prism', points: [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]], height: 1 },
            { op: 'bevel', edges: { of: '+y' }, width: 0.1 },
        );
        expectSound(m);
        expect(volume(m)).toBeLessThan(3);
        expect(volume(m)).toBeGreaterThan(2.9);
    });

    it('refuses a width the edge cannot hold', () => {
        expect(() => model(cube, { op: 'bevel', edges: 'all', width: 0.6 })).toThrow(/overruns the edge 1 long/);
    });

    it('names an edge choice that found nothing', () => {
        expect(() => model(cube, { op: 'slice', axis: 'x', at: 0 }, { op: 'bevel', edges: { of: '+y', along: 'y' }, width: 0.1 })).toThrow(/matched no edge/);
    });
});

describe('the source format', () => {
    it('refuses a misspelt field, listing the ones the op takes', () => {
        expect(() => validateModelSource({ version: 1, steps: [{ op: 'box', size: 1, widht: 2 }] })).toThrow(/step 0 \(box\): unknown field "widht"; box takes size, at, tag, color/);
    });

    it('refuses an unknown op, listing them', () => {
        expect(() => validateModelSource({ steps: [{ op: 'chisel' }] })).toThrow(/unknown op "chisel"; there are box/);
    });

    it('refuses a missing required field and a wrong type', () => {
        expect(() => validateModelSource({ steps: [{ op: 'box' }] })).toThrow(/size is required/);
        expect(() => validateModelSource({ steps: [{ op: 'box', size: 'big' }] })).toThrow(/size must be a number or \[x, y, z\]/);
        expect(() => validateModelSource({ steps: [{ op: 'extrude', faces: { facng: '+y' }, distance: 1 }] })).toThrow(/unknown key "facng"/);
    });

    it('refuses a duplicate id', () => {
        expect(() => validateModelSource({ steps: [{ id: 'a', op: 'box', size: 1 }, { id: 'a', op: 'box', size: 1 }] })).toThrow(/already used/);
    });

    it('a failure names the step it happened in', () => {
        try {
            model({ id: 'body', op: 'box', size: 1 }, { id: 'lip', op: 'bevel', edges: 'all', width: 9 });
            expect.unreachable();
        } catch (e) {
            expect(e).toBeInstanceOf(ModelBuildError);
            expect(e).toMatchObject({ stepIndex: 1, stepId: 'lip', op: 'bevel' });
        }
    });

    it('a model with no faces is refused, not baked to nothing', () => {
        expect(() => model()).toThrow(/no faces/);
    });

    it('every op is described, so the tool cannot offer one it does not explain', () => {
        const text = describeModelOps();
        for (const name of Object.keys(MODEL_OPS)) {
            // A ready body is not offered, as a model handed one copies it; it still runs for what uses it.
            if (UNOFFERED_OPS.has(name)) expect(text).not.toContain(`${name}(`);
            else expect(text).toContain(`${name}(`);
        }
    });
});

describe('edits', () => {
    const source = { version: 1, steps: [{ id: 'body', op: 'box', size: 1 }, { id: 'up', op: 'extrude', faces: '+y', distance: 1 }] };

    it('changes one number and everything below follows', () => {
        const next = applyModelEdits(validateModelSource(source), [{ op: 'set', step: 'up', fields: { distance: 3 } }]);
        expect(volume(bakeModel(next))).toBeCloseTo(4, 6);
    });

    it('inserts, removes, and clears a field with null', () => {
        const next = applyModelEdits(validateModelSource(source), [
            { op: 'insert', after: 'body', step: { id: 'b', op: 'bevel', edges: { of: '-y' }, width: 0.1 } },
            { op: 'set', step: 'b', fields: { tag: 'lip' } },
            { op: 'set', step: 'b', fields: { tag: null } },
            { op: 'remove', step: 'up' },
        ]);
        expect(next.steps.map((s) => s.id)).toEqual(['body', 'b']);
        expect(next.steps[1]).not.toHaveProperty('tag');
    });

    it('refuses an edit that breaks the source, and leaves the original alone', () => {
        const parsed = validateModelSource(source);
        expect(() => applyModelEdits(parsed, [{ op: 'set', step: 'up', fields: { distnce: 3 } }])).toThrow(/unknown field "distnce"/);
        expect(() => applyModelEdits(parsed, [{ op: 'remove', step: 'nope' }])).toThrow(/no step "nope".*body, up/);
        expect(parsed.steps[1]!.distance).toBe(1);
    });
});

describe('winding', () => {
    it('the report names faces wound against their neighbours, which a volume alone can miss', () => {
        const m = model(cube);
        expect(m.report.flippedEdges).toBe(0);
        const every = [
            model(cube, { op: 'bevel', edges: 'all', width: 0.1 }),
            model(cube, { op: 'inset', faces: '+z', amount: 0.2 }, { op: 'extrude', faces: '+z', distance: 0.1 }),
            model({ op: 'box', size: 1, at: [2, 0, 0] }, { op: 'mirror', axis: 'x' }),
            model({ op: 'box', size: 1, at: [0.5, 0, 0] }, { op: 'mirror', axis: 'x' }, { op: 'weld' }),
            model({ op: 'cylinder', radius: 1, height: 1 }, { op: 'cone', radius: 1, height: 1, at: [3, 0, 0] }, { op: 'sphere', radius: 1, at: [6, 0, 0] }),
            model({ op: 'prism', points: [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]], height: 1 }),
        ];
        for (const each of every) expect(each.report.flippedEdges).toBe(0);
    });
});

describe('the bake', () => {
    const channel = (m: BakedModel, semantic: number) => m.data.channels.find((c) => c.semantic === semantic);

    it('survives the file format with the channels the renderer and a bake read', () => {
        const m = model(cube);
        const back = decodeMesh(encodeMesh(m.data));
        expect(back.vertexCount).toBe(m.data.vertexCount);
        expect([...back.indices]).toEqual([...m.data.indices]);
        expect(back.aabbMin).toEqual([-0.5, -0.5, -0.5]);
        for (const s of [MeshChannel.Position, MeshChannel.Normal, MeshChannel.TexCoord0, MeshChannel.Color, MeshChannel.TexCoord1]) {
            expect(channel(m, s), `channel ${s}`).toBeDefined();
        }
    });

    const normalsOf = (m: BakedModel): number[][] => {
        const at = channel(m, MeshChannel.Normal)!.offset;
        const view = new DataView(m.data.vertices.buffer);
        return Array.from({ length: m.data.vertexCount }, (_, i) =>
            [0, 1, 2].map((k) => view.getFloat32(i * m.data.vertexStride + at + k * 4, true)));
    };

    it('keeps a box hard-edged: three normals at each corner', () => {
        const unique = new Set(normalsOf(model(cube)).map((n) => n.map((x) => x.toFixed(3)).join()));
        expect(unique.size).toBe(6);
    });

    it('smooths a cylinder round its side but keeps the rim hard', () => {
        const normals = normalsOf(model({ op: 'cylinder', radius: 1, height: 1, sides: 24 }));
        // Side normals are level; they would lean if the caps were averaged in.
        const leaning = normals.filter((n) => Math.abs(n[1]!) > 0.01 && Math.abs(n[1]!) < 0.99);
        expect(leaning).toEqual([]);
        expect(new Set(normals.map((n) => n.map((x) => x.toFixed(3)).join())).size).toBeGreaterThan(24);
    });

    it('smoothAngle 0 draws every face flat', () => {
        const flat = bakeModel({ version: 1, smoothAngle: 0, steps: [{ op: 'sphere', radius: 1, rings: 6, sides: 8 }] });
        const smooth = bakeModel({ version: 1, smoothAngle: 89, steps: [{ op: 'sphere', radius: 1, rings: 6, sides: 8 }] });
        expect(flat.data.vertexCount).toBeGreaterThan(smooth.data.vertexCount);
    });

    it('paints into the colour channel', () => {
        const m = model(cube, { op: 'paint', faces: '+y', color: [1, 0, 0] });
        const at = channel(m, MeshChannel.Color)!.offset;
        const colours = new Set(Array.from({ length: m.data.vertexCount }, (_, i) =>
            [...m.data.vertices.subarray(i * m.data.vertexStride + at, i * m.data.vertexStride + at + 4)].join()));
        expect(colours).toEqual(new Set(['255,0,0,255', '255,255,255,255']));
    });

    it('a colour on a primitive reaches the channel whole, with its alpha filled in', () => {
        const m = model({ op: 'box', size: 1, color: [0, 1, 0] });
        const at = channel(m, MeshChannel.Color)!.offset;
        expect([...m.data.vertices.subarray(at, at + 4)]).toEqual([0, 255, 0, 255]);
        expect(() => model({ op: 'box', size: 1, color: [2, 0, 0] })).toThrow(/each 0\.\.1/);
    });

    it('triangulates a concave face without spilling outside it: the area is the plan', () => {
        const m = model({ op: 'prism', points: [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]], height: 1 });
        const top = m.triangles.filter((t) => m.poly.faces[t.face]!.v.length === 6);
        const area = (t: { v: readonly number[] }): number => {
            const [p, q, r] = [m.poly.positions[t.v[0]!]!, m.poly.positions[t.v[1]!]!, m.poly.positions[t.v[2]!]!];
            return Math.abs((q[0] - p[0]) * (r[2] - p[2]) - (r[0] - p[0]) * (q[2] - p[2])) / 2;
        };
        expect(top.reduce((n, t) => n + area(t), 0)).toBeCloseTo(6, 5); // two caps of 3
    });

    it('reports an inside-out shell: a whole cube pushed in past its own middle', () => {
        const m = model(cube, { op: 'extrude', faces: 'all', distance: -2 });
        expect(volume(m)).toBeLessThan(0);
        expect(m.report.insideOutShells).toBe(1);
        expect(m.report.warnings.join()).toMatch(/inside out/);
    });
});

describe('the contact sheet', () => {
    const pixel = (s: ReturnType<typeof renderModelSheet>, x: number, y: number): number[] =>
        [...s.rgba.subarray((y * s.width + x) * 4, (y * s.width + x) * 4 + 3)];
    /** Pixels of the bottom-row silhouette of one column, by row. */
    function silhouetteRows(s: ReturnType<typeof renderModelSheet>, column: number, panel: number): number[] {
        const rows: number[] = [];
        for (let y = 0; y < panel; y++) {
            let n = 0;
            for (let x = 0; x < panel; x++) {
                if (pixel(s, column * (panel + 1) + x, panel + 1 + y)[0]! < 60) n++;
            }
            rows.push(n);
        }
        return rows;
    }

    it('is one column per view over two rows', () => {
        const s = renderModelSheet(model(cube), ['front', 'iso'], 64);
        expect(s.width).toBe(64 * 2 + 1);
        expect(s.height).toBe(64 * 2 + 1);
        expect(s.rgba.length).toBe(s.width * s.height * 4);
    });

    it('draws a silhouette of the size the mesh is, at one scale in every panel', () => {
        const panel = 200;
        const s = renderModelSheet(model({ op: 'box', size: [4, 2, 1] }), ['front', 'right', 'top'], panel);
        const areaOf = (c: number): number => silhouetteRows(s, c, panel).reduce((a, b) => a + b, 0) * s.unitsPerPixel ** 2;
        expect(areaOf(0)).toBeCloseTo(8, 0); // 4 x 2
        expect(areaOf(1)).toBeCloseTo(2, 0); // 1 x 2
        expect(areaOf(2)).toBeCloseTo(4, 0); // 4 x 1
    });

    it('has up the right way: a cone is narrow at the top of the picture', () => {
        const panel = 128;
        const s = renderModelSheet(model({ op: 'cone', radius: 1, height: 3 }), ['front'], panel);
        const rows = silhouetteRows(s, 0, panel).filter((n) => n > 0);
        expect(rows[0]!).toBeLessThan(rows[rows.length - 1]! / 4);
    });

    it('has right the right way: a block on +x is on the right from the front and the left from behind', () => {
        const panel = 128;
        const m = model({ op: 'box', size: 1, at: [3, 0, 0] }, { op: 'box', size: 0.2 });
        const s = renderModelSheet(m, ['front', 'back'], panel);
        const inHalf = (column: number, right: boolean): number => {
            let n = 0;
            for (let y = 0; y < panel; y++) {
                for (let x = 0; x < panel; x++) {
                    if ((x >= panel / 2) === right && pixel(s, column * (panel + 1) + x, panel + 1 + y)[0]! < 60) n++;
                }
            }
            return n;
        };
        expect(inHalf(0, true)).toBeGreaterThan(inHalf(0, false));
        expect(inHalf(1, false)).toBeGreaterThan(inHalf(1, true));
    });

    it('shows paint, and a nearer face hides a further one', () => {
        const panel = 64;
        const m = model(cube, { op: 'paint', faces: '+z', color: [1, 0, 0] }, { op: 'paint', faces: '-z', color: [0, 1, 0] });
        const s = renderModelSheet(m, ['front'], panel);
        const [r, g, b] = pixel(s, Math.floor(panel / 2) + 3, Math.floor(panel / 2) + 3) as [number, number, number];
        expect(r).toBeGreaterThan(g + 50);
        expect(g).toBe(b);
    });

    it('refuses a view it does not have', () => {
        expect(() => renderModelSheet(model(cube), ['side' as never])).toThrow(/unknown view "side"/);
    });
});
