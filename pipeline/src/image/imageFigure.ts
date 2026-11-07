// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    imageFigure.ts
 * @brief   A real human body, posed and seen from an angle, flattened to what a 2D picture can draw over.
 *
 * Coordinates typed blind drift: a body comes out wide or stiff and nothing says so. This is the 3D body the modeling tools build,
 * so its proportions and its foreshortening are right from any side, and what is reported is where each joint landed in the picture.
 */
import { humanoid, type HumanoidBuild } from '../modeling/humanoid';
import { poseJoints, poseStep, type PoseParams } from '../modeling/pose';
import type { PolyMesh, Vec3 } from '../modeling/polyMesh';
import type { ImageLayer } from './imageSource';

/** The table's own height: figures are built at it, and sized in the picture. */
const BODY_HEIGHT = 1.6;
/** The lowest the body builds at. Finer costs seconds and shows nothing at picture scale. */
const BODY_RESOLUTION = 160;
const SUPERSAMPLE = 2;
const KEPT = 6;

export const FIGURE_TAGS = ['torso', 'arm', 'hand', 'leg', 'foot', 'neck', 'face', 'scalp', 'ear', 'lips', 'lid', 'eye', 'iris'] as const;
export const FIGURE_JOINTS = [
    'crown', 'head', 'neck', 'chest', 'spine', 'hips',
    'upperArm.L', 'forearm.L', 'hand.L', 'middle4.L', 'upperArm.R', 'forearm.R', 'hand.R', 'middle4.R',
    'thigh.L', 'shin.L', 'foot.L', 'toeTip.L', 'thigh.R', 'shin.R', 'foot.R', 'toeTip.R',
] as const;

/** Most recently used last, as building takes seconds and the same body is drawn again on every edit. */
const cache = new Map<string, unknown>();
function remembered<T>(key: string, make: () => T): T {
    if (cache.has(key)) {
        const value = cache.get(key) as T;
        cache.delete(key);
        cache.set(key, value);
        return value;
    }
    const value = make();
    cache.set(key, value);
    if (cache.size > KEPT) cache.delete(cache.keys().next().value as string);
    return value;
}

interface PosedBody { positions: readonly Vec3[]; normals: Float32Array; triangles: Uint32Array; tags: Uint8Array }

function bodyOf(build: HumanoidBuild, eyes: 'open' | 'closed' | undefined, pose: PoseParams): PosedBody {
    const buildKey = JSON.stringify({ build, eyes });
    return remembered(`posed:${buildKey}:${JSON.stringify(pose)}`, () => {
        const rest = remembered(`rest:${buildKey}`, () => humanoid({ positions: [], faces: [] } as PolyMesh, { ...build, height: BODY_HEIGHT, resolution: BODY_RESOLUTION, ...(eyes ? { eyes } : {}) }));
        const mesh = poseStep(rest, pose);
        let count = 0;
        for (const f of mesh.faces) count += f.v.length - 2;
        const triangles = new Uint32Array(count * 3);
        const tags = new Uint8Array(count);
        const normals = new Float32Array(mesh.positions.length * 3);
        let t = 0;
        for (const f of mesh.faces) {
            const tag = Math.max(0, FIGURE_TAGS.indexOf(f.tag as (typeof FIGURE_TAGS)[number]));
            for (let i = 1; i + 1 < f.v.length; i++, t++) {
                const [a, b, c] = [f.v[0]!, f.v[i]!, f.v[i + 1]!];
                triangles[t * 3] = a; triangles[t * 3 + 1] = b; triangles[t * 3 + 2] = c;
                tags[t] = tag;
                const [pa, pb, pc] = [mesh.positions[a]!, mesh.positions[b]!, mesh.positions[c]!];
                const [ux, uy, uz, vx, vy, vz] = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2], pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
                const [nx, ny, nz] = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
                for (const v of [a, b, c]) { normals[v * 3]! += nx; normals[v * 3 + 1]! += ny; normals[v * 3 + 2]! += nz; }
            }
        }
        for (let v = 0; v < mesh.positions.length; v++) {
            const len = Math.hypot(normals[v * 3]!, normals[v * 3 + 1]!, normals[v * 3 + 2]!) || 1;
            normals[v * 3]! /= len; normals[v * 3 + 1]! /= len; normals[v * 3 + 2]! /= len;
        }
        return { positions: mesh.positions, normals, triangles, tags };
    });
}

export interface FlatFigure {
    /** Coverage of the whole body in picture pixels, then of each kind of part as it shows. */
    mask: Float32Array;
    parts: Record<string, Float32Array>;
    /** Which way the surface faces at each pixel, x right, y up, z toward the viewer; zero off the body. */
    normals: Float32Array;
    /** Dark where one surface passes in front of another, for seeing the form through a guide. */
    contour: Float32Array;
    joints: Record<string, readonly [number, number]>;
    light: readonly [number, number, number];
}

const normalized = (v: readonly number[]): [number, number, number] => {
    const len = Math.hypot(v[0]!, v[1]!, v[2]!) || 1;
    return [v[0]! / len, v[1]! / len, v[2]! / len];
};

/** Flattens a `figure` layer. @p project takes a point in the picture before any group's transform, and @p scale is that transform's size. */
export function flattenFigure(layer: ImageLayer, w: number, h: number, project: (p: readonly [number, number]) => readonly [number, number], scale: number): FlatFigure {
    const [ax, ay] = project(layer.at!);
    const s = ((layer.height as number) / BODY_HEIGHT) * scale;
    const yaw = ((layer.yaw ?? 0) * Math.PI) / 180, pitch = ((layer.pitch ?? 0) * Math.PI) / 180;
    const [cy, sy, cp, sp] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch)];
    /** Yaw about the body, then pitch toward the viewer: what the body's axes are in the view. */
    const toView = (p: readonly number[]): [number, number, number] => {
        const [x, y, z] = [p[0]! * cy + p[2]! * sy, p[1]!, -p[0]! * sy + p[2]! * cy];
        return [x, y * cp - z * sp, y * sp + z * cp];
    };
    const fromView = (v: readonly number[]): [number, number, number] => {
        const [y, z] = [v[1]! * cp + v[2]! * sp, -v[1]! * sp + v[2]! * cp];
        return [v[0]! * cy - z * sy, y, v[0]! * sy + z * cy];
    };
    const build = (layer.build ?? {}) as HumanoidBuild;
    const pose = layer.pose ?? {};
    const held = { humanoid: build, ...(pose.rotate ? { rotate: pose.rotate } : {}), ...(pose.move ? { move: pose.move } : {}) } as PoseParams;
    // A reach given by two numbers is a place in the picture: where along the line of sight is where the joint already is.
    const reach = Object.entries(pose.reach ?? {}).map(([name, r]) => [name, r] as const);
    let resolved: PoseParams = held;
    if (reach.length) {
        const before = poseJoints(held);
        const entries = reach.map(([name, r]) => {
            if (!before[name]) throw new Error(`no joint "${name}"; there are ${Object.keys(before).join(', ')}`);
            const at = r.at.length === 3 ? r.at : fromView([(r.at[0]! - ax) / s, (ay - r.at[1]!) / s, toView(before[name]!)[2]]);
            return [name, { at, ...(r.pole ? { pole: r.pole } : {}) }] as const;
        });
        resolved = { ...held, reach: Object.fromEntries(entries) };
    }
    const body = bodyOf(build, layer.eyes, resolved);
    const placed = poseJoints(resolved);
    const joints: Record<string, readonly [number, number]> = {};
    for (const name of FIGURE_JOINTS) {
        const v = toView(placed[name]!);
        joints[name] = [Math.round(ax + v[0] * s), Math.round(ay - v[1] * s)];
    }

    const [W, H] = [w * SUPERSAMPLE, h * SUPERSAMPLE];
    const depth = new Float32Array(W * H).fill(-Infinity);
    const tagAt = new Int8Array(W * H).fill(-1);
    const nAt = new Float32Array(W * H * 3);
    const count = body.positions.length;
    const [sxs, sys, szs] = [new Float32Array(count), new Float32Array(count), new Float32Array(count)];
    for (let i = 0; i < count; i++) {
        const v = toView(body.positions[i]!);
        sxs[i] = (ax + v[0] * s) * SUPERSAMPLE; sys[i] = (ay - v[1] * s) * SUPERSAMPLE; szs[i] = v[2];
    }
    const viewNormals = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        const v = toView([body.normals[i * 3]!, body.normals[i * 3 + 1]!, body.normals[i * 3 + 2]!]);
        viewNormals[i * 3] = v[0]; viewNormals[i * 3 + 1] = v[1]; viewNormals[i * 3 + 2] = v[2];
    }
    for (let t = 0; t < body.tags.length; t++) {
        const [a, b, c] = [body.triangles[t * 3]!, body.triangles[t * 3 + 1]!, body.triangles[t * 3 + 2]!];
        const [x0, y0, x1, y1, x2, y2] = [sxs[a]!, sys[a]!, sxs[b]!, sys[b]!, sxs[c]!, sys[c]!];
        const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
        if (area === 0) continue;
        const [left, right] = [Math.max(0, Math.floor(Math.min(x0, x1, x2))), Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)))];
        const [top, bottom] = [Math.max(0, Math.floor(Math.min(y0, y1, y2))), Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)))];
        for (let y = top; y <= bottom; y++) {
            for (let x = left; x <= right; x++) {
                const [px, py] = [x + 0.5, y + 0.5];
                const w1 = ((px - x0) * (y2 - y0) - (x2 - x0) * (py - y0)) / area;
                const w2 = ((x1 - x0) * (py - y0) - (px - x0) * (y1 - y0)) / area;
                const w0 = 1 - w1 - w2;
                if (w0 < 0 || w1 < 0 || w2 < 0) continue;
                const z = w0 * szs[a]! + w1 * szs[b]! + w2 * szs[c]!;
                const i = y * W + x;
                if (z <= depth[i]!) continue;
                depth[i] = z;
                tagAt[i] = body.tags[t]!;
                for (let k = 0; k < 3; k++) nAt[i * 3 + k] = w0 * viewNormals[a * 3 + k]! + w1 * viewNormals[b * 3 + k]! + w2 * viewNormals[c * 3 + k]!;
            }
        }
    }
    const mask = new Float32Array(w * h);
    const normals = new Float32Array(w * h * 3);
    const contour = new Float32Array(w * h);
    const parts: Record<string, Float32Array> = Object.fromEntries(FIGURE_TAGS.map((tag) => [tag, new Float32Array(w * h)]));
    const share = 1 / (SUPERSAMPLE * SUPERSAMPLE);
    // How far one surface must stand in front of the next, in body units, to count as an edge of the form.
    const step = 0.012;
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = y * W + x, o = (y >> 1) * w + (x >> 1);
            const tag = tagAt[i]!;
            const right = x + 1 < W ? depth[i + 1]! : -Infinity, below = y + 1 < H ? depth[i + W]! : -Infinity;
            if (tag >= 0 || right > -Infinity || below > -Infinity) {
                const here = depth[i]!;
                if (Math.abs(here - right) > step || Math.abs(here - below) > step) contour[o] = Math.min(1, contour[o]! + share * 2);
            }
            if (tag < 0) continue;
            mask[o]! += share;
            parts[FIGURE_TAGS[tag]!]![o]! += share;
            for (let k = 0; k < 3; k++) normals[o * 3 + k]! += nAt[i * 3 + k]! * share;
        }
    }
    for (let o = 0; o < mask.length; o++) {
        const len = Math.hypot(normals[o * 3]!, normals[o * 3 + 1]!, normals[o * 3 + 2]!);
        if (len > 0) for (let k = 0; k < 3; k++) normals[o * 3 + k]! /= len;
    }
    return { mask, parts, normals, contour, joints, light: normalized(layer.light ?? [-0.5, 0.6, 0.6]) };
}

export const figureLight = normalized;
