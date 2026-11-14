// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** Cards of hair, the textures they are cut from, the bones that swing them, and holes in a surface. */
import { describe, expect, it } from 'vitest';
import { MeshChannel } from 'esengine';
import { bakeModel, bakeNormalMap, modelMaterialDoc, validateModelSource, type BakedModel, type ModelStep } from '../src/modeling';
import { hairMaps } from '../src/modeling/hair';
import { prefabOf, resolveJoints } from '../src/modeling/rig';

const head: ModelStep = { op: 'sphere', radius: 1, rings: 24, sides: 48, tag: 'head' };
const scalp = { within: { min: [null, 0.2, null] } };
const hair = (extra: Record<string, unknown> = {}): BakedModel => bakeModel({ version: 1, steps: [head, { op: 'hair', faces: scalp, count: 60, length: 1.4, ...extra }] });

describe('hair', () => {
    it('gives each card a ribbon of quads, and drops what they grew from', () => {
        const m = hair({ segments: 5 });
        expect(m.poly.faces).toHaveLength(60 * 5);
        expect(m.poly.positions).toHaveLength(60 * 6 * 2);
        for (const f of m.poly.faces) { expect(f.card).toBeGreaterThanOrEqual(0); expect(f.v).toHaveLength(4); }
        expect(m.report.tags).toEqual({ hair: 300 });
    });

    it('adds a layer each time, the second falling over the first, and keeps only cards in the end', () => {
        const one = hair({ segments: 4 });
        const two = bakeModel({ version: 1, steps: [head, { op: 'hair', faces: scalp, count: 60, length: 1.4, segments: 4 }, { op: 'hair', faces: scalp, count: 40, length: 0.7, segments: 4, seed: 2 }] });
        expect(one.poly.faces).toHaveLength(240);
        expect(two.poly.faces).toHaveLength(400);
        expect(new Set(two.poly.faces.map((f) => f.card)).size).toBe(100);
        expect(two.report.tags).toEqual({ hair: 400 });
        expect(two.report.warnings).toEqual([]);
    });

    it('starts on the scalp and stays out of the head: no vertex goes far inside it', () => {
        const m = hair({ count: 150, droop: 1 });
        let inside = 0;
        for (const p of m.poly.positions) if (Math.hypot(p[0], p[1], p[2]) < 0.93) inside++;
        expect(inside / m.poly.positions.length).toBeLessThan(0.01);
        // Roots: the first row of each card.
        const roots = m.poly.faces.filter((_, i) => i % 6 === 0).map((f) => m.poly.positions[f.v[0]!]!);
        for (const q of roots) { expect(Math.hypot(q[0], q[1], q[2])).toBeLessThan(1.15); expect(q[1]).toBeGreaterThan(0.15); }
    });

    it('`droop` decides how far it falls', () => {
        const lowest = (m: BakedModel): number => m.poly.positions.reduce((lo, p) => Math.min(lo, p[1]), Infinity);
        expect(lowest(hair({ droop: 1 }))).toBeLessThan(lowest(hair({ droop: 0.1 })) - 0.3);
    });

    it('`comb` sweeps it that way', () => {
        const meanZ = (m: BakedModel): number => m.poly.positions.reduce((sum, p) => sum + p[2], 0) / m.poly.positions.length;
        expect(meanZ(hair({ comb: [0, 0, -1] }))).toBeLessThan(meanZ(hair()) - 0.3);
    });

    it('`length` and `uneven` set how long a card is', () => {
        const longest = (m: BakedModel): number => {
            const cards = new Map<number, number>();
            for (const f of m.poly.faces) {
                const [a, b] = [m.poly.positions[f.v[0]!]!, m.poly.positions[f.v[1]!]!];
                cards.set(f.card!, (cards.get(f.card!) ?? 0) + Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
            }
            return Math.max(...cards.values());
        };
        expect(longest(hair({ length: 2, uneven: 0 }))).toBeGreaterThan(longest(hair({ length: 1, uneven: 0 })) * 1.8);
    });

    it('narrows to the tip, by `taper`', () => {
        const m = hair({ count: 1, segments: 4, taper: 0.8, width: 0.2 });
        const across = (i: number, j: number, face: number): number => {
            const v = m.poly.faces[face]!.v;
            const [a, b] = [m.poly.positions[v[i]!]!, m.poly.positions[v[j]!]!];
            return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        };
        expect(across(0, 3, 0)).toBeCloseTo(0.2, 3);
        expect(across(1, 2, 3)).toBeCloseTo(0.04, 3);
    });

    it('runs from `color` to `tipColor`', () => {
        const m = hair({ count: 1, segments: 4, color: [1, 0, 0], tipColor: [0, 0, 1] });
        expect(m.poly.faces[0]!.color![0]).toBeGreaterThan(0.8);
        expect(m.poly.faces[3]!.color![2]).toBeGreaterThan(0.8);
    });

    it('is the same every time, and a seed makes another', () => {
        expect(hair().poly.positions).toEqual(hair().poly.positions);
        expect(hair({ seed: 5 }).poly.positions).not.toEqual(hair().poly.positions);
    });

    it('lands each card inside one strip of the texture, root at its top row', () => {
        const m = hair();
        const { offset } = m.data.channels.find((c) => c.semantic === MeshChannel.TexCoord0)!;
        const view = new DataView(m.data.vertices.buffer, m.data.vertices.byteOffset, m.data.vertices.byteLength);
        for (let v = 0; v < m.data.vertexCount; v++) {
            const [a, b] = [view.getFloat32(v * m.data.vertexStride + offset, true), view.getFloat32(v * m.data.vertexStride + offset + 4, true)];
            expect(a).toBeGreaterThanOrEqual(0); expect(a).toBeLessThanOrEqual(1);
            expect(b).toBeGreaterThanOrEqual(0); expect(b).toBeLessThanOrEqual(1);
        }
        const face = m.poly.faces[0]!;
        const [u0, u1] = [face.cornerUvs![0]![0], face.cornerUvs![2]![0]];
        expect(Math.floor(u0 * 4)).toBe(Math.floor(u1 * 4));
    });

    it('carries a frame for the map it reads, and no lightmap layout', () => {
        const m = hair();
        expect(m.data.channels.some((c) => c.semantic === MeshChannel.Tangent)).toBe(true);
        expect(m.data.channels.some((c) => c.semantic === MeshChannel.TexCoord1)).toBe(false);
    });

    it('refuses what cannot be meant', () => {
        const steps = [head, { op: 'hair', faces: scalp, length: 1 }];
        expect(() => bakeModel({ version: 1, steps: [head, { op: 'hair', faces: 'nothing', length: 1 }] })).toThrow(/matched no face/);
        expect(() => bakeModel({ version: 1, steps: [head, { op: 'hair', faces: scalp, length: -1 }] })).toThrow(/length -1 must be positive/);
        expect(() => bakeModel({ version: 1, steps: [head, { op: 'hair', faces: scalp, length: 1, droop: 2 }] })).toThrow(/droop 2 must be 0..1/);
        expect(() => validateModelSource({ steps: [head, { op: 'hair', faces: scalp }] })).toThrow(/needs `length` or `guides`/);
        expect(() => validateModelSource({ steps, normalBake: { from: 'x' } })).toThrow(/no normalBake or uvAtlas/);
        expect(() => validateModelSource({ steps, rig: { joints: [{ name: 'a', at: [0, 0, 0] }] } })).toThrow(/no rig or shapes/);
    });
});

describe('the strand textures', () => {
    const maps = hairMaps();
    const size = maps.strands.size;
    const alphaAt = (x: number, y: number): number => maps.strands.rgba[(y * size + x) * 4 + 3]!;

    it('are strands: gaps between them across a card, and solid where they run together', () => {
        const row = Math.floor(size * 0.25);
        let solid = 0, clear = 0, edges = 0;
        for (let x = 0; x < size / 4; x++) {
            const a = alphaAt(x, row);
            if (a > 200) solid++;
            if (a < 30) clear++;
            if (x > 0 && (a > 128) !== (alphaAt(x - 1, row) > 128)) edges++;
        }
        expect(solid).toBeGreaterThan(5);
        expect(clear).toBeGreaterThan(5);
        expect(edges).toBeGreaterThan(6);
    });

    it('thin out toward the tips, which are at the bottom rows', () => {
        const covered = (y: number): number => { let n = 0; for (let x = 0; x < size; x++) if (alphaAt(x, y) > 128) n++; return n; };
        expect(covered(Math.floor(size * 0.1))).toBeGreaterThan(covered(Math.floor(size * 0.9)) * 3);
        expect(covered(size - 1)).toBe(0);
    });

    it('keep clear at the edges of each strip, so a card\'s side has no hard line', () => {
        for (let y = 0; y < size; y += 16) for (const x of [0, size / 4 - 1, size / 4, size / 2 - 1]) expect(alphaAt(x, y)).toBe(0);
    });

    it('point along v in the flow map, and differ from place to place in the shift map', () => {
        expect([...maps.flow.rgba.subarray(0, 4)]).toEqual([128, 255, 128, 255]);
        const tones = new Set<number>();
        for (let i = 0; i < 256; i++) tones.add(maps.shift.rgba[i * 4]!);
        expect(tones.size).toBeGreaterThan(30);
    });
});

describe('hairSway', () => {
    const swung = (sway: Record<string, unknown> = {}): BakedModel => bakeModel({ version: 1, hairSway: { chains: 6, bones: 3, ...sway }, steps: [head, { op: 'hair', faces: scalp, count: 60, length: 1.4 }] });

    it('makes a root and a chain of joints per group of cards', () => {
        const m = swung();
        expect(m.rig!.joints).toHaveLength(1 + 6 * 4);
        expect(m.rig!.joints[0]!.name).toBe('hair');
        expect(m.hair!.chainRoots).toHaveLength(6);
        for (const root of m.hair!.chainRoots!) expect(m.rig!.joints[root]!.parent).toBe(0);
    });

    it('runs each chain down the cards it owns', () => {
        const m = swung();
        for (const root of m.hair!.chainRoots!) {
            const [top, bottom] = [m.rig!.joints[root]!.at, m.rig!.joints[root + 3]!.at];
            expect(Math.hypot(top[0] - bottom[0], top[1] - bottom[1], top[2] - bottom[2])).toBeGreaterThan(0.3);
        }
    });

    it('binds each vertex wholly, to the two bones either side of it, and the roots to the first', () => {
        const m = swung();
        const { joints, weights } = m.rig!.skin;
        for (let v = 0; v < m.poly.positions.length; v++) {
            expect(weights[v * 4]! + weights[v * 4 + 1]!).toBeCloseTo(1, 5);
            expect(weights[v * 4 + 2]).toBe(0);
            expect(joints[v * 4 + 1]).toBe(joints[v * 4]! + 1);
        }
        for (const root of m.hair!.chainRoots!) expect(m.rig!.skin.dominant[root]).toBeGreaterThan(0);
    });

    it('puts every joint on the skin\'s joints channel', () => {
        expect(swung().data.channels.some((c) => c.semantic === MeshChannel.Joints)).toBe(true);
    });

    it('refuses what cannot be meant', () => {
        expect(() => validateModelSource({ steps: [head], hairSway: {} })).toThrow(/needs a hair step/);
        const steps = [head, { op: 'hair', faces: scalp, length: 1 }];
        expect(() => validateModelSource({ steps, hairSway: { chains: 0 } })).toThrow(/chains must be 1..60/);
        expect(() => validateModelSource({ steps, hairSway: { stiffness: 2 } })).toThrow(/stiffness must be 0..1/);
        expect(() => validateModelSource({ steps, hairSway: { collider: { at: [0, 0] } } })).toThrow(/collider must be/);
        expect(() => validateModelSource({ steps, hairSway: { swing: 1 } })).toThrow(/unknown field "swing"/);
    });
});

describe('attach', () => {
    const rig = { joints: [{ name: 'root', at: [0, 0, 0] }, { name: 'head', at: [0, 1.5, 0.1], parent: 'root' }] };
    const head2: ModelStep = { op: 'sphere', radius: 1, rings: 8, sides: 12 };

    it('nests the prefab under the joint, drawn back by as far as the joint is out', () => {
        const joints = resolveJoints(rig as never);
        const prefab = prefabOf('body', 'body.esmesh', joints, true, null, null, { attach: [{ joint: 'head', prefab: 'assets/wig.esprefab' }] }) as { entities: Record<string, unknown>[] };
        const worn = prefab.entities.find((e) => e.prefabEntityId === 'a0')!;
        const head = prefab.entities.find((e) => e.name === 'head')!;
        expect(worn.parent).toBe(head.prefabEntityId);
        expect(head.children).toContain('a0');
        expect(worn.name).toBe('wig');
        expect(worn.nestedPrefab).toEqual({
            prefabPath: 'assets/wig.esprefab',
            overrides: [{ prefabEntityId: 'root', type: 'property', componentType: 'Transform', propertyName: 'position', value: { x: -0, y: -1.5, z: -0.1 } }],
        });
    });

    it('refuses what cannot be meant', () => {
        expect(() => validateModelSource({ steps: [head2], attach: [{ joint: 'head', prefab: 'a.esprefab' }] })).toThrow(/needs a rig/);
        expect(() => validateModelSource({ steps: [head2], rig, attach: [{ joint: 'tail', prefab: 'a.esprefab' }] })).toThrow(/"tail" is no joint/);
        expect(() => validateModelSource({ steps: [head2], rig, attach: [{ joint: 'head', prefab: 'a.png' }] })).toThrow(/must be a project path to an .esprefab/);
        expect(() => validateModelSource({ steps: [head2], rig, attach: [{ joint: 'head', prefab: 'a.esprefab', at: 1 }] })).toThrow(/unknown field "at"/);
        expect(() => validateModelSource({ steps: [head2], rig, attach: { joint: 'head' } })).toThrow(/must be an array/);
    });
});

describe('see-through', () => {
    const plane: ModelStep = { id: 'form', op: 'plane', size: 2, color: [0.2, 0.6, 0.2] };

    it('a stain sets alpha where it lands, and keeps the colour', () => {
        const m = bakeModel({ version: 1, material: { alpha: 'cutout' }, steps: [plane, { op: 'stain', near: { at: [0, 0, 0], radius: 0.5 }, hard: true, alpha: 0, detail: 0.1 }] });
        const holes = m.poly.faces.filter((f) => f.color![3] === 0);
        expect(holes.length).toBeGreaterThan(5);
        for (const f of m.poly.faces) expect(f.color![1]).toBeCloseTo(0.6, 5);
    });

    it('a bake keeps holes on a mesh that has no triangles for them', () => {
        const m = bakeModel({ version: 1, material: { alpha: 'cutout' }, normalBake: { size: 128, color: true }, steps: [plane, { op: 'stain', near: { at: [0, 0, 0], radius: 0.5 }, hard: true, alpha: 0, detail: 0.05 }, { op: 'decimate', from: 'form', ratio: 1 }] });
        expect(m.report.triangles).toBe(2);
        const { colorRgba } = bakeNormalMap(m);
        let clear = 0, solid = 0;
        for (let i = 3; i < colorRgba!.length; i += 4) { if (colorRgba![i] === 0) clear++; if (colorRgba![i] === 255) solid++; }
        expect(clear).toBeGreaterThan(500);
        expect(solid).toBeGreaterThan(clear);
    });

    it('writes a cutout unblended, with its cutoff, both sides drawn', () => {
        const doc = modelMaterialDoc(validateModelSource({ steps: [plane], material: { alpha: 'cutout', cutoff: 0.3 } }), true, {})!;
        expect((doc.properties as Record<string, unknown>).u_alphaCutoff).toBe(0.3);
        // Light through a thin thing is the material's to say, and nothing is written for one that says nothing.
        expect((doc.properties as Record<string, unknown>).u_translucency).toBeUndefined();
        const leaf = modelMaterialDoc(validateModelSource({ steps: [plane], material: { alpha: 'cutout', translucency: 0.6 } }), true, {})!;
        expect((leaf.properties as Record<string, unknown>).u_translucency).toBe(0.6);
        expect(() => validateModelSource({ steps: [plane], material: { translucency: 2 } })).toThrow(/translucency must be 0..1/);
        expect(doc.depthWrite).toBe(true);
        expect(doc.cull).toBe(modelMaterialDoc(validateModelSource({ steps: [plane], material: {} }), false, {})!.cull);
    });

    it('writes a blend blended, not writing depth', () => {
        const blend = modelMaterialDoc(validateModelSource({ steps: [plane], material: { alpha: 'blend' } }), true, {})!;
        const plain = modelMaterialDoc(validateModelSource({ steps: [plane], material: { metallic: 1 } }), true, {})!;
        expect(blend.depthWrite).toBe(false);
        expect(blend.blendMode).not.toBe(plain.blendMode);
    });

    it('a hair material is the Hair shader, cut out, with both sides drawn and the maps it reads', () => {
        const doc = modelMaterialDoc(validateModelSource({ steps: [plane] }), false, { hair: { flow: 'a_flow.png', shift: 'a_shift.png' } })!;
        expect(doc.shader).toBe('builtin:hair');
        const p = doc.properties as Record<string, unknown>;
        expect(p.u_flowMap).toBe('a_flow.png');
        expect(p.u_shiftMap).toBe('a_shift.png');
        expect(p.u_alphaCutoff).toBeGreaterThan(0);
    });

    it('refuses an alpha it does not know', () => {
        expect(() => validateModelSource({ steps: [plane], material: { alpha: 'glass' } })).toThrow(/alpha must be cutout or blend/);
        expect(() => validateModelSource({ steps: [plane], material: { cutoff: 2 } })).toThrow(/cutoff must be 0..1/);
    });
});

describe('hair along guides', () => {
    const line: [number, number, number][] = [[0, 1, -1], [0, 0.5, -2], [0.2, -0.5, -2.4], [0.1, -1.5, -2.2]];
    const tail = (extra: Record<string, unknown> = {}): BakedModel => bakeModel({ version: 1, steps: [head, { op: 'hair', faces: { within: { min: [-0.3, 0.8, -1.1], max: [0.3, 1.1, -0.2] } }, count: 40, guides: [line], segments: 8, uneven: 0, ...extra }] });
    const tips = (m: BakedModel): number[][] => {
        const cards = new Map<number, number[]>();
        for (const f of m.poly.faces) cards.set(f.card!, [...f.v]);
        return [...cards.values()].map((v) => { const [a, b] = [m.poly.positions[v[1]!]!, m.poly.positions[v[2]!]!]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]; });
    };
    const spreadOf = (points: number[][]): number => {
        const mid = [0, 1, 2].map((k) => points.reduce((sum, p) => sum + p[k]!, 0) / points.length);
        return Math.max(...points.map((p) => Math.hypot(p[0]! - mid[0]!, p[1]! - mid[1]!, p[2]! - mid[2]!)));
    };

    it('runs along the line to its end, wherever gravity would have taken it', () => {
        for (const tip of tips(tail({ spread: 0 }))) expect(Math.hypot(tip[0]! - 0.1, tip[1]! + 1.5, tip[2]! + 2.2)).toBeLessThan(0.95);
    });

    it('takes the line that starts nearest its root', () => {
        const other: [number, number, number][] = [[0, 1, 1], [0, 0, 3]];
        const m = bakeModel({ version: 1, steps: [head, { op: 'hair', faces: scalp, count: 60, guides: [line, other], segments: 4, uneven: 0, spread: 0 }] });
        const ends = tips(m);
        expect(ends.some((t) => t[2]! < -1.5)).toBe(true);
        expect(ends.some((t) => t[2]! > 2)).toBe(true);
    });

    it('closes up onto the line as far as `gather` asks', () => {
        expect(spreadOf(tips(tail({ spread: 0, gather: 1 })))).toBeLessThan(spreadOf(tips(tail({ spread: 0 }))) * 0.2);
    });

    it('flies apart toward the ends by `spread`', () => {
        expect(spreadOf(tips(tail({ spread: 0.3, gather: 1 })))).toBeGreaterThan(spreadOf(tips(tail({ spread: 0, gather: 1 }))) + 0.2);
    });

    it('goes over the head rather than through it', () => {
        const across: [number, number, number][] = [[0.9, 0.4, 0], [0, 0.4, 0], [-0.9, 0.4, -0.3]];
        const m = bakeModel({ version: 1, steps: [head, { op: 'hair', faces: { within: { min: [0.5, 0.2, -0.5], max: [null, 0.6, 0.5] } }, count: 30, guides: [across], gather: 1, spread: 0, uneven: 0, segments: 12 }] });
        const nearest = Math.min(...m.poly.positions.map((q) => Math.hypot(q[0]!, q[1]!, q[2]!)));
        expect(nearest).toBeGreaterThan(0.9);
    });

    it('needs a length or guides, and says so', () => {
        expect(() => validateModelSource({ steps: [head, { op: 'hair', faces: scalp, guides: [[[0, 0, 0]]] }] })).toThrow(/guides/);
        expect(() => validateModelSource({ steps: [head, { op: 'hair', faces: scalp }] })).toThrow(/length/);
    });
});

describe('material.emissive', () => {
    const box: ModelStep = { op: 'box', size: 1 };
    it('gives off that light, past 1 if asked', () => {
        const doc = modelMaterialDoc({ version: 1, material: { emissive: [8, 3, 0.5] }, steps: [box] }, true, {}) as { properties: Record<string, unknown> };
        expect(doc.properties.u_emissive).toEqual({ r: 8, g: 3, b: 0.5, a: 1 });
        expect(doc.properties.u_emissiveMap).toBeUndefined();
    });

    it('takes its colours from the paint when the paint is baked', () => {
        const doc = modelMaterialDoc({ version: 1, material: { emissive: [4, 4, 4] }, steps: [box] }, true, { color: 'm_color.png' }) as { properties: Record<string, unknown> };
        expect(doc.properties.u_emissiveMap).toBe('m_color.png');
    });

    it('refuses what is not light', () => {
        expect(() => validateModelSource({ material: { emissive: [1, -1, 0] }, steps: [box] })).toThrow(/emissive/);
        expect(() => validateModelSource({ material: { emissive: 3 }, steps: [box] })).toThrow(/emissive/);
    });
});
