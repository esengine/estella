// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    imageFigure.ts
 * @brief   A posed skeleton with plain volumes on it, seen from an angle: a figure drawing's first lines, for a 2D picture to build on.
 *
 * Bones and blocks on purpose. They give gesture, proportion and foreshortening, which coordinates typed blind get wrong, and no look:
 * no face, no skin, no hair, as whatever a model is handed it copies, and a coloured mannequin is what comes back.
 */
import type { HumanoidBuild } from '../modeling/humanoid';
import { poseFrames, poseJoints, type PoseParams } from '../modeling/pose';
import type { ImageLayer } from './imageSource';
import type { FlatFigure, ImageFigureDrawer } from './imageRaster';

export type { FlatFigure } from './imageRaster';

/** The bones' own height: they are built at it, and sized in the picture. */
const BODY_HEIGHT = 1.6;
const SUPERSAMPLE = 2;
const AROUND = 14;

type V3 = readonly [number, number, number];

export const FIGURE_TAGS = ['torso', 'arm', 'hand', 'leg', 'foot', 'neck', 'head'] as const;
export const FIGURE_JOINTS = [
    'crown', 'head', 'neck', 'chest', 'spine', 'hips',
    'upperArm.L', 'forearm.L', 'hand.L', 'middle4.L', 'upperArm.R', 'forearm.R', 'hand.R', 'middle4.R',
    'thigh.L', 'shin.L', 'foot.L', 'toeTip.L', 'thigh.R', 'shin.R', 'foot.R', 'toeTip.R',
] as const;
const BONES: readonly (readonly [string, string])[] = [
    ['hips', 'spine'], ['spine', 'chest'], ['chest', 'neck'], ['neck', 'head'], ['head', 'crown'],
    ['chest', 'upperArm.L'], ['upperArm.L', 'forearm.L'], ['forearm.L', 'hand.L'], ['hand.L', 'middle4.L'],
    ['chest', 'upperArm.R'], ['upperArm.R', 'forearm.R'], ['forearm.R', 'hand.R'], ['hand.R', 'middle4.R'],
    ['hips', 'thigh.L'], ['thigh.L', 'shin.L'], ['shin.L', 'foot.L'], ['foot.L', 'toeTip.L'],
    ['hips', 'thigh.R'], ['thigh.R', 'shin.R'], ['shin.R', 'foot.R'], ['foot.R', 'toeTip.R'],
];

interface Ring { at: V3; across: V3; deep: V3; a: number; d: number }
interface Volume { tag: (typeof FIGURE_TAGS)[number]; rings: Ring[] }

const plus = (p: V3, v: V3, k: number): V3 => [p[0] + v[0] * k, p[1] + v[1] * k, p[2] + v[2] * k];
const between = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const unit = (v: V3): V3 => {
    const len = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / len, v[1] / len, v[2] / len];
};
const crossed = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The blocks a figure drawing starts from, widths on a body 1.6 tall. */
function volumesOf(frames: ReturnType<typeof poseFrames>, build: HumanoidBuild): Volume[] {
    const f = (name: string) => frames[name]!;
    const [hips, spine, chest, neck, head] = [f('hips'), f('spine'), f('chest'), f('neck'), f('head')];
    const [wHips, wWaist, wChest, wShoulders, wLimbs, wHead] = [build.hips ?? 1, build.waist ?? 1, build.chest ?? 1, build.shoulders ?? 1, build.limbs ?? 1, build.head ?? 1];
    const volumes: Volume[] = [{
        tag: 'torso',
        rings: [
            { at: plus(hips.at, hips.y, -0.1), across: hips.x, deep: hips.z, a: 0.09 * wHips, d: 0.06 },
            { at: plus(hips.at, hips.y, -0.02), across: hips.x, deep: hips.z, a: 0.135 * wHips, d: 0.085 },
            { at: between(hips.at, spine.at, 0.6), across: spine.x, deep: spine.z, a: 0.112 * wWaist, d: 0.07 },
            { at: spine.at, across: spine.x, deep: spine.z, a: 0.1 * wWaist, d: 0.064 },
            { at: chest.at, across: chest.x, deep: chest.z, a: 0.128 * wChest, d: 0.09 },
            { at: between(chest.at, neck.at, 0.62), across: chest.x, deep: chest.z, a: 0.15 * wShoulders, d: 0.078 },
            { at: between(chest.at, neck.at, 0.92), across: chest.x, deep: chest.z, a: 0.075, d: 0.06 },
        ],
    }];
    const round = (at: V3, axis: V3, r: number): Ring => {
        const side = unit(crossed(axis, Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
        return { at, across: side, deep: unit(crossed(axis, side)), a: r * wLimbs, d: r * wLimbs };
    };
    const limb = (tag: Volume['tag'], names: readonly string[], radii: readonly number[]): void => {
        const points = names.map((n) => f(n).at);
        const rings: Ring[] = [];
        for (let i = 0; i < points.length; i++) {
            const axis = unit(i + 1 < points.length ? [points[i + 1]![0] - points[i]![0], points[i + 1]![1] - points[i]![1], points[i + 1]![2] - points[i]![2]] : [points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1], points[i]![2] - points[i - 1]![2]]);
            if (i === 0) rings.push(round(plus(points[0]!, axis, -radii[0]! * 0.8), axis, radii[0]! * 0.55));
            rings.push(round(points[i]!, axis, radii[i]!));
            if (i === points.length - 1) rings.push(round(plus(points[i]!, axis, radii[i]! * 0.8), axis, radii[i]! * 0.55));
        }
        volumes.push({ tag, rings });
    };
    for (const side of ['L', 'R']) {
        limb('arm', [`upperArm.${side}`, `forearm.${side}`, `hand.${side}`], [0.038, 0.029, 0.021]);
        limb('leg', [`thigh.${side}`, `shin.${side}`, `foot.${side}`], [0.072, 0.046, 0.03]);
        // A mitten and a wedge: where a hand and a foot go, and no fingers to copy.
        const [hand, tip] = [f(`hand.${side}`), f(`middle4.${side}`)];
        volumes.push({ tag: 'hand', rings: [
            { at: hand.at, across: hand.z, deep: hand.y, a: 0.026, d: 0.016 },
            { at: between(hand.at, tip.at, 0.45), across: hand.z, deep: hand.y, a: 0.04, d: 0.017 },
            { at: tip.at, across: hand.z, deep: hand.y, a: 0.022, d: 0.01 },
        ] });
        const [foot, toe] = [f(`foot.${side}`), f(`toeTip.${side}`)];
        const along = unit([toe.at[0] - foot.at[0], toe.at[1] - foot.at[1], toe.at[2] - foot.at[2]]);
        const flat = unit(crossed(along, [1, 0, 0]));
        volumes.push({ tag: 'foot', rings: [
            { at: plus(foot.at, along, -0.05), across: [1, 0, 0], deep: flat, a: 0.022, d: 0.026 },
            { at: foot.at, across: [1, 0, 0], deep: flat, a: 0.034, d: 0.04 },
            { at: between(foot.at, toe.at, 0.7), across: [1, 0, 0], deep: flat, a: 0.04, d: 0.022 },
            { at: toe.at, across: [1, 0, 0], deep: flat, a: 0.022, d: 0.01 },
        ] });
    }
    limb('neck', ['neck', 'head'], [0.042, 0.038]);
    // An egg, turned as the head is turned.
    const centre = between(head.at, f('crown').at, 0.46);
    const rings: Ring[] = [];
    for (let i = 0; i <= 8; i++) {
        const t = (i / 8) * 2 - 1, r = Math.sqrt(Math.max(0.0001, 1 - t * t));
        rings.push({ at: plus(plus(centre, head.y, t * 0.108 * wHead), head.z, 0.006), across: head.x, deep: head.z, a: 0.074 * wHead * r, d: 0.09 * wHead * r });
    }
    volumes.push({ tag: 'head', rings });
    return volumes;
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
    const toPicture = (p: readonly number[]): [number, number] => {
        const v = toView(p);
        return [ax + v[0] * s, ay - v[1] * s];
    };
    const build = (layer.build ?? {}) as HumanoidBuild;
    const pose = layer.pose ?? {};
    const held = { humanoid: build, ...(pose.rotate ? { rotate: pose.rotate } : {}), ...(pose.move ? { move: pose.move } : {}) } as PoseParams;
    // A reach given by two numbers is a place in the picture: where along the line of sight is where the joint already is.
    const reach = Object.entries(pose.reach ?? {});
    let resolved: PoseParams = held;
    if (reach.length) {
        const before = poseJoints(held);
        resolved = {
            ...held,
            reach: Object.fromEntries(reach.map(([name, r]) => {
                if (!before[name]) throw new Error(`no joint "${name}"; there are ${Object.keys(before).join(', ')}`);
                const at = r.at.length === 3 ? r.at : fromView([(r.at[0]! - ax) / s, (ay - r.at[1]!) / s, toView(before[name]!)[2]]);
                return [name, { at, ...(r.pole ? { pole: r.pole } : {}) }];
            })),
        };
    }
    const frames = poseFrames(resolved);
    const joints: Record<string, readonly [number, number]> = {};
    for (const name of FIGURE_JOINTS) {
        const p = toPicture(frames[name]!.at);
        joints[name] = [Math.round(p[0]), Math.round(p[1])];
    }

    const [W, H] = [w * SUPERSAMPLE, h * SUPERSAMPLE];
    const depth = new Float32Array(W * H).fill(-Infinity);
    const tagAt = new Int8Array(W * H).fill(-1);
    const nAt = new Float32Array(W * H * 3);
    for (const volume of volumesOf(frames, build)) {
        const tag = FIGURE_TAGS.indexOf(volume.tag);
        const points: V3[] = [];
        for (const r of volume.rings) {
            for (let i = 0; i < AROUND; i++) {
                const t = (i / AROUND) * Math.PI * 2;
                points.push(plus(plus(r.at, r.across, Math.cos(t) * r.a), r.deep, Math.sin(t) * r.d));
            }
        }
        const quads: [number, number, number, number][] = [];
        for (let k = 0; k + 1 < volume.rings.length; k++) {
            for (let i = 0; i < AROUND; i++) {
                const [a, b] = [k * AROUND + i, k * AROUND + (i + 1) % AROUND];
                quads.push([a, b, b + AROUND, a + AROUND]);
            }
        }
        // Smooth across the block, whichever way the rings wind.
        const middle = volume.rings.reduce<V3>((m, r) => plus(m, r.at, 1 / volume.rings.length), [0, 0, 0]);
        const normals = points.map(() => [0, 0, 0] as [number, number, number]);
        for (const [a, b, c, d] of quads) {
            const [pa, pb, pc] = [points[a]!, points[b]!, points[c]!];
            let n = crossed([pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]]);
            const out: V3 = [pa[0] - middle[0], pa[1] - middle[1], pa[2] - middle[2]];
            if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) n = [-n[0], -n[1], -n[2]];
            for (const v of [a, b, c, d]) { normals[v]![0] += n[0]; normals[v]![1] += n[1]; normals[v]![2] += n[2]; }
        }
        const picture = points.map((p) => {
            const v = toView(p);
            return [(ax + v[0] * s) * SUPERSAMPLE, (ay - v[1] * s) * SUPERSAMPLE, v[2]] as const;
        });
        const facing = normals.map((n) => toView(unit(n)));
        const triangle = (a: number, b: number, c: number): void => {
            const [p0, p1, p2] = [picture[a]!, picture[b]!, picture[c]!];
            const area = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
            if (area === 0) return;
            const [left, right] = [Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0]))), Math.min(W - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0])))];
            const [top, bottom] = [Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1]))), Math.min(H - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1])))];
            for (let y = top; y <= bottom; y++) {
                for (let x = left; x <= right; x++) {
                    const [px, py] = [x + 0.5, y + 0.5];
                    const w1 = ((px - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (py - p0[1])) / area;
                    const w2 = ((p1[0] - p0[0]) * (py - p0[1]) - (px - p0[0]) * (p1[1] - p0[1])) / area;
                    const w0 = 1 - w1 - w2;
                    if (w0 < 0 || w1 < 0 || w2 < 0) continue;
                    const z = w0 * p0[2] + w1 * p1[2] + w2 * p2[2];
                    const i = y * W + x;
                    if (z <= depth[i]!) continue;
                    depth[i] = z;
                    tagAt[i] = tag;
                    for (let k = 0; k < 3; k++) nAt[i * 3 + k] = w0 * facing[a]![k]! + w1 * facing[b]![k]! + w2 * facing[c]![k]!;
                }
            }
        };
        for (const [a, b, c, d] of quads) { triangle(a, b, c); triangle(a, c, d); }
        // Ends closed flat: they are hidden in the block they meet, or small enough not to matter.
        for (const k of [0, volume.rings.length - 1]) {
            for (let i = 1; i + 1 < AROUND; i++) triangle(k * AROUND, k * AROUND + i, k * AROUND + i + 1);
        }
    }
    const mask = new Float32Array(w * h);
    const normals = new Float32Array(w * h * 3);
    const contour = new Float32Array(w * h);
    const parts: Record<string, Float32Array> = Object.fromEntries(FIGURE_TAGS.map((tag) => [tag, new Float32Array(w * h)]));
    const share = 1 / (SUPERSAMPLE * SUPERSAMPLE);
    // How far one block must stand in front of the next, in body units, to count as an edge.
    const step = 0.02;
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

    // The head's cross on the side it faces: its middle line, and the line the eyes sit on.
    const head = frames.head!, crown = frames.crown!;
    const centre = between(head.at, crown.at, 0.46);
    const wHead = build.head ?? 1;
    const cross = (at: (t: number) => V3): (readonly [number, number])[] => Array.from({ length: 13 }, (_, i) => toPicture(at((i / 12) * Math.PI - Math.PI / 2)));
    const lines = [
        ...BONES.map(([a, b]) => [toPicture(frames[a]!.at), toPicture(frames[b]!.at)]),
        cross((t) => plus(plus(centre, head.y, Math.sin(t) * 0.108 * wHead), head.z, Math.cos(t) * 0.09 * wHead + 0.006)),
        cross((t) => plus(plus(plus(centre, head.y, -0.018 * wHead), head.x, Math.sin(t) * 0.074 * wHead), head.z, Math.cos(t) * 0.088 * wHead + 0.006)),
    ];
    return { mask, parts, normals, contour, joints, lines, light: normalized(layer.light ?? [-0.5, 0.6, 0.6]) };
}

export const figureLight = normalized;

/** The drawer of figures the pipeline hands every picture it renders. */
export const FIGURE_DRAWER: ImageFigureDrawer = { flatten: flattenFigure };
