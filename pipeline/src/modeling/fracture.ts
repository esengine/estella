// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  fracture.ts — the `fracture` step: a solid cut into the pieces it breaks into.
 *
 *        A thing that breaks in a game is not broken when it is hit. It was cut beforehand into pieces that fit
 *        together with no gap, drawn as one until the blow, and let go as many after it. This is the cutting.
 *
 *        The pieces are the cells of points scattered through the solid: each piece is what lies nearer its own
 *        point than any other, so the cuts are flat, every piece is convex where the solid is, and the pieces fill
 *        the solid exactly. Points crowded toward a place make small pieces there and large ones far off, which is
 *        how a pane breaks round a stone. Each cut is made by Manifold, as a boolean is, so a piece is a closed
 *        solid with no slivers; its new faces, the inside of the thing, are tagged apart from its skin.
 */
import { PREFAB_FORMAT_VERSION } from 'esengine';
import { loadedEngine, notSolid, toSolid, type ManifoldEngine, type ManifoldSolid } from './booleans';
import { triangulateFace } from './triangulate';
import { boundsOf, compact, cross, dot, normalize, selectFaces, sub, type Face, type FaceSelector, type PolyMesh, type Vec3 } from './polyMesh';

export interface FractureParams {
    /** The closed solid to break. Default every face. */
    faces?: FaceSelector;
    /** How many pieces to aim for, 2..64. A point that falls where its cell misses the solid makes none, so there may be fewer. */
    pieces: number;
    seed?: number;
    /** Where it is struck: the pieces are smaller round here. */
    at?: Vec3;
    /** How much smaller, 0..1. Default 0.6 where `at` is given. */
    focus?: number;
    /** The tag of the faces a cut makes: the inside of the thing. Default "inside". */
    tag?: string;
    /** Their colour. Default the colour of the face nearest, a little darker. */
    color?: readonly number[];
}

/**
 * Faces a cut made carry this in place of the face they came from. Above any face index a model has, and below two
 * to the thirty-first: Manifold keeps an id as a signed number, and one past that comes back as something else.
 */
const INSIDE = 1_000_000_000;

function randomOf(seed: number): () => number {
    let s = (seed * 2654435761 + 0x9e3779b9) >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Everything on the near side of the plane through @p point that faces along @p normal: a box with that plane as one side, larger than the solid. */
function halfSpace(e: ManifoldEngine, point: Vec3, normal: Vec3, reach: number): ManifoldSolid {
    const n = normalize(normal);
    const u = normalize(cross(n, Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const v = cross(n, u);
    const props: number[] = [];
    for (let i = 0; i < 8; i++) {
        const [x, y, z] = [i & 1 ? 0 : -2 * reach, i & 2 ? 2 * reach : -2 * reach, i & 4 ? 2 * reach : -2 * reach];
        props.push(point[0] + n[0] * x + u[0] * y + v[0] * z, point[1] + n[1] * x + u[1] * y + v[1] * z, point[2] + n[2] * x + u[2] * y + v[2] * z);
    }
    // Each side as two triangles, counter-clockwise from outside.
    const quads = [[0, 4, 6, 2], [1, 3, 7, 5], [0, 1, 5, 4], [2, 6, 7, 3], [0, 2, 3, 1], [4, 5, 7, 6]];
    const tris = quads.flatMap(([a, b, c, d]) => [a!, b!, c!, a!, c!, d!]);
    return new e.Manifold(new e.Mesh({ numProp: 3, vertProperties: new Float32Array(props), triVerts: new Uint32Array(tris), faceID: new Uint32Array(12).fill(INSIDE) }));
}

/** The solid as its pieces, in its place: together they are the solid it was, and each face says which piece it is of. */
export function fractureOp(mesh: PolyMesh, p: FractureParams): PolyMesh {
    const e = loadedEngine();
    if (!(Number.isInteger(p.pieces) && p.pieces >= 2 && p.pieces <= 64)) throw new Error('pieces must be a whole number, 2..64');
    if (p.focus !== undefined && !(p.focus >= 0 && p.focus <= 1)) throw new Error('focus must be 0..1');
    if (mesh.faces.some((f) => f.piece !== undefined)) throw new Error('this model is already in pieces: fracture once');
    const all = p.faces === undefined ? mesh.faces.map((_, i) => i) : selectFaces(mesh, p.faces);
    if (all.length === 0) throw new Error(`\`faces\` ${JSON.stringify(p.faces)} matched no face`);
    const bad = notSolid(mesh, all);
    if (bad) throw new Error(`what is to be broken is not a closed solid: ${bad}`);

    const used = new Set<number>();
    for (const f of all) for (const v of mesh.faces[f]!.v) used.add(v);
    const { min, max } = boundsOf(mesh, used);
    const size = sub(max, min);
    const reach = Math.hypot(size[0], size[1], size[2]) * 2 + 1e-6;
    const random = randomOf(p.seed ?? 1);
    const focus = p.at ? p.focus ?? 0.6 : 0;
    const triangulate = (face: Face): [number, number, number][] => triangulateFace(mesh, face);

    // Its points are drawn on its skin, by area, and set a hair inside it. A point drawn anywhere in its bounds falls
    // in air as often as not - inside a pot, round a ring - and the cell of a point in air may hold none of it, so a pot
    // asked for eight came out in two. One on the skin always has some of the thing nearest to it.
    const skin: { a: Vec3; b: Vec3; c: Vec3; inward: Vec3 }[] = [];
    const areas: number[] = [];
    let area = 0;
    for (const f of all) {
        for (const [i, j, k] of triangulate(mesh.faces[f]!)) {
            const [a, b, c] = [mesh.positions[i]!, mesh.positions[j]!, mesh.positions[k]!];
            const n = cross(sub(b, a), sub(c, a));
            const twice = Math.hypot(n[0], n[1], n[2]);
            if (twice < 1e-12) continue;
            skin.push({ a, b, c, inward: [-n[0] / twice, -n[1] / twice, -n[2] / twice] });
            area += twice / 2;
            areas.push(area);
        }
    }
    const hair = Math.hypot(size[0], size[1], size[2]) * 1e-3;
    const onSkin = (): Vec3 => {
        const want = random() * area;
        let lo = 0, hi = areas.length - 1;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (areas[mid]! < want) lo = mid + 1; else hi = mid; }
        const t = skin[lo]!;
        let [u, v] = [random(), random()];
        if (u + v > 1) [u, v] = [1 - u, 1 - v];
        return [0, 1, 2].map((i) => t.a[i]! + (t.b[i]! - t.a[i]!) * u + (t.c[i]! - t.a[i]!) * v + t.inward[i]! * hair) as unknown as Vec3;
    };
    // Toward where it is struck: of a few points drawn, the nearest the blow is kept, more of them the more focus.
    const tries = p.at && focus > 0 ? 1 + Math.round(8 * focus) : 1;
    const draw = (): Vec3 => {
        let best = onSkin();
        if (!p.at) return best;
        const far = (q: Vec3): number => Math.hypot(q[0] - p.at![0], q[1] - p.at![1], q[2] - p.at![2]);
        for (let i = 1; i < tries; i++) { const q = onSkin(); if (far(q) < far(best)) best = q; }
        return best;
    };
    const seeds: Vec3[] = Array.from({ length: p.pieces }, draw);
    const whole = toSolid(e, mesh, all, triangulate);
    const allSet = new Set(all);
    let positions: Vec3[] = [];
    let made: Face[] = [];
    let count = 0;
    // A cell that is a sliver is a piece nobody sees and a body that jitters. Its point is taken out and the others
    // worked out again, which gives its share to its neighbours and leaves the solid as exactly filled as before.
    let live = seeds;
    try {
      for (let round = 0; round < 4; round++) {
        const seeds = live;
        positions = [...mesh.positions];
        made = [];
        count = 0;
        const volumes: number[] = [];
        const kept: number[] = [];
        for (let k = 0; k < seeds.length; k++) {
            // What of the solid is nearer this point than each of the others: one flat cut for every other point.
            let cell: ManifoldSolid = whole;
            for (let j = 0; j < seeds.length && !cell.isEmpty(); j++) {
                if (j === k) continue;
                const [a, b] = [seeds[k]!, seeds[j]!];
                const between = sub(b, a);
                if (dot(between, between) < 1e-18) continue;
                const cutter = halfSpace(e, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], between, reach);
                const next = cell.intersect(cutter);
                cutter.delete();
                if (cell !== whole) cell.delete();
                cell = next;
            }
            if (!cell.isEmpty()) {
                const out = cell.getMesh();
                const base = positions.length;
                for (let i = 0; i < out.vertProperties.length; i += out.numProp) positions.push([out.vertProperties[i]!, out.vertProperties[i + 1]!, out.vertProperties[i + 2]!]);
                // The colour a cut face takes where none is given: the skin's, darker, as the inside of most things is.
                const skin = mesh.faces[all[0]!]!.color;
                const inner: readonly [number, number, number, number] = p.color
                    ? [p.color[0]!, p.color[1]!, p.color[2]!, p.color[3] ?? 1]
                    : skin ? [skin[0] * 0.6, skin[1] * 0.6, skin[2] * 0.6, skin[3]] : [0.6, 0.6, 0.6, 1];
                for (let t = 0; t * 3 < out.triVerts.length; t++) {
                    const id = out.faceID![t]!;
                    const v = [out.triVerts[t * 3]! + base, out.triVerts[t * 3 + 1]! + base, out.triVerts[t * 3 + 2]! + base];
                    if (id >= INSIDE) made.push({ v, tag: p.tag ?? 'inside', color: inner, piece: count });
                    else {
                        const source = mesh.faces[id];
                        if (!source) throw new Error(`the cut lost track of a face (${id})`);
                        made.push({ ...source, v, piece: count });
                    }
                }
                let volume = 0;
                for (let t = 0; t * 3 < out.triVerts.length; t++) {
                    const [a, b, c] = [positions[out.triVerts[t * 3]! + base]!, positions[out.triVerts[t * 3 + 1]! + base]!, positions[out.triVerts[t * 3 + 2]! + base]!];
                    volume += dot(a, cross(b, c)) / 6;
                }
                volumes.push(Math.abs(volume));
                kept.push(k);
                count++;
            }
            if (cell !== whole) cell.delete();
        }
        const total = volumes.reduce((a, b) => a + b, 0);
        const slivers = new Set(kept.filter((_, i) => volumes[i]! < (total / Math.max(1, count)) * 0.04));
        if (slivers.size === 0 || count - slivers.size < 2) break;
        live = seeds.filter((_, k) => kept.includes(k) && !slivers.has(k));
        // Drawn again in their place while there are rounds to spare, so the count asked for is the count made; the
        // last round only takes them out.
        if (round < 2) while (live.length < p.pieces) live.push(draw());
      }
    } finally {
        whole.delete();
    }
    if (count < 2) throw new Error(`the solid came out as ${count} piece${count === 1 ? '' : 's'}: its points fell too close together; try another seed, or less focus`);
    const kept = mesh.faces.filter((_, i) => !allSet.has(i));
    const result = compact({ positions, faces: [...kept, ...made] });
    // What is drawn until it breaks: the solid as it came in.
    result.whole = { positions: mesh.positions, faces: mesh.faces };
    // Said only where it is not what was asked: a note is read as something to look at.
    if (count < p.pieces) result.notes = [`${count} pieces of the ${p.pieces} asked: the rest of the points fell where their share of the solid was nothing`];
    return result;
}

/**
 * The pieces of a fractured model as a prefab: one entity for each, where it lies in the model, drawing its own mesh
 * and with a body and a hull of that mesh, so that put down in a scene they are the model again and let go they fall
 * apart. A `Breakable` names it and spawns it where the whole stood.
 */
export function piecesPrefabOf(name: string, pieces: readonly { mesh: string; center: Vec3 }[], extra: { material?: string | null; texture?: string | null; normalMap?: string | null } = {}): Record<string, unknown> {
    const idOf = (i: number): string => `p${i + 1}`;
    return {
        version: PREFAB_FORMAT_VERSION, name: `${name} Pieces`, rootEntityId: 'root',
        entities: [
            { prefabEntityId: 'root', name: `${name} Pieces`, parent: null, children: pieces.map((_, i) => idOf(i)), visible: true, components: [{ type: 'Transform', data: {} }] },
            ...pieces.map((piece, i) => ({
                prefabEntityId: idOf(i), name: `Piece ${i + 1}`, parent: 'root', children: [], visible: true,
                components: [
                    { type: 'Transform', data: { position: { x: piece.center[0], y: piece.center[1], z: piece.center[2] } } },
                    // Both sides drawn: the inside of a broken thing is seen.
                    { type: 'MeshRenderer', data: { mesh: piece.mesh, ...(extra.normalMap ? { normalMap: extra.normalMap } : {}), ...(extra.texture ? { texture: extra.texture } : {}), ...(extra.material ? { material: extra.material } : {}), lit: true, opaque: true, cullBackfaces: true, enabled: true } },
                    { type: 'RigidBody3D', data: { bodyType: 2, enabled: true } },
                    { type: 'ConvexCollider3D', data: { mesh: piece.mesh, friction: 0.6, restitution: 0.05, enabled: true } },
                ],
            })),
        ],
    };
}
