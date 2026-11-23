// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    groom.test.ts
 * @brief   A groom: its curves file read back as written, the figures the Strands panel shows, the ribbons it is drawn as, and what a
 *          group's settings put on its material.
 */
import { describe, expect, it } from 'vitest';
import { MeshChannel, type MeshData } from '../src/asset/meshFormat';
import {
    decodeCurves, encodeCurves, groupStats, parseGroomDocument, settingsForGroups, emptyCurveSet, DEFAULT_GROUP_SETTINGS,
    type CurveSet, type GroomCurves,
} from '../src/groom/groomFormat';
import { buildStrandMesh } from '../src/groom/groomMesh';
import { besideFile, Groom, groupUniforms, GROOM_SHADOW_PER_UNIT } from '../src/groom/groomPlugin';
import { STRANDS_SHADER_TEMPLATE } from '../src/groom/groomShader';

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
