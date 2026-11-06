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
import { PREFAB_FORMAT_VERSION, TIMELINE_FORMAT_VERSION } from 'esengine';
import { add, boundsOf, cross, dot, length, scale, sub, type PolyMesh, type Vec3 } from './polyMesh';

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

export interface RigSource {
    joints: readonly RigJointSource[];
}

export interface AnimationTrack {
    joint: string;
    /** [time, x, y, z] in degrees, X then Y then Z, from the bind pose. */
    rotate?: readonly (readonly number[])[];
    /** [time, x, y, z] from where the joint rests. */
    move?: readonly (readonly number[])[];
    /** Shifts the keys by this fraction of the clip: the other leg, half a stride behind. */
    phase?: number;
}

export interface AnimationSource {
    name: string;
    duration: number;
    /** Default true. */
    loop?: boolean;
    tracks: readonly AnimationTrack[];
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

// ---- Validation -----------------------------------------------------------------

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const vec3 = (v: unknown): boolean => Array.isArray(v) && v.length === 3 && v.every(isNum);

/** What is wrong with a source's `rig`, or null. */
export function checkRig(raw: unknown): string | null {
    const r = raw as { joints?: unknown };
    if (typeof raw !== 'object' || raw === null || !Array.isArray(r.joints)) return 'rig must be { joints: [{ name, at, parent?, mirror? }] }';
    for (const key of Object.keys(raw)) if (key !== 'joints') return `rig has an unknown field "${key}"; it takes joints`;
    for (const [i, j] of (r.joints as Record<string, unknown>[]).entries()) {
        if (typeof j !== 'object' || j === null) return `rig joint ${i} must be an object`;
        for (const key of Object.keys(j)) if (!['name', 'at', 'parent', 'mirror'].includes(key)) return `rig joint ${i} has an unknown field "${key}"; a joint takes name, at, parent, mirror`;
        if (typeof j.name !== 'string' || !j.name) return `rig joint ${i} needs a name`;
        if (/[/\\]/.test(j.name)) return `rig joint "${j.name}": a name cannot hold a slash, which is how a clip addresses a joint`;
        if (!vec3(j.at)) return `rig joint "${j.name}": at must be [x, y, z]`;
        if (j.parent !== undefined && typeof j.parent !== 'string') return `rig joint "${j.name}": parent must be a joint's name`;
        if (j.mirror !== undefined && !['x', 'y', 'z'].includes(j.mirror as string)) return `rig joint "${j.name}": mirror must be x, y or z`;
    }
    try {
        resolveJoints(raw as RigSource);
    } catch (e) {
        return (e as Error).message;
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
export function checkAnimations(raw: unknown, rig: unknown): string | null {
    if (!Array.isArray(raw)) return 'animations must be an array';
    if (!rig) return 'animations move joints, and this source has no rig';
    const names = new Set(resolveJoints(rig as RigSource).map((j) => j.name));
    const seen = new Set<string>();
    for (const [i, a] of (raw as Record<string, unknown>[]).entries()) {
        if (typeof a !== 'object' || a === null) return `animation ${i} must be an object`;
        for (const key of Object.keys(a)) if (!['name', 'duration', 'loop', 'tracks'].includes(key)) return `animation ${i} has an unknown field "${key}"; it takes name, duration, loop, tracks`;
        if (typeof a.name !== 'string' || !/^[\w-]+$/.test(a.name)) return `animation ${i} needs a name of letters, digits, _ or -: it becomes a file name`;
        if (seen.has(a.name)) return `there are two animations called "${a.name}"`;
        seen.add(a.name);
        if (!isNum(a.duration) || a.duration <= 0) return `animation "${a.name}": duration must be positive seconds`;
        if (a.loop !== undefined && typeof a.loop !== 'boolean') return `animation "${a.name}": loop must be true or false`;
        if (!Array.isArray(a.tracks) || a.tracks.length === 0) return `animation "${a.name}" needs tracks`;
        const tracked = new Set<string>();
        for (const t of a.tracks as Record<string, unknown>[]) {
            for (const key of Object.keys(t)) if (!['joint', 'rotate', 'move', 'phase'].includes(key)) return `animation "${a.name}": a track has an unknown field "${key}"; it takes joint, rotate, move, phase`;
            if (!names.has(t.joint as string)) return `animation "${a.name}": no joint "${String(t.joint)}"; there are ${[...names].join(', ')}`;
            if (tracked.has(t.joint as string)) return `animation "${a.name}": two tracks for joint "${t.joint as string}"; put their keys in one`;
            tracked.add(t.joint as string);
            if (t.rotate === undefined && t.move === undefined) return `animation "${a.name}": the track for "${t.joint as string}" has neither rotate nor move`;
            for (const kind of ['rotate', 'move'] as const) {
                if (t[kind] === undefined) continue;
                const bad = checkKeys(t[kind], a.duration, `animation "${a.name}", ${t.joint as string}.${kind}`);
                if (bad) return bad;
            }
            if (t.phase !== undefined && !isNum(t.phase)) return `animation "${a.name}": phase must be a number`;
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
function sample(keys: readonly (readonly number[])[], time: number, duration: number, loop: boolean, phase: number): Vec3 {
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
    const [u2, u3] = [u * u, u * u * u];
    const v = [1, 2, 3].map((c) => {
        const [a, b] = [p1[c]!, p2[c]!];
        const m1 = ((b - p0[c]!) / Math.max(p2[0]! - p0[0]!, 1e-6)) * span;
        const m2 = ((p3[c]! - a) / Math.max(p3[0]! - p1[0]!, 1e-6)) * span;
        return (2 * u3 - 3 * u2 + 1) * a + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * b + (u3 - u2) * m2;
    });
    return v as unknown as Vec3;
}

/** Each joint's world rotation and origin at @p time; the bind pose with no animation. */
function poseAt(joints: readonly RigJoint[], animation: AnimationSource | null, time: number): { q: Quat; origin: Vec3 }[] {
    const out: { q: Quat; origin: Vec3 }[] = [];
    joints.forEach((j, i) => {
        const track = animation?.tracks.find((t) => t.joint === j.name);
        const loop = animation?.loop !== false;
        const euler = track?.rotate ? sample(track.rotate, time, animation!.duration, loop, track.phase ?? 0) : [0, 0, 0] as Vec3;
        const moved = track?.move ? sample(track.move, time, animation!.duration, loop, track.phase ?? 0) : [0, 0, 0] as Vec3;
        const local = eulerToQuat(euler[0], euler[1], euler[2]);
        const rest = j.parent >= 0 ? sub(j.at, joints[j.parent]!.at) : j.at;
        const offset = add(rest, moved);
        if (j.parent < 0) out[i] = { q: local, origin: offset };
        else {
            const p = out[j.parent]!;
            out[i] = { q: quatMul(p.q, local), origin: add(p.origin, rotateBy(p.q, offset)) };
        }
    });
    return out;
}

/** The surface's positions in a pose, skinned as the engine skins it. */
export function posedPositions(mesh: PolyMesh, joints: readonly RigJoint[], skin: SkinWeights, animation: AnimationSource | null, time: number): Vec3[] {
    const pose = poseAt(joints, animation, time);
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
    const pose = poseAt(joints, animation, time);
    return joints.flatMap((j, i) => (j.parent >= 0 ? [[pose[j.parent]!.origin, pose[i]!.origin] as [Vec3, Vec3]] : []));
}

// ---- Products -------------------------------------------------------------------

interface Keyframe { time: number; value: number; inTangent: 0; outTangent: 0; interpolation: 'linear' }

/** A clip as an `.estimeline`: sampled, since the engine interpolates each rotation component on its own and a few keys would cut corners. */
export function timelineOf(animation: AnimationSource, joints: readonly RigJoint[]): Record<string, unknown> {
    const loop = animation.loop !== false;
    const frames = Math.max(2, Math.ceil(animation.duration * SAMPLE_RATE) + 1);
    const times = Array.from({ length: frames }, (_, i) => (i / (frames - 1)) * animation.duration);
    const pathOf = (i: number): string => {
        const parts: string[] = [];
        for (let at = i; at >= 0; at = joints[at]!.parent) parts.unshift(joints[at]!.name);
        return parts.join('/');
    };
    const tracks = animation.tracks.map((track) => {
        const index = joints.findIndex((j) => j.name === track.joint);
        const joint = joints[index]!;
        const channels: { property: string; keyframes: Keyframe[] }[] = [];
        const push = (property: string, values: number[]): void => {
            channels.push({ property, keyframes: values.map((value, f) => ({ time: times[f]!, value, inTangent: 0, outTangent: 0, interpolation: 'linear' })) });
        };
        if (track.rotate) {
            let last: Quat | null = null;
            const qs = times.map((t) => {
                const e = sample(track.rotate!, t, animation.duration, loop, track.phase ?? 0);
                let q = eulerToQuat(e[0], e[1], e[2]);
                // The short way round between samples: the two signs of a quaternion are one rotation, and interpolated apart they spin the long way.
                if (last && q[0] * last[0] + q[1] * last[1] + q[2] * last[2] + q[3] * last[3] < 0) q = [-q[0], -q[1], -q[2], -q[3]];
                last = q;
                return q;
            });
            ['x', 'y', 'z', 'w'].forEach((c, k) => push(`rotation.${c}`, qs.map((q) => q[k]!)));
        }
        if (track.move) {
            const rest = joint.parent >= 0 ? sub(joint.at, joints[joint.parent]!.at) : joint.at;
            const ps = times.map((t) => add(rest, sample(track.move!, t, animation.duration, loop, track.phase ?? 0)));
            ['x', 'y', 'z'].forEach((c, k) => push(`position.${c}`, ps.map((p) => p[k]!)));
        }
        return { type: 'property', name: joint.name, childPath: pathOf(index), component: 'Transform', channels };
    });
    return { version: TIMELINE_FORMAT_VERSION, type: 'timeline', duration: animation.duration, wrapMode: loop ? 'loop' : 'once', tracks };
}

/**
 * The prefab that draws and moves it: the mesh on the root, the joints below it as
 * entities named so a clip's paths find them, and a player for the first clip.
 */
export function prefabOf(name: string, meshPath: string, joints: readonly RigJoint[], cullBackfaces: boolean, firstClip: string | null): Record<string, unknown> {
    const idOf = (i: number): string => `j${i}`;
    const entities: Record<string, unknown>[] = [{
        prefabEntityId: 'root', name, parent: null,
        children: joints.flatMap((j, i) => (j.parent < 0 ? [idOf(i)] : [])),
        visible: true,
        components: [
            { type: 'Transform', data: {} },
            { type: 'MeshRenderer', data: { mesh: meshPath, lit: true, opaque: true, cullBackfaces, enabled: true } },
            { type: 'MeshSkin', data: { joints: joints.map((_, i) => idOf(i)) } },
            ...(firstClip ? [{ type: 'TimelinePlayer', data: { timeline: firstClip, playing: true } }] : []),
        ],
    }];
    joints.forEach((j, i) => {
        const rest = j.parent >= 0 ? sub(j.at, joints[j.parent]!.at) : j.at;
        entities.push({
            prefabEntityId: idOf(i), name: j.name, parent: j.parent >= 0 ? idOf(j.parent) : 'root',
            children: j.children.map(idOf), visible: true,
            components: [{ type: 'Transform', data: { position: { x: rest[0], y: rest[1], z: rest[2] } } }],
        });
    });
    return { version: PREFAB_FORMAT_VERSION, name, rootEntityId: 'root', entities };
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
