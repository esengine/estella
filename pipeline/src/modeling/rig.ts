// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  rig.ts — a model that moves: joints, the weights found for them, and clips.
 *
 *        A caller states where the joints are and how a clip turns them. Weights are
 *        found, measured along the surface from each bone: two legs side by side are
 *        close through the air and far apart over the skin, and only the second is
 *        whether one should drag the other.
 */
import { ANIMATOR_FORMAT_VERSION, PREFAB_FORMAT_VERSION, TIMELINE_FORMAT_VERSION } from 'esengine';
import { add, boundsOf, cross, dot, length, normalize, scale, selectFaces, sub, type FaceSelector, type PolyMesh, type Vec3 } from './polyMesh';

export const MAX_RIG_JOINTS = 64;
const DEG = Math.PI / 180;
const SAMPLE_RATE = 30;

export interface RigJointSource {
    name: string;
    at: Vec3;
    parent?: string;
    /** Also exists reflected across this axis: `arm` becomes `arm.L` on the positive side and `arm.R` on the other. */
    mirror?: 'x' | 'y' | 'z';
}

/** Sets how much one joint moves some of the surface, where the weights found are wrong. Later ones win. */
export interface WeightAdjust {
    joint: string;
    /** 0 frees the surface of this joint, 1 binds it wholly. */
    weight: number;
    /** These faces. */
    faces?: FaceSelector;
    /** Or a ball of surface, fading out to its edge. */
    near?: { at: Vec3; radius: number };
}

/** An entity in the rig that bends nothing: what an IK constraint reaches for or looks at, moved by a game. */
export interface RigGoal {
    name: string;
    at: Vec3;
    parent?: string;
}

export interface RigSource {
    joints: readonly RigJointSource[];
    adjust?: readonly WeightAdjust[];
    goals?: readonly RigGoal[];
}

export interface AnimationTrack {
    joint: string;
    /** [time, x, y, z] in degrees, X then Y then Z, from the bind pose. */
    rotate?: readonly (readonly number[])[];
    /** [time, x, y, z] from where the joint rests. */
    move?: readonly (readonly number[])[];
    /**
     * [time, x, y, z] where this joint must be, in the model's own space: the foot of a two-bone limb,
     * whose parent and grandparent turn to put it there. `rotate` on the same track then holds it at
     * that orientation in the model's space, and left out it stays level with the ground.
     */
    reach?: readonly (readonly number[])[];
    /** The way the middle joint of a `reach` bends: forward for a knee, back for an elbow. Default the way it already bends, else +Z. */
    pole?: Vec3;
    /** Straight lines between keys, for a foot sliding along the ground: a curve would dip through it. */
    linear?: boolean;
    /** Shifts the keys by this fraction of the clip: the other leg, half a stride behind. */
    phase?: number;
}

export interface AnimationSource {
    name: string;
    duration: number;
    /** Default true. */
    loop?: boolean;
    tracks?: readonly AnimationTrack[];
    /** Weights of the model's `shapes` over the clip: a blink, a mouth. `value` is [time, weight]. */
    shapes?: readonly { name: string; value: readonly (readonly number[])[]; phase?: number; linear?: boolean }[];
}

export interface RigJoint {
    name: string;
    at: Vec3;
    parent: number;
    children: number[];
}

/** Joints flattened, mirrored ones expanded, parents always before their children. */
export function resolveJoints(rig: RigSource): RigJoint[] {
    const out: { name: string; at: Vec3; parentName: string | undefined }[] = [];
    const mirrored = new Set(rig.joints.filter((j) => j.mirror).map((j) => j.name));
    for (const j of rig.joints) {
        if (!j.mirror) {
            out.push({ name: j.name, at: j.at, parentName: j.parent });
            continue;
        }
        const k = { x: 0, y: 1, z: 2 }[j.mirror];
        const flip = [...j.at] as [number, number, number];
        flip[k] = -flip[k];
        const positive = j.at[k]! >= 0;
        const side = (s: string): string | undefined => (j.parent === undefined ? undefined : mirrored.has(j.parent) ? `${j.parent}.${s}` : j.parent);
        out.push({ name: `${j.name}.L`, at: positive ? j.at : flip, parentName: side('L') });
        out.push({ name: `${j.name}.R`, at: positive ? flip : j.at, parentName: side('R') });
    }
    if (out.length === 0) throw new Error('a rig needs at least one joint');
    if (out.length > MAX_RIG_JOINTS) throw new Error(`this rig has ${out.length} joints; a mesh can be posed by at most ${MAX_RIG_JOINTS}`);
    const index = new Map<string, number>();
    out.forEach((j, i) => {
        if (index.has(j.name)) throw new Error(`there are two joints called "${j.name}"`);
        index.set(j.name, i);
    });
    const parents = out.map((j) => {
        if (j.parentName === undefined) return -1;
        const p = index.get(j.parentName);
        if (p === undefined) throw new Error(`joint "${j.name}" has parent "${j.parentName}", which is not a joint; there are ${out.map((o) => o.name).join(', ')}`);
        return p;
    });
    if (parents.filter((p) => p < 0).length !== 1) {
        throw new Error(`a rig has one root; these have no parent: ${out.filter((_, i) => parents[i]! < 0).map((j) => j.name).join(', ')}`);
    }
    // Parents first, which also proves there is no loop.
    const order: number[] = [];
    const placed = new Set<number>();
    while (order.length < out.length) {
        const before = order.length;
        out.forEach((_, i) => {
            if (!placed.has(i) && (parents[i]! < 0 || placed.has(parents[i]!))) { order.push(i); placed.add(i); }
        });
        if (order.length === before) throw new Error('the joints\' parents go round in a loop');
    }
    const newIndex = new Map(order.map((old, i) => [old, i]));
    const joints: RigJoint[] = order.map((old) => ({
        name: out[old]!.name, at: out[old]!.at, parent: parents[old]! < 0 ? -1 : newIndex.get(parents[old]!)!, children: [],
    }));
    joints.forEach((j, i) => { if (j.parent >= 0) joints[j.parent]!.children.push(i); });
    return joints;
}

// ---- Weights --------------------------------------------------------------------

function pointSegment(p: Vec3, a: Vec3, b: Vec3): number {
    const ab = sub(b, a);
    const len2 = dot(ab, ab);
    const t = len2 > 0 ? Math.min(1, Math.max(0, dot(sub(p, a), ab) / len2)) : 0;
    return length(sub(p, add(a, scale(ab, t))));
}

/** A min-heap of [distance, vertex], for Dijkstra over the surface. */
class Heap {
    private d: number[] = [];
    private v: number[] = [];
    get size(): number { return this.d.length; }
    push(dist: number, vertex: number): void {
        let i = this.d.length;
        this.d.push(dist); this.v.push(vertex);
        while (i > 0) {
            const up = (i - 1) >> 1;
            if (this.d[up]! <= dist) break;
            this.d[i] = this.d[up]!; this.v[i] = this.v[up]!;
            i = up;
        }
        this.d[i] = dist; this.v[i] = vertex;
    }
    pop(): [number, number] {
        const [topD, topV] = [this.d[0]!, this.v[0]!];
        const [lastD, lastV] = [this.d.pop()!, this.v.pop()!];
        const n = this.d.length;
        if (n > 0) {
            let i = 0;
            for (;;) {
                let c = 2 * i + 1;
                if (c >= n) break;
                if (c + 1 < n && this.d[c + 1]! < this.d[c]!) c++;
                if (this.d[c]! >= lastD) break;
                this.d[i] = this.d[c]!; this.v[i] = this.v[c]!;
                i = c;
            }
            this.d[i] = lastD; this.v[i] = lastV;
        }
        return [topD, topV];
    }
}

export interface SkinWeights {
    /** Four per vertex. */
    joints: Uint16Array;
    weights: Float32Array;
    /** How many vertices each joint moves the most. */
    dominant: number[];
}

/** How sharply influence falls off between bones: higher keeps a limb rigid and leaves the bend to the joint. */
const WEIGHT_POWER = 6;
const MIN_WEIGHT = 0.02;
const SEED_SAMPLES = 6;

const pointToBones = (p: Vec3, from: Vec3, ends: readonly Vec3[]): number => {
    let d = Infinity;
    for (const end of ends) d = Math.min(d, pointSegment(p, from, end));
    return d;
};

export function computeWeights(mesh: PolyMesh, joints: readonly RigJoint[]): SkinWeights {
    const count = mesh.positions.length;
    const neighbours: number[][] = Array.from({ length: count }, () => []);
    for (const face of mesh.faces) {
        face.v.forEach((v, i) => {
            const w = face.v[(i + 1) % face.v.length]!;
            neighbours[v]!.push(w);
            neighbours[w]!.push(v);
        });
    }
    // Pieces of the surface: each is seeded on its own, so a separate eyeball still follows the bone nearest it.
    const shell = new Int32Array(count).fill(-1);
    let shells = 0;
    for (let v = 0; v < count; v++) {
        if (shell[v]! >= 0) continue;
        const stack = [v];
        shell[v] = shells;
        while (stack.length) {
            for (const w of neighbours[stack.pop()!]!) {
                if (shell[w]! < 0) { shell[w] = shells; stack.push(w); }
            }
        }
        shells++;
    }

    const { min, max } = boundsOf(mesh);
    const soft = length(sub(max, min)) * 0.004;
    const distances = joints.map((j) => {
        // A joint owns the bones running to its children; a tip owns only its point.
        const ends = j.children.length ? j.children.map((c) => joints[c]!.at) : [j.at];
        // Seeded where the bone is nearest the skin, sample by sample along it: one seed band for the whole bone would miss a
        // limb's thick end, and one drawn wide enough to catch it reaches the next leg through the air.
        const samples: Vec3[] = [];
        for (const end of ends) {
            for (let i = 0; i < SEED_SAMPLES; i++) samples.push(add(j.at, scale(sub(end, j.at), i / (SEED_SAMPLES - 1))));
        }
        const dist = new Float64Array(count).fill(Infinity);
        const heap = new Heap();
        const air = new Float64Array(count);
        for (const sample of samples) {
            const nearest = new Float64Array(shells).fill(Infinity);
            for (let v = 0; v < count; v++) {
                const d = length(sub(mesh.positions[v]!, sample));
                air[v] = d;
                if (d < nearest[shell[v]!]!) nearest[shell[v]!] = d;
            }
            for (let v = 0; v < count; v++) {
                if (air[v]! > nearest[shell[v]!]! * 1.1 + soft) continue;
                const d = pointToBones(mesh.positions[v]!, j.at, ends);
                if (d < dist[v]!) { dist[v] = d; heap.push(d, v); }
            }
        }
        while (heap.size) {
            const [d, v] = heap.pop();
            if (d > dist[v]!) continue;
            for (const w of neighbours[v]!) {
                const next = d + length(sub(mesh.positions[v]!, mesh.positions[w]!));
                if (next < dist[w]!) { dist[w] = next; heap.push(next, w); }
            }
        }
        return dist;
    });

    const outJoints = new Uint16Array(count * 4);
    const outWeights = new Float32Array(count * 4);
    const dominant = joints.map(() => 0);
    const ranked: { j: number; w: number }[] = [];
    for (let v = 0; v < count; v++) {
        let least = Infinity;
        for (const d of distances) if (d[v]! < least) least = d[v]!;
        ranked.length = 0;
        distances.forEach((d, j) => {
            const w = ((least + soft) / (d[v]! + soft)) ** WEIGHT_POWER;
            if (w >= MIN_WEIGHT) ranked.push({ j, w });
        });
        ranked.sort((a, b) => b.w - a.w);
        const keep = ranked.slice(0, 4);
        const total = keep.reduce((n, r) => n + r.w, 0);
        keep.forEach((r, i) => {
            outJoints[v * 4 + i] = r.j;
            outWeights[v * 4 + i] = r.w / total;
        });
        dominant[keep[0]!.j]!++;
    }
    return { joints: outJoints, weights: outWeights, dominant };
}

/** @p skin with @p adjusts applied, the rest of each touched vertex rescaled to still sum to one. */
export function adjustWeights(mesh: PolyMesh, joints: readonly RigJoint[], skin: SkinWeights, adjusts: readonly WeightAdjust[]): SkinWeights {
    if (adjusts.length === 0) return skin;
    const outJoints = skin.joints.slice();
    const outWeights = skin.weights.slice();
    for (const adjust of adjusts) {
        const j = joints.findIndex((x) => x.name === adjust.joint);
        const reach = new Float32Array(mesh.positions.length);
        if (adjust.faces !== undefined) {
            const hit = selectFaces(mesh, adjust.faces);
            if (hit.length === 0) throw new Error(`rig.adjust on "${adjust.joint}": \`faces\` ${JSON.stringify(adjust.faces)} matched no face`);
            for (const f of hit) for (const v of mesh.faces[f]!.v) reach[v] = 1;
        } else {
            const { at, radius } = adjust.near!;
            let any = false;
            mesh.positions.forEach((p, v) => {
                const t = 1 - length(sub(p, at)) / radius;
                if (t > 0) { reach[v] = t * t * (3 - 2 * t); any = true; }
            });
            if (!any) throw new Error(`rig.adjust on "${adjust.joint}": no surface within ${radius} of ${JSON.stringify(at)}`);
        }
        for (let v = 0; v < mesh.positions.length; v++) {
            const m = reach[v]!;
            if (m <= 0) continue;
            const held = new Map<number, number>();
            for (let k = 0; k < 4; k++) if (outWeights[v * 4 + k]! > 0) held.set(outJoints[v * 4 + k]!, outWeights[v * 4 + k]!);
            const old = held.get(j) ?? 0;
            const next = old + (adjust.weight - old) * m;
            const others = 1 - old;
            held.delete(j);
            // With nothing else holding it, what this joint gives up goes up the chain rather than vanishing.
            if (others <= 1e-6 && next < 1) {
                const heir = joints[j]!.parent >= 0 ? joints[j]!.parent : joints[j]!.children[0] ?? j;
                held.set(heir, 1);
            }
            const total = [...held.values()].reduce((a, b) => a + b, 0);
            const ranked = [...held.entries()].map(([joint, w]) => ({ joint, w: total > 0 ? (w / total) * (1 - next) : 0 }));
            if (next > 0) ranked.push({ joint: j, w: next });
            ranked.sort((a, b) => b.w - a.w);
            const keep = ranked.slice(0, 4);
            const sum = keep.reduce((n, r) => n + r.w, 0) || 1;
            for (let k = 0; k < 4; k++) {
                outJoints[v * 4 + k] = keep[k]?.joint ?? 0;
                outWeights[v * 4 + k] = keep[k] ? keep[k]!.w / sum : 0;
            }
        }
    }
    const dominant = joints.map(() => 0);
    for (let v = 0; v < mesh.positions.length; v++) dominant[outJoints[v * 4]!]!++;
    return { joints: outJoints, weights: outWeights, dominant };
}

// ---- Shapes ---------------------------------------------------------------------

/** One way a part of the surface moves toward a shape. */
export interface ShapeMove {
    faces?: FaceSelector;
    /** A ball of surface, fading out to its edge: a smile's corner, a raised brow. */
    near?: { at: Vec3; radius: number };
    translate?: Vec3;
    /** Along each vertex's own outward direction: a swelling, a pucker. */
    push?: number;
    /** Toward or away from the centre of what is chosen. */
    scale?: number;
}

/** A shape the mesh can blend toward, for a face or a muscle: morph target `name`, moved by `weights` in a clip or a game. */
export interface ShapeSource {
    name: string;
    moves: readonly ShapeMove[];
}

/** Each shape's offsets, three per surface vertex. */
export function shapeDeltas(mesh: PolyMesh, shape: ShapeSource): Float32Array {
    const deltas = new Float32Array(mesh.positions.length * 3);
    // Outward by the surface around each vertex, which `push` needs and nothing else does.
    let normals: Vec3[] | null = null;
    const outward = (): Vec3[] => {
        if (normals) return normals;
        const sum: Vec3[] = mesh.positions.map(() => [0, 0, 0]);
        for (const face of mesh.faces) {
            const n = faceNormalOf(mesh, face.v);
            for (const v of face.v) sum[v] = add(sum[v]!, n);
        }
        normals = sum.map(normalize);
        return normals;
    };
    for (const move of shape.moves) {
        const reach = new Float32Array(mesh.positions.length);
        if (move.faces !== undefined) {
            const hit = selectFaces(mesh, move.faces);
            if (hit.length === 0) throw new Error(`shape "${shape.name}": \`faces\` ${JSON.stringify(move.faces)} matched no face`);
            for (const f of hit) for (const v of mesh.faces[f]!.v) reach[v] = 1;
        } else {
            const { at, radius } = move.near!;
            let any = false;
            mesh.positions.forEach((p, v) => {
                const t = 1 - length(sub(p, at)) / radius;
                if (t > 0) { reach[v] = t * t * (3 - 2 * t); any = true; }
            });
            if (!any) throw new Error(`shape "${shape.name}": no surface within ${radius} of ${JSON.stringify(at)}`);
        }
        let centre: Vec3 = [0, 0, 0];
        if (move.scale !== undefined) {
            let total = 0;
            mesh.positions.forEach((p, v) => { centre = add(centre, scale(p, reach[v]!)); total += reach[v]!; });
            centre = scale(centre, 1 / total);
        }
        mesh.positions.forEach((p, v) => {
            const m = reach[v]!;
            if (m <= 0) return;
            let d: Vec3 = [0, 0, 0];
            if (move.translate) d = add(d, move.translate);
            if (move.push !== undefined) d = add(d, scale(outward()[v]!, move.push));
            if (move.scale !== undefined) d = add(d, scale(sub(p, centre), move.scale - 1));
            deltas[v * 3] = deltas[v * 3]! + d[0] * m;
            deltas[v * 3 + 1] = deltas[v * 3 + 1]! + d[1] * m;
            deltas[v * 3 + 2] = deltas[v * 3 + 2]! + d[2] * m;
        });
    }
    return deltas;
}

function faceNormalOf(mesh: PolyMesh, loop: readonly number[]): Vec3 {
    let n: Vec3 = [0, 0, 0];
    for (let i = 0; i < loop.length; i++) {
        const a = mesh.positions[loop[i]!]!, b = mesh.positions[loop[(i + 1) % loop.length]!]!;
        n = add(n, cross(a, b));
    }
    return n;
}

/** @p mesh's positions blended toward its shapes by @p weights. */
export function morphedPositions(mesh: PolyMesh, deltas: readonly Float32Array[], weights: readonly number[]): Vec3[] {
    return mesh.positions.map((p, v) => {
        let out = p;
        deltas.forEach((d, s) => {
            const w = weights[s] ?? 0;
            if (w !== 0) out = [out[0] + d[v * 3]! * w, out[1] + d[v * 3 + 1]! * w, out[2] + d[v * 3 + 2]! * w];
        });
        return out;
    });
}

/** Each shape's weight at @p time in a clip. */
export function shapeWeightsAt(names: readonly string[], animation: AnimationSource | null, time: number): number[] {
    const loop = animation?.loop !== false;
    return names.map((name) => {
        const track = animation?.shapes?.find((s) => s.name === name);
        if (!track) return 0;
        const keys = track.value.map((k) => [k[0]!, k[1]!, 0, 0]);
        return sample(keys, time, animation!.duration, loop, track.phase ?? 0, track.linear === true)[0];
    });
}

/** What is wrong with a source's `shapes`, or null. */
export function checkShapes(raw: unknown): string | null {
    if (!Array.isArray(raw) || raw.length === 0) return 'shapes must be an array of { name, moves }';
    const seen = new Set<string>();
    for (const [i, s] of (raw as Record<string, unknown>[]).entries()) {
        if (typeof s !== 'object' || s === null) return `shape ${i} must be an object`;
        for (const key of Object.keys(s)) if (!['name', 'moves'].includes(key)) return `shape ${i} has an unknown field "${key}"; it takes name, moves`;
        if (typeof s.name !== 'string' || !s.name) return `shape ${i} needs a name`;
        if (seen.has(s.name)) return `there are two shapes called "${s.name}"`;
        seen.add(s.name);
        if (!Array.isArray(s.moves) || s.moves.length === 0) return `shape "${s.name}" needs moves`;
        for (const m of s.moves as Record<string, unknown>[]) {
            for (const key of Object.keys(m)) if (!['faces', 'near', 'translate', 'push', 'scale'].includes(key)) return `shape "${s.name}": a move has an unknown field "${key}"; it takes faces, near, translate, push, scale`;
            const bad = checkRegion(m, `shape "${s.name}"`);
            if (bad) return bad;
            if (m.translate === undefined && m.push === undefined && m.scale === undefined) return `shape "${s.name}": a move needs one of translate, push, scale`;
            if (m.translate !== undefined && !vec3(m.translate)) return `shape "${s.name}": translate must be [x, y, z]`;
            if (m.push !== undefined && !isNum(m.push)) return `shape "${s.name}": push must be a number`;
            if (m.scale !== undefined && !isNum(m.scale)) return `shape "${s.name}": scale must be a number`;
        }
    }
    return null;
}

/** Faces or a ball, exactly one. */
function checkRegion(m: Record<string, unknown>, where: string): string | null {
    if ((m.faces === undefined) === (m.near === undefined)) return `${where}: give exactly one of faces, near`;
    if (m.near !== undefined) {
        const n = m.near as Record<string, unknown>;
        if (typeof n !== 'object' || n === null || !vec3(n.at) || !isNum(n.radius) || (n.radius as number) <= 0) return `${where}: near must be { at: [x, y, z], radius }, with a positive radius`;
    }
    return null;
}

// ---- Validation -----------------------------------------------------------------

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const vec3 = (v: unknown): boolean => Array.isArray(v) && v.length === 3 && v.every(isNum);

/** What is wrong with a source's `rig`, or null. */
export function checkRig(raw: unknown): string | null {
    const r = raw as { joints?: unknown };
    if (typeof raw !== 'object' || raw === null || !Array.isArray(r.joints)) return 'rig must be { joints: [{ name, at, parent?, mirror? }] }';
    for (const key of Object.keys(raw)) if (!['joints', 'adjust', 'goals'].includes(key)) return `rig has an unknown field "${key}"; it takes joints, adjust, goals`;
    for (const [i, j] of (r.joints as Record<string, unknown>[]).entries()) {
        if (typeof j !== 'object' || j === null) return `rig joint ${i} must be an object`;
        for (const key of Object.keys(j)) if (!['name', 'at', 'parent', 'mirror'].includes(key)) return `rig joint ${i} has an unknown field "${key}"; a joint takes name, at, parent, mirror`;
        if (typeof j.name !== 'string' || !j.name) return `rig joint ${i} needs a name`;
        if (/[/\\]/.test(j.name)) return `rig joint "${j.name}": a name cannot hold a slash, which is how a clip addresses a joint`;
        if (!vec3(j.at)) return `rig joint "${j.name}": at must be [x, y, z]`;
        if (j.parent !== undefined && typeof j.parent !== 'string') return `rig joint "${j.name}": parent must be a joint's name`;
        if (j.mirror !== undefined && !['x', 'y', 'z'].includes(j.mirror as string)) return `rig joint "${j.name}": mirror must be x, y or z`;
    }
    let names: Set<string>;
    try {
        names = new Set(resolveJoints(raw as RigSource).map((j) => j.name));
    } catch (e) {
        return (e as Error).message;
    }
    const rig = raw as RigSource;
    if (rig.adjust !== undefined) {
        if (!Array.isArray(rig.adjust)) return 'rig.adjust must be an array';
        for (const a of rig.adjust as unknown as Record<string, unknown>[]) {
            for (const key of Object.keys(a)) if (!['joint', 'weight', 'faces', 'near'].includes(key)) return `rig.adjust has an unknown field "${key}"; it takes joint, weight, faces, near`;
            if (!names.has(a.joint as string)) return `rig.adjust names no joint "${String(a.joint)}"; there are ${[...names].join(', ')}`;
            if (!isNum(a.weight) || a.weight < 0 || a.weight > 1) return `rig.adjust on "${String(a.joint)}": weight must be 0..1`;
            const bad = checkRegion(a, `rig.adjust on "${String(a.joint)}"`);
            if (bad) return bad;
        }
    }
    if (rig.goals !== undefined) {
        if (!Array.isArray(rig.goals)) return 'rig.goals must be an array';
        const taken = new Set(names);
        for (const g of rig.goals as unknown as Record<string, unknown>[]) {
            for (const key of Object.keys(g)) if (!['name', 'at', 'parent'].includes(key)) return `a rig goal has an unknown field "${key}"; it takes name, at, parent`;
            if (typeof g.name !== 'string' || !g.name || /[/\\]/.test(g.name)) return 'a rig goal needs a name without a slash';
            if (taken.has(g.name)) return `the name "${g.name}" is already taken in this rig`;
            taken.add(g.name);
            if (!vec3(g.at)) return `rig goal "${g.name}": at must be [x, y, z]`;
            if (g.parent !== undefined && !names.has(g.parent as string)) return `rig goal "${g.name}": parent must be a joint; there are ${[...names].join(', ')}`;
        }
    }
    return null;
}

function checkKeys(keys: unknown, duration: number, label: string): string | null {
    if (!Array.isArray(keys) || keys.length === 0) return `${label} must be an array of [time, x, y, z]`;
    let last = -Infinity;
    for (const k of keys as unknown[]) {
        if (!Array.isArray(k) || k.length !== 4 || !k.every(isNum)) return `${label}: every key is [time, x, y, z], not ${JSON.stringify(k)}`;
        const t = k[0] as number;
        if (t < 0 || t > duration) return `${label}: time ${t} is outside the clip's 0..${duration}`;
        if (t <= last) return `${label}: keys must be in time order, and ${t} comes after ${last}`;
        last = t;
    }
    return null;
}

/** What is wrong with a source's `animations`, or null. */
export function checkAnimations(raw: unknown, rig: unknown, shapes?: unknown): string | null {
    if (!Array.isArray(raw)) return 'animations must be an array';
    if (!rig && !shapes) return 'animations move joints or shapes, and this source has no rig and no shapes';
    const jointList = rig ? resolveJoints(rig as RigSource) : [];
    const shapeNames = new Set(((shapes ?? []) as { name: string }[]).map((s) => s.name));
    const names = new Set(jointList.map((j) => j.name));
    const seen = new Set<string>();
    for (const [i, a] of (raw as Record<string, unknown>[]).entries()) {
        if (typeof a !== 'object' || a === null) return `animation ${i} must be an object`;
        for (const key of Object.keys(a)) if (!['name', 'duration', 'loop', 'tracks', 'shapes'].includes(key)) return `animation ${i} has an unknown field "${key}"; it takes name, duration, loop, tracks, shapes`;
        if (typeof a.name !== 'string' || !/^[\w-]+$/.test(a.name)) return `animation ${i} needs a name of letters, digits, _ or -: it becomes a file name`;
        if (seen.has(a.name)) return `there are two animations called "${a.name}"`;
        seen.add(a.name);
        if (!isNum(a.duration) || a.duration <= 0) return `animation "${a.name}": duration must be positive seconds`;
        if (a.loop !== undefined && typeof a.loop !== 'boolean') return `animation "${a.name}": loop must be true or false`;
        const trackList = (a.tracks ?? []) as Record<string, unknown>[];
        const shapeList = (a.shapes ?? []) as Record<string, unknown>[];
        if (!Array.isArray(trackList) || !Array.isArray(shapeList) || trackList.length + shapeList.length === 0) return `animation "${a.name}" needs tracks or shapes`;
        for (const t of shapeList) {
            for (const key of Object.keys(t)) if (!['name', 'value', 'phase', 'linear'].includes(key)) return `animation "${a.name}": a shape track has an unknown field "${key}"; it takes name, value, phase, linear`;
            if (!shapeNames.has(t.name as string)) return `animation "${a.name}": no shape "${String(t.name)}"; there are ${[...shapeNames].join(', ') || '(none)'}`;
            if (!Array.isArray(t.value) || t.value.length === 0) return `animation "${a.name}": shape "${t.name as string}" needs value keys of [time, weight]`;
            let last = -Infinity;
            for (const k of t.value as unknown[]) {
                if (!Array.isArray(k) || k.length !== 2 || !k.every(isNum)) return `animation "${a.name}": shape "${t.name as string}": every key is [time, weight], not ${JSON.stringify(k)}`;
                if ((k[0] as number) < 0 || (k[0] as number) > a.duration) return `animation "${a.name}": shape "${t.name as string}": time ${k[0] as number} is outside the clip's 0..${a.duration}`;
                if ((k[0] as number) <= last) return `animation "${a.name}": shape "${t.name as string}": keys must be in time order`;
                last = k[0] as number;
            }
        }
        const tracked = new Set<string>();
        for (const t of trackList) {
            for (const key of Object.keys(t)) if (!['joint', 'rotate', 'move', 'reach', 'pole', 'linear', 'phase'].includes(key)) return `animation "${a.name}": a track has an unknown field "${key}"; it takes joint, rotate, move, reach, pole, linear, phase`;
            if (!names.has(t.joint as string)) return `animation "${a.name}": no joint "${String(t.joint)}"; there are ${[...names].join(', ')}`;
            if (tracked.has(t.joint as string)) return `animation "${a.name}": two tracks for joint "${t.joint as string}"; put their keys in one`;
            tracked.add(t.joint as string);
            if (t.rotate === undefined && t.move === undefined && t.reach === undefined) return `animation "${a.name}": the track for "${t.joint as string}" has none of rotate, move, reach`;
            if (t.reach !== undefined) {
                if (t.move !== undefined) return `animation "${a.name}": "${t.joint as string}" has both reach and move; reach already says where it goes`;
                const chain = jointList.find((j) => j.name === t.joint)!;
                const lower = chain.parent >= 0 ? jointList[chain.parent]! : null;
                if (!lower || lower.parent < 0) return `animation "${a.name}": reach needs two bones above the joint, and "${t.joint as string}" has fewer`;
            }
            if (t.pole !== undefined && (!vec3(t.pole) || t.reach === undefined)) return `animation "${a.name}": pole on "${t.joint as string}" must be [x, y, z], and goes with reach`;
            if (t.linear !== undefined && typeof t.linear !== 'boolean') return `animation "${a.name}": linear must be true or false`;
            for (const kind of ['rotate', 'move', 'reach'] as const) {
                if (t[kind] === undefined) continue;
                const bad = checkKeys(t[kind], a.duration, `animation "${a.name}", ${t.joint as string}.${kind}`);
                if (bad) return bad;
            }
            if (t.phase !== undefined && !isNum(t.phase)) return `animation "${a.name}": phase must be a number`;
        }
        // A reach decides its limb, so a rotate on the two joints it turns would be silently thrown away.
        for (const t of trackList as unknown as AnimationTrack[]) {
            if (!t.reach) continue;
            const foot = jointList.find((j) => j.name === t.joint)!;
            const lower = jointList[foot.parent]!, upper = jointList[lower.parent]!;
            for (const taken of [lower, upper]) {
                const clash = (trackList as unknown as AnimationTrack[]).find((o) => o.joint === taken.name && o.rotate);
                if (clash) return `animation "${a.name}": "${taken.name}" has rotate keys, but the reach on "${t.joint}" decides how it turns`;
            }
        }
    }
    return null;
}

// ---- Motion ---------------------------------------------------------------------

type Quat = readonly [number, number, number, number];

const quatMul = (a: Quat, b: Quat): Quat => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

/** X, then Y, then Z. */
function eulerToQuat(x: number, y: number, z: number): Quat {
    const axis = (i: number, deg: number): Quat => {
        const h = (deg * DEG) / 2;
        const q = [0, 0, 0, Math.cos(h)] as [number, number, number, number];
        q[i] = Math.sin(h);
        return q;
    };
    return quatMul(axis(2, z), quatMul(axis(1, y), axis(0, x)));
}

function rotateBy(q: Quat, v: Vec3): Vec3 {
    const u: Vec3 = [q[0], q[1], q[2]];
    const t = scale(cross(u, v), 2);
    return add(add(v, scale(t, q[3])), cross(u, t));
}

/** A key track's value at @p time: a smooth line through the keys, passing through each exactly. */
function sample(keys: readonly (readonly number[])[], time: number, duration: number, loop: boolean, phase: number, linear = false): Vec3 {
    const shifted = keys.map((k) => [k[0]! + phase * duration, k[1]!, k[2]!, k[3]!] as const);
    const wrap = (t: number): number => ((t % duration) + duration) % duration;
    const list = (loop ? shifted.map((k) => [wrap(k[0]), k[1], k[2], k[3]] as const) : shifted).slice().sort((a, b) => a[0] - b[0]);
    const n = list.length;
    if (n === 1) return [list[0]![1], list[0]![2], list[0]![3]];
    if (!loop && time <= list[0]![0]) return [list[0]![1], list[0]![2], list[0]![3]];
    if (!loop && time >= list[n - 1]![0]) return [list[n - 1]![1], list[n - 1]![2], list[n - 1]![3]];
    const at = (i: number): readonly number[] => {
        if (loop) {
            const turns = Math.floor(i / n);
            const k = list[((i % n) + n) % n]!;
            return [k[0] + turns * duration, k[1], k[2], k[3]];
        }
        return list[Math.max(0, Math.min(n - 1, i))]!;
    };
    let i = loop ? -1 : 0;
    const t = loop ? wrap(time) : time;
    while (at(i + 1)[0]! <= t) i++;
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const span = p2[0]! - p1[0]!;
    const u = span > 0 ? (t - p1[0]!) / span : 0;
    if (linear) return [1, 2, 3].map((c) => p1[c]! + (p2[c]! - p1[c]!) * u) as unknown as Vec3;
    const [u2, u3] = [u * u, u * u * u];
    const v = [1, 2, 3].map((c) => {
        const [a, b] = [p1[c]!, p2[c]!];
        const m1 = ((b - p0[c]!) / Math.max(p2[0]! - p0[0]!, 1e-6)) * span;
        const m2 = ((p3[c]! - a) / Math.max(p3[0]! - p1[0]!, 1e-6)) * span;
        return (2 * u3 - 3 * u2 + 1) * a + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * b + (u3 - u2) * m2;
    });
    return v as unknown as Vec3;
}

const conjugate = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

/** The shortest rotation taking direction @p from onto @p to. */
function rotationBetween(from: Vec3, to: Vec3): Quat {
    const a = normalize(from), b = normalize(to);
    const d = dot(a, b);
    if (d > 1 - 1e-9) return [0, 0, 0, 1];
    if (d < -1 + 1e-9) {
        const side = normalize(cross(a, Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
        return [side[0], side[1], side[2], 0];
    }
    const c = cross(a, b);
    const w = 1 + d;
    const len = Math.hypot(c[0], c[1], c[2], w);
    return [c[0] / len, c[1] / len, c[2] / len, w / len];
}

interface Pose {
    /** Relative to the parent: what a clip writes. */
    local: { q: Quat; offset: Vec3 }[];
    /** In the model's space: what skinning reads. */
    world: { q: Quat; origin: Vec3 }[];
}

function toWorld(joints: readonly RigJoint[], local: Pose['local']): Pose['world'] {
    const world: Pose['world'] = [];
    joints.forEach((j, i) => {
        const l = local[i]!;
        if (j.parent < 0) world[i] = { q: l.q, origin: l.offset };
        else {
            const p = world[j.parent]!;
            world[i] = { q: quatMul(p.q, l.q), origin: add(p.origin, rotateBy(p.q, l.offset)) };
        }
    });
    return world;
}

/** Each joint at @p time, with every `reach` solved; the bind pose with no animation. */
function poseAt(joints: readonly RigJoint[], animation: AnimationSource | null, time: number): Pose {
    const loop = animation?.loop !== false;
    const at = (keys: readonly (readonly number[])[], t: AnimationTrack): Vec3 => sample(keys, time, animation!.duration, loop, t.phase ?? 0, t.linear === true);
    const local: Pose['local'] = joints.map((j) => {
        const track = animation?.tracks?.find((t) => t.joint === j.name);
        const euler = track?.rotate && !track.reach ? at(track.rotate, track) : [0, 0, 0] as Vec3;
        const moved = track?.move ? at(track.move, track) : [0, 0, 0] as Vec3;
        const rest = j.parent >= 0 ? sub(j.at, joints[j.parent]!.at) : j.at;
        return { q: eulerToQuat(euler[0], euler[1], euler[2]), offset: add(rest, moved) };
    });
    let world = toWorld(joints, local);
    for (const track of animation?.tracks ?? []) {
        if (!track.reach) continue;
        const foot = joints.findIndex((j) => j.name === track.joint);
        const lower = joints[foot]!.parent, upper = joints[lower]!.parent, above = joints[upper]!.parent;
        const target = at(track.reach, track);
        const a = world[upper]!.origin, b = world[lower]!.origin, c = world[foot]!.origin;
        const upperLen = length(sub(joints[lower]!.at, joints[upper]!.at)), lowerLen = length(sub(joints[foot]!.at, joints[lower]!.at));
        const toTarget = sub(target, a);
        const near = Math.abs(upperLen - lowerLen) + 1e-4, far = upperLen + lowerLen - 1e-4;
        // Out of reach it stretches straight toward the target; the report cannot say so per frame, the strip shows it.
        const span = Math.max(near, Math.min(far, length(toTarget)));
        const along = normalize(toTarget);
        const bent = sub(b, add(a, scale(along, dot(sub(b, a), along))));
        const hint = track.pole ?? (length(bent) > upperLen * 0.01 ? bent : [0, 0, 1] as Vec3);
        let side = sub(hint, scale(along, dot(hint, along)));
        if (length(side) < 1e-6) side = sub([1, 0, 0], scale(along, along[0]));
        const toKnee = (upperLen * upperLen - lowerLen * lowerLen + span * span) / (2 * span);
        const out = Math.sqrt(Math.max(0, upperLen * upperLen - toKnee * toKnee));
        const knee = add(add(a, scale(along, toKnee)), scale(normalize(side), out));
        const end = add(a, scale(along, span));
        const upperWorld = quatMul(rotationBetween(sub(b, a), sub(knee, a)), world[upper]!.q);
        // Where the foot would now be, carried by the upper bone, is what the lower bone turns from.
        const carried = rotateBy(rotationBetween(sub(b, a), sub(knee, a)), sub(c, b));
        const lowerWorld = quatMul(rotationBetween(carried, sub(end, knee)), quatMul(rotationBetween(sub(b, a), sub(knee, a)), world[lower]!.q));
        const held = track.rotate ? at(track.rotate, track) : [0, 0, 0] as Vec3;
        const footWorld = eulerToQuat(held[0], held[1], held[2]);
        const parentWorld = above >= 0 ? world[above]!.q : [0, 0, 0, 1] as Quat;
        local[upper] = { ...local[upper]!, q: quatMul(conjugate(parentWorld), upperWorld) };
        local[lower] = { ...local[lower]!, q: quatMul(conjugate(upperWorld), lowerWorld) };
        local[foot] = { ...local[foot]!, q: quatMul(conjugate(lowerWorld), footWorld) };
        world = toWorld(joints, local);
    }
    return { local, world };
}

/** Where each joint is in a pose: for checking a foot landed. */
export function jointPositions(joints: readonly RigJoint[], animation: AnimationSource | null, time: number): Record<string, Vec3> {
    const { world } = poseAt(joints, animation, time);
    return Object.fromEntries(joints.map((j, i) => [j.name, world[i]!.origin]));
}

/** The surface's positions in a pose, skinned as the engine skins it. */
export function posedPositions(mesh: PolyMesh, joints: readonly RigJoint[], skin: SkinWeights, animation: AnimationSource | null, time: number): Vec3[] {
    const pose = poseAt(joints, animation, time).world;
    return mesh.positions.map((p, v) => {
        let out: Vec3 = [0, 0, 0];
        for (let k = 0; k < 4; k++) {
            const w = skin.weights[v * 4 + k]!;
            if (w <= 0) continue;
            const j = skin.joints[v * 4 + k]!;
            const moved = add(rotateBy(pose[j]!.q, sub(p, joints[j]!.at)), pose[j]!.origin);
            out = add(out, scale(moved, w));
        }
        return out;
    });
}

/** The bones as lines in a pose, for drawing over a view. */
export function boneLines(joints: readonly RigJoint[], animation: AnimationSource | null, time: number): [Vec3, Vec3][] {
    const pose = poseAt(joints, animation, time).world;
    return joints.flatMap((j, i) => (j.parent >= 0 ? [[pose[j.parent]!.origin, pose[i]!.origin] as [Vec3, Vec3]] : []));
}

// ---- Products -------------------------------------------------------------------

interface Keyframe { time: number; value: number; inTangent: 0; outTangent: 0; interpolation: 'linear' }

/** A clip as an `.estimeline`: sampled, since the engine interpolates each rotation component on its own and a few keys would cut corners. */
export function timelineOf(animation: AnimationSource, joints: readonly RigJoint[], shapeNames: readonly string[] = []): Record<string, unknown> {
    const loop = animation.loop !== false;
    const frames = Math.max(2, Math.ceil(animation.duration * SAMPLE_RATE) + 1);
    const times = Array.from({ length: frames }, (_, i) => (i / (frames - 1)) * animation.duration);
    const pathOf = (i: number): string => {
        const parts: string[] = [];
        for (let at = i; at >= 0; at = joints[at]!.parent) parts.unshift(joints[at]!.name);
        return parts.join('/');
    };
    // Every joint the clip turns, a reach's two bones among them: they have no keys of their own, only the solved pose.
    const turned = new Set<number>();
    const moved = new Set<number>();
    for (const track of animation.tracks ?? []) {
        const index = joints.findIndex((j) => j.name === track.joint);
        if (track.rotate || track.reach) turned.add(index);
        if (track.move) moved.add(index);
        if (track.reach) {
            turned.add(joints[index]!.parent);
            turned.add(joints[joints[index]!.parent]!.parent);
        }
    }
    const poses = times.map((t) => poseAt(joints, animation, t).local);
    const tracks = joints.flatMap((joint, index) => {
        if (!turned.has(index) && !moved.has(index)) return [];
        const channels: { property: string; keyframes: Keyframe[] }[] = [];
        const push = (property: string, values: number[]): void => {
            channels.push({ property, keyframes: values.map((value, f) => ({ time: times[f]!, value, inTangent: 0, outTangent: 0, interpolation: 'linear' })) });
        };
        if (turned.has(index)) {
            let last: Quat | null = null;
            const qs = poses.map((pose) => {
                let q = pose[index]!.q;
                // The short way round between samples: the two signs of a quaternion are one rotation, and interpolated apart they spin the long way.
                if (last && q[0] * last[0] + q[1] * last[1] + q[2] * last[2] + q[3] * last[3] < 0) q = [-q[0], -q[1], -q[2], -q[3]];
                last = q;
                return q;
            });
            ['x', 'y', 'z', 'w'].forEach((c, k) => push(`rotation.${c}`, qs.map((q) => q[k]!)));
        }
        if (moved.has(index)) {
            ['x', 'y', 'z'].forEach((c, k) => push(`position.${c}`, poses.map((pose) => pose[index]!.offset[k]!)));
        }
        return [{ type: 'property', name: joint.name, childPath: pathOf(index), component: 'Transform', channels }];
    });
    const shaped = animation.shapes?.length ? [{
        type: 'property', name: 'shapes', childPath: '', component: 'MeshMorph',
        channels: animation.shapes.map((track) => ({
            // By index: the component holds a list, and a name lives with the geometry.
            property: `weights.${shapeNames.indexOf(track.name)}`,
            keyframes: times.map((t) => ({ time: t, value: shapeWeightsAt([track.name], animation, t)[0]!, inTangent: 0, outTangent: 0, interpolation: 'linear' })),
        })),
    }] : [];
    return { version: TIMELINE_FORMAT_VERSION, type: 'timeline', duration: animation.duration, wrapMode: loop ? 'loop' : 'once', tracks: [...tracks, ...shaped] };
}

/**
 * The prefab that draws and moves it: the mesh on the root, the joints below it as
 * entities named so a clip's paths find them, and a player for the first clip.
 */
export function prefabOf(name: string, meshPath: string, joints: readonly RigJoint[], cullBackfaces: boolean, firstClip: string | null, controller: string | null = null, extra: { goals?: readonly RigGoal[]; shapes?: number } = {}): Record<string, unknown> {
    const idOf = (i: number): string => `j${i}`;
    const goals = extra.goals ?? [];
    const entities: Record<string, unknown>[] = [{
        prefabEntityId: 'root', name, parent: null,
        children: [...joints.flatMap((j, i) => (j.parent < 0 ? [idOf(i)] : [])), ...goals.flatMap((g, i) => (g.parent === undefined ? [`g${i}`] : []))],
        visible: true,
        components: [
            { type: 'Transform', data: {} },
            { type: 'MeshRenderer', data: { mesh: meshPath, lit: true, opaque: true, cullBackfaces, enabled: true } },
            ...(joints.length ? [{ type: 'MeshSkin', data: { joints: joints.map((_, i) => idOf(i)) } }] : []),
            ...(extra.shapes ? [{ type: 'MeshMorph', data: { weights: Array.from({ length: extra.shapes }, () => 0) } }] : []),
            // A controller decides what plays; a player beside it would fight it for the same joints.
            ...(controller ? [{ type: 'Animator', data: { controller, enabled: true } }]
                : firstClip ? [{ type: 'TimelinePlayer', data: { timeline: firstClip, playing: true } }] : []),
        ],
    }];
    joints.forEach((j, i) => {
        const rest = j.parent >= 0 ? sub(j.at, joints[j.parent]!.at) : j.at;
        entities.push({
            prefabEntityId: idOf(i), name: j.name, parent: j.parent >= 0 ? idOf(j.parent) : 'root',
            children: [...j.children.map(idOf), ...goals.flatMap((g, k) => (g.parent === j.name ? [`g${k}`] : []))], visible: true,
            components: [{ type: 'Transform', data: { position: { x: rest[0], y: rest[1], z: rest[2] } } }],
        });
    });
    goals.forEach((g, i) => {
        const parent = g.parent === undefined ? -1 : joints.findIndex((j) => j.name === g.parent);
        const rest = parent >= 0 ? sub(g.at, joints[parent]!.at) : g.at;
        entities.push({
            prefabEntityId: `g${i}`, name: g.name, parent: parent >= 0 ? idOf(parent) : 'root', children: [], visible: true,
            components: [{ type: 'Transform', data: { position: { x: rest[0], y: rest[1], z: rest[2] } } }],
        });
    });
    return { version: PREFAB_FORMAT_VERSION, name, rootEntityId: 'root', entities };
}

// ---- Controller -----------------------------------------------------------------

export interface ControllerTransition {
    to: string;
    /** Every one must hold. Left out, it leaves as soon as `afterClip` lets it. */
    when?: readonly { param: string; op: 'gt' | 'lt' | 'eq' | 'neq' | 'true' | 'false' | 'trigger'; value?: number }[];
    /** Seconds to cross-fade. */
    blend?: number;
    /** Only once the state's clip has finished. */
    afterClip?: boolean;
}

export interface ControllerState {
    name: string;
    /** The animation it plays. */
    clip?: string;
    /** Or one chosen by a float: idle, walk, run as speed rises. */
    blend?: { parameter: string; stops: readonly { value: number; clip: string }[] };
    speed?: number;
    transitions?: readonly ControllerTransition[];
}

export interface ControllerSource {
    parameters?: readonly { name: string; type: 'float' | 'bool' | 'trigger'; default?: number | boolean }[];
    initial: string;
    states: readonly ControllerState[];
    /** Checked from every state first: a hit reaction, a death. */
    any?: readonly ControllerTransition[];
    /** Run on what the clips say, every frame: a hand reaching for a goal, a head turning to it. */
    ik?: readonly ControllerIk[];
}

export interface ControllerIk {
    kind: 'two-bone' | 'look-at';
    /** The joint the chain ends at. */
    tip: string;
    /** A joint or a rig goal it reaches or looks at. */
    target: string;
    pole?: string;
    weight?: number;
    /** A float parameter scaling the weight, to fade it in. */
    parameter?: string;
    /** look-at: which of the tip's own axes points at the target. */
    axis?: 'x' | 'y' | 'z';
}

/** What is wrong with a source's `controller`, or null. */
export function checkController(raw: unknown, animations: unknown, rig?: RigSource): string | null {
    const c = raw as Record<string, unknown>;
    if (typeof raw !== 'object' || raw === null) return 'controller must be { parameters?, initial, states, any? }';
    for (const key of Object.keys(c)) if (!['parameters', 'initial', 'states', 'any', 'ik'].includes(key)) return `controller has an unknown field "${key}"; it takes parameters, initial, states, any, ik`;
    if (!Array.isArray(animations) || animations.length === 0) return 'a controller plays animations, and this source has none';
    const clips = new Set((animations as AnimationSource[]).map((a) => a.name));
    const params = new Map<string, string>();
    for (const p of (c.parameters ?? []) as Record<string, unknown>[]) {
        if (typeof p.name !== 'string' || !['float', 'bool', 'trigger'].includes(p.type as string)) return 'a controller parameter is { name, type: float | bool | trigger, default? }';
        if (params.has(p.name)) return `there are two parameters called "${p.name}"`;
        params.set(p.name, p.type as string);
    }
    if (!Array.isArray(c.states) || c.states.length === 0) return 'a controller needs states';
    const states = new Set<string>();
    for (const s of c.states as ControllerState[]) {
        if (typeof s.name !== 'string' || !s.name) return 'every controller state needs a name';
        if (states.has(s.name)) return `there are two states called "${s.name}"`;
        states.add(s.name);
    }
    if (!states.has(c.initial as string)) return `initial ${JSON.stringify(c.initial)} is not a state; there are ${[...states].join(', ')}`;
    const needClip = (clip: unknown, where: string): string | null => (clips.has(clip as string) ? null : `${where} plays ${JSON.stringify(clip)}, which is not an animation; there are ${[...clips].join(', ')}`);
    const checkTransitions = (list: unknown, where: string): string | null => {
        if (list === undefined) return null;
        if (!Array.isArray(list)) return `${where}: transitions must be an array`;
        for (const t of list as ControllerTransition[]) {
            for (const key of Object.keys(t)) if (!['to', 'when', 'blend', 'afterClip'].includes(key)) return `${where}: a transition has an unknown field "${key}"; it takes to, when, blend, afterClip`;
            if (!states.has(t.to)) return `${where}: a transition goes to "${t.to}", which is not a state; there are ${[...states].join(', ')}`;
            for (const w of t.when ?? []) {
                const type = params.get(w.param);
                if (!type) return `${where}: a condition reads "${w.param}", which is not a parameter; declare it in parameters`;
                if (!['gt', 'lt', 'eq', 'neq', 'true', 'false', 'trigger'].includes(w.op)) return `${where}: op ${JSON.stringify(w.op)} must be gt, lt, eq, neq, true, false or trigger`;
                if (['gt', 'lt', 'eq', 'neq'].includes(w.op) && (type !== 'float' || !isNum(w.value))) return `${where}: ${w.op} compares a float parameter with a number \`value\``;
                if ((w.op === 'true' || w.op === 'false') && type !== 'bool') return `${where}: ${w.op} reads a bool parameter, and "${w.param}" is a ${type}`;
                if (w.op === 'trigger' && type !== 'trigger') return `${where}: trigger reads a trigger parameter, and "${w.param}" is a ${type}`;
            }
        }
        return null;
    };
    for (const s of c.states as ControllerState[]) {
        for (const key of Object.keys(s)) if (!['name', 'clip', 'blend', 'speed', 'transitions'].includes(key)) return `state "${s.name}" has an unknown field "${key}"; it takes name, clip, blend, speed, transitions`;
        if ((s.clip === undefined) === (s.blend === undefined)) return `state "${s.name}" needs exactly one of clip, blend`;
        if (s.clip !== undefined) { const bad = needClip(s.clip, `state "${s.name}"`); if (bad) return bad; }
        if (s.blend) {
            if (params.get(s.blend.parameter) !== 'float') return `state "${s.name}": a blend is chosen by a float parameter, and "${s.blend.parameter}" is not one`;
            if (!Array.isArray(s.blend.stops) || s.blend.stops.length === 0) return `state "${s.name}": a blend needs stops`;
            for (const stop of s.blend.stops) { const bad = needClip(stop.clip, `state "${s.name}"`); if (bad) return bad; }
        }
        const bad = checkTransitions(s.transitions, `state "${s.name}"`);
        if (bad) return bad;
    }
    const anyBad = checkTransitions(c.any, 'any');
    if (anyBad) return anyBad;
    if (c.ik !== undefined) {
        if (!Array.isArray(c.ik)) return 'controller.ik must be an array';
        const list = rig ? resolveJoints(rig) : [];
        const jointNames = new Set(list.map((j) => j.name));
        const known = new Set([...jointNames, ...(rig?.goals ?? []).map((g) => g.name)]);
        const every = [...known].join(', ') || '(none)';
        for (const k of c.ik as ControllerIk[]) {
            for (const key of Object.keys(k)) if (!['kind', 'tip', 'target', 'pole', 'weight', 'parameter', 'axis'].includes(key)) return `an ik constraint has an unknown field "${key}"; it takes kind, tip, target, pole, weight, parameter, axis`;
            if (k.kind !== 'two-bone' && k.kind !== 'look-at') return `an ik constraint's kind ${JSON.stringify(k.kind)} must be two-bone or look-at`;
            if (!jointNames.has(k.tip)) return `an ik constraint's tip "${k.tip}" is not a joint; there are ${[...jointNames].join(', ')}`;
            if (!known.has(k.target)) return `an ik constraint's target "${k.target}" is not a joint or a goal; there are ${every}`;
            if (k.pole !== undefined && !known.has(k.pole)) return `an ik constraint's pole "${k.pole}" is not a joint or a goal; there are ${every}`;
            if (k.kind === 'two-bone') {
                const tip = list.find((j) => j.name === k.tip)!;
                if (tip.parent < 0 || list[tip.parent]!.parent < 0) return `two-bone ik needs two bones above "${k.tip}"`;
            }
            if (k.weight !== undefined && !isNum(k.weight)) return 'an ik constraint\'s weight must be a number';
            if (k.parameter !== undefined && params.get(k.parameter) !== 'float') return `an ik constraint's parameter "${k.parameter}" must be a float parameter`;
            if (k.axis !== undefined && !['x', 'y', 'z'].includes(k.axis)) return 'an ik constraint\'s axis must be x, y or z';
        }
    }
    return null;
}

/** A controller as an `.esanimator`. @p clipFile turns an animation's name into the file it plays, as written beside this one. */
export function controllerOf(source: ControllerSource, animations: readonly AnimationSource[], clipFile: (name: string) => string, rig?: RigSource): Record<string, unknown> {
    const joints = rig ? resolveJoints(rig) : [];
    const pathTo = (name: string): string => {
        const goal = rig?.goals?.find((g) => g.name === name);
        const owner = goal ? goal.parent : name;
        const parts = goal ? [goal.name] : [];
        for (let at = owner === undefined ? -1 : joints.findIndex((j) => j.name === owner); at >= 0; at = joints[at]!.parent) parts.unshift(joints[at]!.name);
        return parts.join('/');
    };
    const motionOf = (clip: string, speed?: number): Record<string, unknown> => ({
        kind: 'timeline', clip: clipFile(clip),
        loop: animations.find((a) => a.name === clip)?.loop !== false,
        ...(speed !== undefined ? { speed } : {}),
    });
    const transition = (t: ControllerTransition): Record<string, unknown> => ({
        to: t.to,
        conditions: (t.when ?? []).map((w) => (w.value !== undefined ? { param: w.param, op: w.op, value: w.value } : { param: w.param, op: w.op })),
        ...(t.blend !== undefined ? { duration: t.blend } : {}),
        ...(t.afterClip ? { hasExitTime: true } : {}),
    });
    return {
        version: ANIMATOR_FORMAT_VERSION,
        parameters: (source.parameters ?? []).map((p) => ({ ...p })),
        initialState: source.initial,
        ...(source.any ? { anyStateTransitions: source.any.map(transition) } : {}),
        // An engine constraint names joints the way a clip does: by path from the root.
        ...(source.ik ? { ik: source.ik.map((k) => ({ ...k, tip: pathTo(k.tip), target: pathTo(k.target), ...(k.pole ? { pole: pathTo(k.pole) } : {}) })) } : {}),
        states: source.states.map((s, i) => ({
            name: s.name, x: 80 + (i % 4) * 220, y: 80 + Math.floor(i / 4) * 140,
            motion: s.blend
                ? { kind: 'blend1d', parameter: s.blend.parameter, thresholds: s.blend.stops.map((stop) => ({ value: stop.value, motion: motionOf(stop.clip, s.speed) })) }
                : motionOf(s.clip!, s.speed),
            transitions: (s.transitions ?? []).map(transition),
        })),
    };
}

/** One bind matrix per joint: a joint's bind pose is unrotated, so each is only the way back to its rest position. */
export function bindMatrices(joints: readonly RigJoint[]): Float32Array {
    const out = new Float32Array(joints.length * 16);
    joints.forEach((j, i) => {
        out.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -j.at[0], -j.at[1], -j.at[2], 1], i * 16);
    });
    return out;
}

/** A colour for a joint, far from its neighbours in the list. */
export function jointColor(index: number): readonly [number, number, number, number] {
    const h = (index * 0.618034) % 1;
    const c = (n: number): number => {
        const k = (n + h * 6) % 6;
        return 0.85 - 0.7 * Math.max(0, Math.min(k, 4 - k, 1));
    };
    return [c(5), c(3), c(1), 1];
}
