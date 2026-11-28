// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    groom.test.ts
 * @brief   A groom: its curves file read back as written, the figures the Strands panel shows, the ribbons it is drawn as, and what a
 *          group's settings put on its material.
 */
import { describe, expect, it } from 'vitest';
import { MeshChannel, MeshChannelType, packChannels, type MeshData } from '../src/asset/meshFormat';
import {
    decodeCurves, encodeCurves, groupStats, mapGroomAssetRefs, parseGroomDocument, settingsForGroups, emptyCurveSet, DEFAULT_GROUP_SETTINGS, DEFAULT_CARDS_SCREEN_SIZE,
    type CurveSet, type GroomCurves,
} from '../src/groom/groomFormat';
import { buildStrandMesh } from '../src/groom/groomMesh';
import { besideFile, Groom, groupUniforms, GROOM_SHADOW_PER_UNIT } from '../src/groom/groomPlugin';
import { STRANDS_SHADER_TEMPLATE } from '../src/groom/groomShader';
import { growGroom } from '../src/groom/groomGrow';
import { meshSurface, projectStrands, SEGMENT_FLOATS } from '../src/groom/groomTextures';
import { buildGroomCards } from '../src/groom/groomCards';

/** `curves` straight up from x = 0, 1, 2…, each of `points` points 1 cm apart, the radius narrowing from 0.5 mm to 0.25 mm. */
function upright(curves: number, points: number): CurveSet {
    const counts = new Uint16Array(curves).fill(points);
    const positions = new Float32Array(curves * points * 3);
    const radii = new Float32Array(curves * points);
    for (let c = 0; c < curves; c++) {
        for (let k = 0; k < points; k++) {
            const i = c * points + k;
            positions.set([c, k * 0.01, 0], i * 3);
            radii[i] = 0.0005 * (1 - 0.5 * k / (points - 1));
        }
    }
    return { counts, positions, radii };
}

function read(mesh: MeshData, semantic: number, v: number, n: number): number[] {
    const c = mesh.channels.find((ch) => ch.semantic === semantic)!;
    const view = new DataView(mesh.vertices.buffer, mesh.vertices.byteOffset);
    return Array.from({ length: n }, (_, k) => view.getFloat32(v * mesh.vertexStride + c.offset + k * 4, true));
}
const alphaOf = (mesh: MeshData, v: number): number =>
    mesh.vertices[v * mesh.vertexStride + mesh.channels.find((ch) => ch.semantic === MeshChannel.Color)!.offset + 3]!;

it('follows only the active groom source and complete cards when mapping asset references', () => {
    const raw = {
        type: 'groom', curves: 'unused.escurves', grow: { groups: [] },
        groups: [null, { material: 'roughness', note: 'other.esmaterial' }],
        cards: { mesh: 'unused.esmesh' },
    };
    const map = (ref: string) => besideFile('assets/actor/fur.esgroom', ref);
    mapGroomAssetRefs(raw, map);
    const parsed = parseGroomDocument(JSON.stringify(raw));
    expect(parsed.grow).toEqual(raw.grow);
    expect(parsed.cards).toBeUndefined();
    expect(parsed.groups.map(group => group.material)).toEqual(['', 'assets/actor/roughness']);
    expect(raw.curves).toBe('unused.escurves');
    expect(raw.cards.mesh).toBe('unused.esmesh');
    expect(raw.groups[1]?.note).toBe('other.esmaterial');
});

describe('a curves file', () => {
    it('reads back what was written, every attribute and group, at any alignment of its name', () => {
        const strands = upright(3, 5);
        strands.rootUV = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
        strands.colors = new Uint8Array(15 * 4).map((_, i) => i % 256);
        strands.clumpIds = new Uint32Array([7, 7, 9]);
        const curves: GroomCurves = { groups: [
            { name: 'Body', strands, guides: upright(1, 5) },
            { name: 'Whiskers ü', strands: upright(2, 3), guides: emptyCurveSet() },
        ] };
        const back = decodeCurves(encodeCurves(curves));
        expect(back.groups.map((g) => g.name)).toEqual(['Body', 'Whiskers ü']);
        const b = back.groups[0]!.strands;
        expect([...b.counts]).toEqual([5, 5, 5]);
        expect([...b.positions]).toEqual([...strands.positions]);
        expect([...b.radii]).toEqual([...strands.radii]);
        expect([...b.rootUV!]).toEqual([...strands.rootUV]);
        expect([...b.colors!]).toEqual([...strands.colors]);
        expect([...b.clumpIds!]).toEqual([7, 7, 9]);
        expect(back.groups[1]!.strands.colors).toBeUndefined();
        expect(back.groups[1]!.guides.counts.length).toBe(0);
    });

    it('reads from a view into a larger buffer, as a Node Buffer from a pool is', () => {
        const bytes = encodeCurves({ groups: [{ name: 'g', strands: upright(3, 4), guides: emptyCurveSet() }] });
        const pool = new Uint8Array(bytes.length + 37);
        pool.set(bytes, 37);
        const back = decodeCurves(pool.subarray(37));
        expect([...back.groups[0]!.strands.counts]).toEqual([4, 4, 4]);
        expect(back.groups[0]!.strands.positions[4]).toBeCloseTo(0.01, 6);
    });

    it('refuses a file that is not one, one cut short, and a curve of a single point, saying which', () => {
        const bytes = encodeCurves({ groups: [{ name: 'g', strands: upright(2, 4), guides: emptyCurveSet() }] });
        expect(() => decodeCurves(new Uint8Array(16))).toThrow(/magic/);
        expect(() => decodeCurves(bytes.slice(0, bytes.length - 8))).toThrow(/ends early/);
        const bad = upright(1, 2);
        bad.counts[0] = 1;
        expect(() => decodeCurves(encodeCurves({ groups: [{ name: 'g', strands: bad, guides: emptyCurveSet() }] }))).toThrow(/curve 0 has 1 point/);
    });
});

describe('a group\'s figures', () => {
    it('count curves and points, the widest strand in centimetres, points per curve, and the attributes', () => {
        const strands: CurveSet = { counts: new Uint16Array([4, 7, 4]), positions: new Float32Array(15 * 3), radii: new Float32Array(15).fill(0.00003) };
        strands.radii[3] = 0.00003 * 1.0;
        strands.rootUV = new Float32Array(6);
        const stats = groupStats({ name: 'Group_0', strands, guides: upright(1, 4) });
        expect(stats.strands.curves).toBe(3);
        expect(stats.strands.points).toBe(15);
        expect(stats.strands.minPoints).toBe(4);
        expect(stats.strands.maxPoints).toBe(7);
        expect(stats.strands.avgPoints).toBe(5);
        expect(stats.strands.maxWidth).toBeCloseTo(0.006, 6);
        expect(stats.guides.curves).toBe(1);
        expect(stats.guides.points).toBe(4);
        expect(stats.attributes).toEqual(['Root UV']);
    });
});

describe('a groom document', () => {
    it('fills what it leaves out, and gives a group it does not name the defaults', () => {
        const doc = parseGroomDocument(JSON.stringify({ type: 'groom', curves: 'meerkat.escurves', groups: [{ hairWidth: 0.02, castShadows: false, hairRootScale: -3 }] }));
        const [first, second] = settingsForGroups(doc, 2);
        expect(first!.hairWidth).toBe(0.02);
        expect(first!.castShadows).toBe(false);
        expect(first!.hairRootScale).toBe(0);
        expect(first!.hairTipScale).toBe(1);
        expect(second).toEqual(DEFAULT_GROUP_SETTINGS);
        expect(() => parseGroomDocument('{"type":"material"}')).toThrow(/not a groom/);
    });

    it('names its curves relative to itself', () => {
        expect(besideFile('assets/fur/meerkat.esgroom', 'meerkat.escurves')).toBe('assets/fur/meerkat.escurves');
        expect(besideFile('assets/fur/meerkat.esgroom', '../shared/a.escurves')).toBe('assets/shared/a.escurves');
        expect(besideFile('/assets/fur/fur.esgroom', '@uuid:0f9a2c1e-1111-4222-8333-444455556666')).toBe('@uuid:0f9a2c1e-1111-4222-8333-444455556666');
        expect(besideFile('/assets/fur/fur.esgroom', '0f9a2c1e-1111-4222-8333-444455556666')).toBe('0f9a2c1e-1111-4222-8333-444455556666');
        expect(besideFile('assets/fur/meerkat.esgroom', 'assets/other/b.escurves')).toBe('assets/other/b.escurves');
        expect(besideFile('/scenes/groom/fur.esgroom', 'fur.escurves')).toBe('/scenes/groom/fur.escurves');
    });

    it('keeps the origin of a groom named by URL, as a scene naming it by uuid resolves to one', () => {
        expect(besideFile('estella://project/assets/fur2/fur.esgroom', 'fur.escurves'))
            .toBe('estella://project/assets/fur2/fur.escurves');
        expect(besideFile('https://cdn.example.com/game/fur/a.esgroom', '../shared/a.escurves'))
            .toBe('https://cdn.example.com/game/shared/a.escurves');
    });

    it('is an asset field, so the editor offers a picker and a scene stores a uuid', () => {
        expect(Groom.assetFields).toEqual([{ field: 'groom', type: 'groom' }]);
    });
});

describe('the strands as a mesh', () => {
    it('is each point twice, one per edge, with how far along it is, its direction, and its radius as a share of the widest', () => {
        const built = buildStrandMesh(upright(2, 3), 100)!;
        const { mesh } = built;
        expect(mesh.vertexCount).toBe(2 * 3 * 2);
        // Two triangles per segment: two segments a curve.
        expect(mesh.indices.length).toBe(2 * 2 * 6);
        expect(built.maxRadius).toBeCloseTo(0.05, 6);
        // The second curve's tip: both edges at the same place, scaled to world units, at the end of the curve.
        for (const v of [10, 11]) {
            const [x, y, z] = read(mesh, MeshChannel.Position, v, 3);
            expect([x, y, z].map((n) => +n!.toFixed(4))).toEqual([100, 2, 0]);
            expect(read(mesh, MeshChannel.TexCoord0, v, 2)).toEqual([v - 10, 1]);
            expect(read(mesh, MeshChannel.Normal, v, 3).map((n) => +n.toFixed(4))).toEqual([0, 1, 0]);
        }
        expect(read(mesh, MeshChannel.TexCoord0, 2, 2)[1]).toBeCloseTo(0.5, 5);
        expect(alphaOf(mesh, 0)).toBe(255);
        expect(alphaOf(mesh, 4)).toBe(128);
        // The bounds reach past the line by more than the widest strand.
        expect(mesh.aabbMin[0]).toBeLessThan(-0.05);
        expect(mesh.aabbMax[1]).toBeGreaterThan(2.05);
    });

    it('is nothing where there are no strands', () => {
        expect(buildStrandMesh(emptyCurveSet(), 100)).toBeNull();
    });
});

describe('a group\'s settings on its material', () => {
    it('take the width in centimetres to world units, or leave it to the curves, and turn the rest into the shader\'s params', () => {
        const at100 = groupUniforms({ ...DEFAULT_GROUP_SETTINGS, hairWidth: 0.01, hairRootScale: 1.5, hairTipScale: 0.2, stableRasterization: true }, 0.05, 100);
        expect(at100.u_hairWidth).toBeCloseTo(0.01, 9);
        expect(at100.u_rootScale).toBe(1.5);
        expect(at100.u_tipScale).toBe(0.2);
        expect(at100.u_strandMinPx).toBe(1);
        expect(at100.u_maxRadius).toBe(0.05);
        expect(at100.u_hairShadow).toBe(GROOM_SHADOW_PER_UNIT);
        const atMetres = groupUniforms({ ...DEFAULT_GROUP_SETTINGS, hairWidth: 0.01, hairShadowDensity: 2 }, 0, 1);
        expect(atMetres.u_hairWidth).toBeCloseTo(0.0001, 9);
        expect(atMetres.u_hairShadow).toBe(200 * GROOM_SHADOW_PER_UNIT);
        expect(atMetres.u_strandMinPx).toBe(0);
        expect(groupUniforms({ ...DEFAULT_GROUP_SETTINGS, overrideWidth: false }, 0.05, 100).u_hairWidth).toBe(0);
    });

    it('are params the Strands shader declares, its coverage and hair shadow among them', () => {
        const source = STRANDS_SHADER_TEMPLATE.source;
        for (const name of Object.keys(groupUniforms(DEFAULT_GROUP_SETTINGS, 0, 100))) expect(source).toContain(`#pragma param ${name} `);
        expect(source).toContain('#pragma coverage u_strandMinPx');
        expect(source).toContain('#pragma hairshadow u_hairShadow');
    });
});

describe('a groom grown from parameters', () => {
    const head = { center: [0, 0, 0] as [number, number, number], radii: [0.08, 0.1, 0.095] as [number, number, number] };
    const recipe = (over: Record<string, unknown> = {}) => ({ seed: 3, groups: [{
        name: 'Hair', scalp: { ...head, hairline: { front: 30, side: -5, back: -45 } }, strands: 1500, guides: 120, points: 16, length: 0.5,
        part: { azimuth: 0, crown: 60 }, collide: [{ center: [0, -0.45, 0] as [number, number, number], radii: [0.2, 0.25, 0.11] as [number, number, number] }], ...over,
    }] });

    it('grows the same hair from the same recipe, and other hair from another seed', () => {
        const a = growGroom(recipe()), b = growGroom(recipe());
        expect([...a.groups[0]!.strands.positions]).toEqual([...b.groups[0]!.strands.positions]);
        const c = growGroom({ ...recipe(), seed: 4 });
        expect([...c.groups[0]!.strands.positions]).not.toEqual([...a.groups[0]!.strands.positions]);
    });

    it('roots every strand on the scalp above the hairline, and no point sinks into the head', () => {
        const s = growGroom(recipe()).groups[0]!.strands;
        expect(s.counts.length).toBeGreaterThan(1400);
        let first = 0;
        for (let c = 0; c < s.counts.length; c++) {
            const n = s.counts[c]!;
            const [x, y, z] = [s.positions[first * 3]!, s.positions[first * 3 + 1]!, s.positions[first * 3 + 2]!];
            // On the ellipsoid.
            expect(Math.hypot(x / 0.08, y / 0.1, z / 0.095)).toBeCloseTo(1, 4);
            // Above the lowest hairline (the nape, -45 degrees).
            expect(Math.asin(Math.max(-1, Math.min(1, y / 0.1)))).toBeGreaterThan(-45.5 * Math.PI / 180);
            for (let k = 1; k < n; k++) {
                const i = (first + k) * 3;
                expect(Math.hypot(s.positions[i]! / 0.08, s.positions[i + 1]! / 0.1, s.positions[i + 2]! / 0.095)).toBeGreaterThan(0.999);
            }
            first += n;
        }
    });

    it('combs hair away from the part: a root right of it hangs right, one left of it hangs left', () => {
        const s = growGroom(recipe({ lengthJitter: 0, frizz: 0, flyaway: 0 })).groups[0]!.strands;
        let first = 0, wrong = 0, checked = 0;
        for (let c = 0; c < s.counts.length; c++) {
            const n = s.counts[c]!;
            const rx = s.positions[first * 3]!, ry = s.positions[first * 3 + 1]!, rz = s.positions[first * 3 + 2]!;
            // Roots on top, in front of the crown, clearly off the part.
            if (ry > 0.07 && rz > 0 && Math.abs(rx) > 0.015) {
                checked++;
                const tx = s.positions[(first + n - 1) * 3]!;
                if (Math.sign(tx) !== Math.sign(rx)) wrong++;
            }
            first += n;
        }
        expect(checked).toBeGreaterThan(20);
        expect(wrong).toBe(0);
    });

    it('cuts at the height it says, and reads back as a groom document', () => {
        const s = growGroom(recipe({ length: 0.8, cut: { y: -0.3, jitter: 0 }, frizz: 0, flyaway: 0 })).groups[0]!.strands;
        for (let i = 1; i < s.positions.length; i += 3) expect(s.positions[i]!).toBeGreaterThan(-0.301);
        const doc = parseGroomDocument(JSON.stringify({ version: 1, type: 'groom', grow: recipe(), groups: [{ overrideWidth: false }] }));
        expect(doc.curves).toBe('');
        expect(doc.grow?.groups[0]?.name).toBe('Hair');
        expect(() => parseGroomDocument(JSON.stringify({ version: 1, type: 'groom' }))).toThrow(/curves|grow/);
        expect(() => growGroom({ groups: [{ scalp: { center: [0, 0, 0], radii: [0, 1, 1] } }] })).toThrow(/radii/);
    });
});

describe('strands laid onto a mesh for its textures', () => {
    /** A square 1 m a side on y = 0, facing +y, its UVs u = x and v = z, in a project of 100 units a metre. */
    function plane(): MeshData {
        const { channels, vertexStride } = packChannels([
            { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
            { semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32 },
            { semantic: MeshChannel.TexCoord0, components: 2, type: MeshChannelType.Float32 },
        ]);
        const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
        const vertices = new Uint8Array(4 * vertexStride);
        const view = new DataView(vertices.buffer);
        const at = (s: number) => channels.find((c) => c.semantic === s)!.offset;
        corners.forEach(([x, z], v) => {
            [x! * 100, 0, z! * 100].forEach((n, k) => view.setFloat32(v * vertexStride + at(MeshChannel.Position) + k * 4, n, true));
            [0, 1, 0].forEach((n, k) => view.setFloat32(v * vertexStride + at(MeshChannel.Normal) + k * 4, n, true));
            [x!, z!].forEach((n, k) => view.setFloat32(v * vertexStride + at(MeshChannel.TexCoord0) + k * 4, n, true));
        });
        return { channels, vertexStride, vertexCount: 4, vertices, indices: new Uint32Array([0, 2, 1, 0, 3, 2]), aabbMin: [0, 0, 0], aabbMax: [100, 0, 100] };
    }
    /** One strand along +x at height `h`, from x 0.2 to 0.8 at z 0.5. */
    const strand = (h: number): GroomCurves => {
        const n = 7, positions = new Float32Array(n * 3);
        for (let k = 0; k < n; k++) positions.set([0.2 + 0.1 * k, h, 0.5], k * 3);
        return { groups: [{ name: 'g', strands: { counts: new Uint16Array([n]), positions, radii: new Float32Array(n).fill(0.0005), rootUV: new Float32Array([0.25, 0.75]) }, guides: emptyCurveSet() }] };
    };

    it('lands each segment at its UVs, as deep as it is over the surface, along +u in tangent space', () => {
        const surface = meshSurface(plane(), {}, 0, 100);
        const got = projectStrands(strand(0.01), surface, 256, { trace: 'outside', traceDistance: 0.02 });
        expect(got.count).toBe(6);
        const s = (i: number, k: number) => got.data[i * SEGMENT_FLOATS + k]!;
        expect(s(0, 0)).toBeCloseTo(0.2, 4); expect(s(0, 1)).toBeCloseTo(0.5, 4);
        expect(s(5, 2)).toBeCloseTo(0.8, 4);
        expect(s(0, 6)).toBeCloseTo(0.5, 3);
        expect([s(0, 7), s(0, 8), s(0, 9)].map((v) => Math.round(v * 1000) / 1000)).toEqual([1, 0, 0]);
        // A strand 1 mm wide on a metre of UV at 256 texels is a quarter of a texel: drawn a texel wide, at the least a strand covers.
        expect(s(0, 5)).toBe(0.5);
        expect(s(0, 12)).toBeCloseTo(0.25, 5);
    });

    it('keeps to the side it traces and to the distance it is given', () => {
        const surface = meshSurface(plane(), {}, 0, 100);
        expect(projectStrands(strand(0.01), surface, 256, { trace: 'inside', traceDistance: 0.02 }).count).toBe(0);
        expect(projectStrands(strand(-0.01), surface, 256, { trace: 'inside', traceDistance: 0.02 }).count).toBe(6);
        expect(projectStrands(strand(0.05), surface, 256, { trace: 'both', traceDistance: 0.02 }).count).toBe(0);
    });
});

describe('hair cards along a groom', () => {
    it('makes a card along each guide, in the scene\'s units, each in a UV cell of its own', () => {
        const curves = growGroom({ seed: 1, groups: [{ scalp: { center: [0, 0, 0], radii: [0.08, 0.1, 0.095] }, strands: 300, guides: 40, points: 12, length: 0.3 }] });
        const guides = curves.groups[0]!.guides;
        const mesh = buildGroomCards(curves, { width: 0.02, segments: 6, unitsPerMeter: 100 });
        expect(mesh.vertexCount).toBe(guides.counts.length * 7 * 2);
        expect(mesh.indices.length).toBe(guides.counts.length * 6 * 6);
        const pos = (v: number) => read(mesh, MeshChannel.Position, v, 3);
        const uv = (v: number) => read(mesh, MeshChannel.TexCoord0, v, 2);
        // Card 0's root edge straddles guide 0's root, 2 cm apart, at 100 units a metre.
        const a = pos(0), b = pos(1), root = [guides.positions[0]! * 100, guides.positions[1]! * 100, guides.positions[2]! * 100];
        expect((a[0]! + b[0]!) / 2).toBeCloseTo(root[0]!, 3);
        expect(Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)).toBeCloseTo(2, 3);
        // Each triangle faces where its normals say: counter-clockwise from outside, so the front face is the side lit as the front.
        // (A card twists where its guide turns sharply, so a triangle or so may face the other way; the rest face out.)
        const nrm = (v: number) => read(mesh, MeshChannel.Normal, v, 3);
        let outward = 0;
        for (let tri = 0; tri < 12; tri++) {
            const [i0, i1, i2] = [mesh.indices[tri * 3]!, mesh.indices[tri * 3 + 1]!, mesh.indices[tri * 3 + 2]!];
            const p0 = pos(i0), p1 = pos(i1), p2 = pos(i2);
            const e1 = [p1[0]! - p0[0]!, p1[1]! - p0[1]!, p1[2]! - p0[2]!], e2 = [p2[0]! - p0[0]!, p2[1]! - p0[1]!, p2[2]! - p0[2]!];
            const g = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
            const n = nrm(i0);
            if (g[0]! * n[0]! + g[1]! * n[1]! + g[2]! * n[2]! > 0) outward++;
        }
        expect(outward).toBeGreaterThanOrEqual(10);
        // No two cards share UV: every card's box in UV is apart from every other's.
        const boxes: number[][] = [];
        for (let c = 0; c < guides.counts.length; c++) {
            const us: number[] = [], vs: number[] = [];
            for (let k = 0; k < 14; k++) { const t = uv(c * 14 + k); us.push(t[0]!); vs.push(t[1]!); }
            expect(Math.min(...us)).toBeGreaterThanOrEqual(0); expect(Math.max(...vs)).toBeLessThanOrEqual(1);
            boxes.push([Math.min(...us), Math.min(...vs), Math.max(...us), Math.max(...vs)]);
        }
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
            const [a0, b0, c0, d0] = boxes[i]!, [a1, b1, c1, d1] = boxes[j]!;
            expect(c0! <= a1! + 1e-9 || c1! <= a0! + 1e-9 || d0! <= b1! + 1e-9 || d1! <= b0! + 1e-9).toBe(true);
        }
    });
});

describe('a groom drawn as its cards when small', () => {
    it('reads its cards from the .esgroom, at a screen size of its own or the default', () => {
        const doc = parseGroomDocument(JSON.stringify({ version: 1, type: 'groom', curves: 'a.escurves', cards: { mesh: 'a_Cards.esmesh', material: 'a_Cards.esmaterial' } }));
        expect(doc.cards).toEqual({ mesh: 'a_Cards.esmesh', material: 'a_Cards.esmaterial', screenSize: DEFAULT_CARDS_SCREEN_SIZE });
        expect(parseGroomDocument(JSON.stringify({ version: 1, type: 'groom', curves: 'a.escurves', cards: { mesh: 'a.esmesh', material: 'a.esmaterial', screenSize: 0.4 } })).cards?.screenSize).toBe(0.4);
        // Cards without both files are no cards.
        expect(parseGroomDocument(JSON.stringify({ version: 1, type: 'groom', curves: 'a.escurves', cards: { mesh: 'a.esmesh' } })).cards).toBeUndefined();
    });

});
