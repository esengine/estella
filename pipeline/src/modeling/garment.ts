// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  garment.ts — the `garment` step: clothes that come off the body they are for.
 *
 *        A shirt drawn by itself has nothing in its sleeve, and nothing to follow when the arm moves. So this takes a piece of the
 *        surface already there, relaxes it as cloth lies over what is under it, stands it off by how loose it is, and cuts and hems it.
 *        It fits from every side because the body does, and bones found for it are the ones the body has.
 */
import { compact, faceNormal, faceArea, normalize, selectFaces, type Face, type FaceSelector, type PolyMesh, type Vec3 } from './polyMesh';

export interface GarmentLoose {
    /** A line along the body, say from a shoulder to a wrist. */
    from: Vec3;
    to: Vec3;
    /** How much further out, evenly spaced along it: a bell sleeve grows toward its cuff. */
    ease?: readonly number[];
    /** How far it hangs below that, evenly spaced along it, the underside the most: a bell sleeve falling. */
    hang?: readonly number[];
    /** Also its reflection across this axis. */
    mirror?: 'x';
}

export interface GarmentCut {
    /** A point on the plane where the cloth stops. */
    at: Vec3;
    /** Toward the side that is kept. */
    keep: Vec3;
    mirror?: 'x';
}

export interface GarmentParams {
    /** The surface it is made from. */
    faces: FaceSelector;
    /** How far it stands off the body. Default 0.006. */
    ease?: number;
    /** Passes of relaxing first, so it spans a hollow instead of following into it: 0 for a stocking, 30 for a shirt. Default 12. */
    relax?: number;
    loose?: readonly GarmentLoose[];
    cut?: readonly GarmentCut[];
    /** The cloth's thickness: a hem shows it. Default 0.002. */
    thickness?: number;
    /** Takes away the body under it, so it cannot show through when it bends. Default false. */
    hide?: boolean;
    color?: readonly number[];
    tag?: string;
}

const mirrored = (v: Vec3): Vec3 => [-v[0], v[1], v[2]];
/** How far in from a hem the inside of the cloth goes on. */
const INSIDE_RINGS = 8;

export function garment(mesh: PolyMesh, p: GarmentParams): PolyMesh {
    const ease = p.ease ?? 0.006;
    const relax = p.relax ?? 12;
    const thickness = p.thickness ?? 0.002;
    if (!(thickness > 0)) throw new Error(`thickness ${thickness} must be positive`);
    if (!(relax >= 0)) throw new Error(`relax ${relax} must not be negative`);
    if (p.color && p.color.length < 3) throw new Error('color must be [r, g, b]');
    const hit = selectFaces(mesh, p.faces);
    if (hit.length === 0) throw new Error(`\`faces\` ${JSON.stringify(p.faces)} matched no face`);
    const tag = p.tag ?? 'garment';

    // Its own copy of the surface.
    const local = new Map<number, number>();
    const positions: Vec3[] = [];
    const loops: number[][] = hit.map((f) => mesh.faces[f]!.v.map((v) => {
        let at = local.get(v);
        if (at === undefined) { at = positions.length; local.set(v, at); positions.push(mesh.positions[v]!); }
        return at;
    }));
    const links: Set<number>[] = positions.map(() => new Set());
    const edgeUses = new Map<number, number>();
    const edgeKey = (a: number, b: number): number => (a < b ? a * 67108864 + b : b * 67108864 + a);
    for (const loop of loops) {
        loop.forEach((a, i) => {
            const b = loop[(i + 1) % loop.length]!;
            links[a]!.add(b); links[b]!.add(a);
            edgeUses.set(edgeKey(a, b), (edgeUses.get(edgeKey(a, b)) ?? 0) + 1);
        });
    }
    // Relaxed: each point toward the mean of its neighbours, and the piece's open edge left where it is, or it would draw in from there.
    const onEdge = new Uint8Array(positions.length);
    for (const loop of loops) loop.forEach((a, i) => { const b = loop[(i + 1) % loop.length]!; if (edgeUses.get(edgeKey(a, b)) === 1) { onEdge[a] = 1; onEdge[b] = 1; } });
    let current = positions;
    for (let pass = 0; pass < relax; pass++) {
        const next = current.map((q, v): Vec3 => {
            if (onEdge[v] || links[v]!.size === 0) return q;
            let [x, y, z] = [0, 0, 0];
            for (const n of links[v]!) { x += current[n]![0]; y += current[n]![1]; z += current[n]![2]; }
            const c = links[v]!.size;
            return [q[0] + (x / c - q[0]) * 0.6, q[1] + (y / c - q[1]) * 0.6, q[2] + (z / c - q[2]) * 0.6];
        });
        current = next;
    }
    // Standing off, along the way the relaxed surface faces.
    const shell: PolyMesh = { positions: current, faces: loops.map((v) => ({ v, tag: '' })) };
    const normals = current.map((): [number, number, number] => [0, 0, 0]);
    for (const face of shell.faces) {
        const n = faceNormal(shell, face);
        const area = faceArea(shell, face);
        for (const v of face.v) { normals[v]![0] += n[0] * area; normals[v]![1] += n[1] * area; normals[v]![2] += n[2] * area; }
    }
    const faces = normals.map((n) => normalize(n));
    const looses = (p.loose ?? []).flatMap((l) => (l.mirror ? [l, { ...l, from: mirrored(l.from), to: mirrored(l.to) }] : [l]));
    const sampled = (values: readonly number[] | undefined, t: number): number => {
        if (!values?.length) return 0;
        if (values.length === 1) return values[0]!;
        const at = Math.max(0, Math.min(1, t)) * (values.length - 1);
        const i = Math.min(values.length - 2, Math.floor(at));
        const s = at - i;
        return values[i]! + (values[i + 1]! - values[i]!) * s * s * (3 - 2 * s) ** 1;
    };
    let placed: Vec3[] = current.map((q, v) => {
        const n = faces[v]!;
        let out: Vec3 = [q[0] + n[0] * ease, q[1] + n[1] * ease, q[2] + n[2] * ease];
        for (const l of looses) {
            const axis: Vec3 = [l.to[0] - l.from[0], l.to[1] - l.from[1], l.to[2] - l.from[2]];
            const len2 = axis[0] ** 2 + axis[1] ** 2 + axis[2] ** 2;
            if (len2 === 0) continue;
            const t = ((q[0] - l.from[0]) * axis[0] + (q[1] - l.from[1]) * axis[1] + (q[2] - l.from[2]) * axis[2]) / len2;
            // Only what lies along it and near it: a sleeve's line says nothing of the far side of a chest.
            const near: Vec3 = [l.from[0] + axis[0] * t, l.from[1] + axis[1] * t, l.from[2] + axis[2] * t];
            const away = Math.hypot(q[0] - near[0], q[1] - near[1], q[2] - near[2]);
            if (t < -0.1 || t > 1.1 || away > Math.sqrt(len2) * 0.8) continue;
            const grow = sampled(l.ease, t);
            const way = normalize([q[0] - near[0], q[1] - near[1], q[2] - near[2]]);
            out = [out[0] + way[0] * grow, out[1] + way[1] * grow, out[2] + way[2] * grow];
            const hang = sampled(l.hang, t);
            if (hang !== 0) {
                // All of it falls, the underside a little more: cloth hangs from what it rests on.
                const under = Math.max(0, -way[1]);
                out = [out[0], out[1] - hang * (0.4 + 0.6 * under), out[2]];
            }
        }
        return out;
    });

    // Cut: faces wholly past a plane go, and a point left past it is brought back onto it, so the hem is a clean line and not the grid.
    let kept = loops;
    const cuts = (p.cut ?? []).flatMap((c) => (c.mirror ? [c, { at: mirrored(c.at), keep: mirrored(c.keep) }] : [c]));
    for (const c of cuts) {
        const keep = normalize(c.keep);
        const side = (v: number): number => (placed[v]![0] - c.at[0]) * keep[0] + (placed[v]![1] - c.at[1]) * keep[1] + (placed[v]![2] - c.at[2]) * keep[2];
        kept = kept.filter((loop) => loop.some((v) => side(v) > 0));
        const onward = new Set(kept.flat());
        placed = placed.map((q, v) => {
            if (!onward.has(v)) return q;
            const d = side(v);
            return d < 0 ? [q[0] - keep[0] * d, q[1] - keep[1] * d, q[2] - keep[2] * d] : q;
        });
    }
    if (kept.length === 0) throw new Error('`cut` leaves nothing of it');

    // Thickness: the same again inside, turned over, and a band round each open edge joining the two.
    const start = mesh.positions.length;
    const inner = placed.map((q, v): Vec3 => {
        const n = faces[v]!;
        return [q[0] - n[0] * thickness, q[1] - n[1] * thickness, q[2] - n[2] * thickness];
    });
    const color = p.color ? [p.color[0]!, p.color[1]!, p.color[2]!, p.color[3] ?? 1] as const : undefined;
    const face = (v: readonly number[], faceTag = tag): Face => ({ v: [...v], tag: faceTag, smooth: true, ...(color ? { color } : {}) });
    // Its own tag, so a step that pushes the cloth out by its pattern does not push this through it from behind.
    const inside = `${tag}Inside`;
    const count = placed.length;
    const made: Face[] = [];
    const uses = new Map<number, number>();
    for (const loop of kept) loop.forEach((a, i) => { const b = loop[(i + 1) % loop.length]!; uses.set(edgeKey(a, b), (uses.get(edgeKey(a, b)) ?? 0) + 1); });
    // The inside is only seen a little way in from a hem, and the rest of it would be half the model's triangles spent on nothing.
    const nearHem = new Uint8Array(count);
    for (const loop of kept) loop.forEach((a, i) => { const b = loop[(i + 1) % loop.length]!; if (uses.get(edgeKey(a, b)) === 1) { nearHem[a] = 1; nearHem[b] = 1; } });
    for (let ring = 0; ring < INSIDE_RINGS; ring++) {
        const more: number[] = [];
        nearHem.forEach((on, v) => { if (on) for (const n of links[v]!) more.push(n); });
        for (const v of more) nearHem[v] = 1;
    }
    for (const loop of kept) {
        made.push(face(loop.map((v) => v + start)));
        if (loop.some((v) => nearHem[v])) made.push(face([...loop].reverse().map((v) => v + start + count), inside));
        loop.forEach((a, i) => {
            const b = loop[(i + 1) % loop.length]!;
            if (uses.get(edgeKey(a, b)) === 1) made.push(face([a + start + count, b + start + count, b + start, a + start], inside));
        });
    }
    // What it covers can go, but not right up to the hem, or a gap shows when it moves.
    const hidden = new Set<number>();
    if (p.hide) {
        const covered = new Set(kept.flat());
        const reverse = new Map<number, number>();
        local.forEach((to, from) => reverse.set(from, to));
        const edge = new Uint8Array(count);
        for (const loop of kept) loop.forEach((a, i) => { const b = loop[(i + 1) % loop.length]!; if (uses.get(edgeKey(a, b)) === 1) { edge[a] = 1; edge[b] = 1; } });
        for (let grow = 0; grow < 4; grow++) {
            const more: number[] = [];
            edge.forEach((on, v) => { if (on) for (const n of links[v]!) more.push(n); });
            for (const v of more) edge[v] = 1;
        }
        for (const f of hit) {
            const all = mesh.faces[f]!.v.every((v) => { const to = reverse.get(v); return to !== undefined && covered.has(to) && !edge[to]; });
            if (all) hidden.add(f);
        }
    }
    return compact({
        positions: [...mesh.positions, ...placed, ...inner],
        faces: [...mesh.faces.filter((_, f) => !hidden.has(f)), ...made],
    });
}
