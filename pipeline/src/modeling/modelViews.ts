// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  modelViews.ts — a contact sheet of a model, drawn on the CPU.
 *
 *        Each view is drawn twice: shaded with its hard edges, and as a bare
 *        silhouette under it. The silhouette is not decoration. Faults in a blockout
 *        (a limb too thin, a gap, a wrong proportion) have survived every lit view
 *        and shown at once in outline, because shading gives the eye something else
 *        to read.
 *
 *        Orthographic and at one scale across all panels, so sizes compare between
 *        them. On the CPU rather than through the engine so what it shows depends on
 *        the mesh alone: no scene, camera, lights or GPU, and a test can read it.
 *        What the model looks like in the game is what `screenshot` is for.
 */
import type { BakedModel } from './modelBake';
import { boneLines, jointColor, morphedPositions, posedPositions, shapeWeightsAt, type AnimationSource, type PoseSolve, type PreviewGround } from './rig';
import { add, boundsOf, collectEdges, cross, dot, faceNormal, normalize, selectFaces, sub, type FaceSelector, type PolyMesh, type Vec3 } from './polyMesh';

export const MODEL_VIEWS = {
    front: { right: [1, 0, 0], up: [0, 1, 0], toward: [0, 0, 1] },
    back: { right: [-1, 0, 0], up: [0, 1, 0], toward: [0, 0, -1] },
    right: { right: [0, 0, -1], up: [0, 1, 0], toward: [1, 0, 0] },
    left: { right: [0, 0, 1], up: [0, 1, 0], toward: [-1, 0, 0] },
    top: { right: [1, 0, 0], up: [0, 0, -1], toward: [0, 1, 0] },
    bottom: { right: [1, 0, 0], up: [0, 0, 1], toward: [0, -1, 0] },
    iso: isoBasis([1, 0.8, 1]),
    'iso-left': isoBasis([-1, 0.8, 1]),
    'iso-back': isoBasis([1, 0.8, -1]),
    'iso-low': isoBasis([1, -0.5, 1]),
} as const satisfies Record<string, { right: Vec3; up: Vec3; toward: Vec3 }>;

export type ModelViewName = keyof typeof MODEL_VIEWS;
export const DEFAULT_MODEL_VIEWS: readonly ModelViewName[] = ['front', 'right', 'top', 'iso'];

function isoBasis(from: Vec3): { right: Vec3; up: Vec3; toward: Vec3 } {
    const toward = normalize(from);
    const right = normalize(cross([0, 1, 0], toward));
    return { right, up: cross(toward, right), toward };
}

export interface ModelSheet {
    width: number;
    height: number;
    /** RGBA, row by row from the top. */
    rgba: Uint8Array;
    /** Which view each column is, left to right; the top row is shaded, the bottom row is silhouette. */
    views: readonly ModelViewName[];
    /** World units per pixel, the same in every panel. */
    unitsPerPixel: number;
}

const PAPER = [236, 236, 236] as const;
const SILHOUETTE = [20, 20, 20] as const;
const WIRE = [30, 30, 30] as const;
const GUTTER = [120, 120, 120] as const;

/** What a rig's views add: lines drawn over the shaded row, and the box to frame so a strip of poses shares one scale. */
export interface SheetExtras {
    overlay?: readonly (readonly [Vec3, Vec3])[];
    frame?: { min: Vec3; max: Vec3 };
}

const BONE = [255, 140, 0] as const;

/** Lays the views out as columns over two rows, each panel `panel` pixels square. */
export function renderModelSheet(model: BakedModel, views: readonly ModelViewName[] = DEFAULT_MODEL_VIEWS, panel = 384, focus?: FaceSelector, wire = false, extra: SheetExtras = {}): ModelSheet {
    if (views.length === 0) throw new Error('name at least one view');
    for (const v of views) {
        if (!(v in MODEL_VIEWS)) throw new Error(`unknown view "${v}"; there are ${Object.keys(MODEL_VIEWS).join(', ')}`);
    }
    const { poly, triangles } = model;
    let framed: Iterable<number> | undefined;
    if (focus !== undefined) {
        const hit = selectFaces(poly, focus);
        if (hit.length === 0) throw new Error(`focus ${JSON.stringify(focus)} matched no face`);
        framed = new Set(hit.flatMap((f) => poly.faces[f]!.v));
    }
    const { min, max } = extra.frame ?? boundsOf(poly, framed);
    const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    // The bounding sphere's diameter fits every view, the iso one included.
    const diameter = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
    const unitsPerPixel = diameter / (panel * 0.92);

    const width = views.length * panel + (views.length - 1);
    const height = panel * 2 + 1;
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
        rgba[i * 4] = GUTTER[0]; rgba[i * 4 + 1] = GUTTER[1]; rgba[i * 4 + 2] = GUTTER[2]; rgba[i * 4 + 3] = 255;
    }
    const put = (x: number, y: number, c: readonly number[]): void => {
        const at = (y * width + x) * 4;
        rgba[at] = c[0]!; rgba[at + 1] = c[1]!; rgba[at + 2] = c[2]!; rgba[at + 3] = 255;
    };
    const normals = poly.faces.map((f) => faceNormal(poly, f));
    // A skin is shaded by its vertices, or a fine grid reads as gravel and hides the form being judged.
    const vertexNormals: (Vec3 | undefined)[] = [];
    poly.faces.forEach((f, i) => {
        if (!f.smooth) return;
        for (const v of f.v) vertexNormals[v] = add(vertexNormals[v] ?? [0, 0, 0], normals[i]!);
    });
    for (let i = 0; i < vertexNormals.length; i++) if (vertexNormals[i]) vertexNormals[i] = normalize(vertexNormals[i]!);
    const depth = new Float32Array(panel * panel);
    // The edges a shape actually has. Every polygon edge on a curved surface or a cut's triangles is a net over what is being judged, so that is on request.
    const FEATURE = Math.cos((30 * Math.PI) / 180);
    const lines = [...collectEdges(poly).values()].filter((e) => {
        if (e.faces.every((f) => poly.faces[f]!.smooth)) return false;
        return wire || e.faces.length !== 2 || dot(normals[e.faces[0]!]!, normals[e.faces[1]!]!) < FEATURE;
    });

    views.forEach((name, column) => {
        const basis = MODEL_VIEWS[name];
        const ox = column * (panel + 1);
        const toScreen = (p: Vec3): [number, number, number] => {
            const q = sub(p, center);
            return [panel / 2 + dot(q, basis.right) / unitsPerPixel, panel / 2 - dot(q, basis.up) / unitsPerPixel, dot(q, basis.toward)];
        };
        const screen = poly.positions.map(toScreen);
        depth.fill(-Infinity);
        for (let y = 0; y < panel; y++) {
            for (let x = 0; x < panel; x++) { put(ox + x, y, PAPER); put(ox + x, panel + 1 + y, PAPER); }
        }
        for (const { v, face } of triangles) {
            const [a, b, c] = [screen[v[0]]!, screen[v[1]]!, screen[v[2]]!];
            const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
            if (Math.abs(area) < 1e-9) continue;
            const flat = normals[face]!;
            const skin = poly.faces[face]!.smooth;
            const [na, nb, nc] = skin ? [vertexNormals[v[0]]!, vertexNormals[v[1]]!, vertexNormals[v[2]]!] : [flat, flat, flat];
            const facing = dot(flat, basis.toward);
            // A key from over the viewer's shoulder, so that facing faces still differ.
            const keyDir = normalize([basis.toward[0] + basis.up[0] * 0.5 + basis.right[0] * 0.4,
                                      basis.toward[1] + basis.up[1] * 0.5 + basis.right[1] * 0.4,
                                      basis.toward[2] + basis.up[2] * 0.5 + basis.right[2] * 0.4]);
            const tint = poly.faces[face]!.color ?? [0.82, 0.82, 0.82, 1];
            const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
            const x1 = Math.min(panel - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
            const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
            const y1 = Math.min(panel - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
            for (let y = y0; y <= y1; y++) {
                for (let x = x0; x <= x1; x++) {
                    const px = x + 0.5, py = y + 0.5;
                    const w0 = ((b[0] - px) * (c[1] - py) - (c[0] - px) * (b[1] - py)) / area;
                    const w1 = ((c[0] - px) * (a[1] - py) - (a[0] - px) * (c[1] - py)) / area;
                    const w2 = 1 - w0 - w1;
                    if (w0 < 0 || w1 < 0 || w2 < 0) continue;
                    put(ox + x, panel + 1 + y, SILHOUETTE);
                    const z = w0 * a[2] + w1 * b[2] + w2 * c[2];
                    if (z <= depth[y * panel + x]!) continue;
                    depth[y * panel + x] = z;
                    const nx = w0 * na[0] + w1 * nb[0] + w2 * nc[0], ny = w0 * na[1] + w1 * nb[1] + w2 * nc[1], nz = w0 * na[2] + w1 * nb[2] + w2 * nc[2];
                    const len = Math.hypot(nx, ny, nz) || 1;
                    const key = (nx * keyDir[0] + ny * keyDir[1] + nz * keyDir[2]) / len;
                    const light = facing > 0 ? 0.3 + 0.7 * Math.max(0, key) : 0.12; // a face seen from behind reads dark
                    put(ox + x, y, [tint[0]! * light * 255, tint[1]! * light * 255, tint[2]! * light * 255]);
                }
            }
        }
        // Polygon edges, on top of whatever they are not behind: what tells a person how the surface is built.
        const bias = unitsPerPixel * 2;
        for (const edge of lines) {
            const a = screen[edge.a]!, b = screen[edge.b]!;
            const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))));
            for (let s = 0; s <= steps; s++) {
                const t = s / steps;
                const x = Math.floor(a[0] + (b[0] - a[0]) * t), y = Math.floor(a[1] + (b[1] - a[1]) * t);
                if (x < 0 || y < 0 || x >= panel || y >= panel) continue;
                if (a[2] + (b[2] - a[2]) * t + bias < depth[y * panel + x]!) continue;
                put(ox + x, y, WIRE);
            }
        }
        // On top of everything: a bone is inside the body, which is the point of showing it.
        for (const [from, to] of extra.overlay ?? []) {
            const a = toScreen(from), b = toScreen(to);
            const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))));
            for (let s = 0; s <= steps; s++) {
                const t = s / steps;
                for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]] as const) {
                    const x = Math.floor(a[0] + (b[0] - a[0]) * t) + dx, y = Math.floor(a[1] + (b[1] - a[1]) * t) + dy;
                    if (x >= 0 && y >= 0 && x < panel && y < panel) put(ox + x, y, BONE);
                }
            }
        }
    });
    return { width, height, rgba, views, unitsPerPixel };
}

/** The ways to look at a rigged model. */
export interface RigViewOptions {
    views?: readonly ModelViewName[];
    panel?: number;
    /** Draws this clip. With `times`, a strip of one view at each. */
    animation?: string;
    times?: readonly number[];
    /** The controller's IK, run as the game runs it. Default on where the model has one. */
    ik?: boolean;
    /** A flat test ground, for foot-plants: in the game they ask physics. Drawn in orange. */
    ground?: PreviewGround;
    /** Shows this shape at full weight. */
    shape?: string;
    /** Colours each face by the joint moving it most, or fades all but one joint's reach. */
    weights?: boolean | string;
    /** Draws the bones over the shaded row. Default true on a rigged model. */
    skeleton?: boolean;
    focus?: FaceSelector;
    wire?: boolean;
}

/** One sheet for a model that moves: at rest, a clip at some moments, a shape, or who moves what. */
export function renderRigSheet(model: BakedModel, animations: readonly AnimationSource[], o: RigViewOptions = {}): ModelSheet {
    const panel = o.panel ?? 384;
    const rig = model.rig;
    const names = model.shapes?.names ?? [];
    if (!rig && o.weights) throw new Error('this model has no rig');
    if (o.shape !== undefined && !names.includes(o.shape)) throw new Error(`no shape "${o.shape}"; there are ${names.join(', ') || '(none)'}`);
    if (!rig && !names.length && o.animation) throw new Error('this model has no rig');
    let drawn = model;
    if (rig && o.weights !== undefined && o.weights !== false) {
        const { joints, skin } = rig;
        const only = typeof o.weights === 'string' ? joints.findIndex((j) => j.name === o.weights) : -1;
        if (typeof o.weights === 'string' && only < 0) throw new Error(`no joint "${o.weights}"; there are ${joints.map((j) => j.name).join(', ')}`);
        const faces = model.poly.faces.map((face) => {
            const totals = joints.map(() => 0);
            for (const v of face.v) for (let k = 0; k < 4; k++) totals[skin.joints[v * 4 + k]!]! += skin.weights[v * 4 + k]!;
            if (only >= 0) {
                const w = totals[only]! / face.v.length;
                return { ...face, color: [0.15 + w * 0.85, 0.15, 0.15 + (1 - w) * 0.5, 1] as const };
            }
            return { ...face, color: jointColor(totals.indexOf(Math.max(...totals))) };
        });
        drawn = { ...model, poly: { ...model.poly, faces } };
    }
    const anim = o.animation === undefined ? null : animations.find((a) => a.name === o.animation);
    if (o.animation !== undefined && !anim) throw new Error(`no animation "${o.animation}"; there are ${animations.map((a) => a.name).join(', ') || '(none)'}`);
    const skeleton = rig !== undefined && o.skeleton !== false;
    const solve: PoseSolve | undefined = rig?.ik?.length && o.ik !== false ? { ik: rig.ik, goals: rig.goals ?? [], ...(o.ground ? { ground: o.ground } : {}) } : undefined;
    const groundLines = (): [Vec3, Vec3][] => {
        if (!o.ground) return [];
        const { min, max } = boundsOf(model.poly);
        const [sx, sz] = o.ground.slope ?? [0, 0];
        const h = o.ground.height ?? 0;
        const spot = (x: number, z: number): Vec3 => [x, h + sx * x + sz * z, z];
        const pad = (max[0] - min[0] + (max[2] - min[2])) * 0.15;
        const [a, b, c, d] = [spot(min[0] - pad, min[2] - pad), spot(max[0] + pad, min[2] - pad), spot(max[0] + pad, max[2] + pad), spot(min[0] - pad, max[2] + pad)];
        return [[a, b], [b, c], [c, d], [d, a]];
    };
    const overlayAt = (time: number): [Vec3, Vec3][] => [...(skeleton ? boneLines(rig!.joints, anim ?? null, time, solve) : []), ...groundLines()];
    const weightsAt = (time: number): number[] => (o.shape !== undefined ? names.map((n) => (n === o.shape ? 1 : 0)) : shapeWeightsAt(names, anim ?? null, time));
    const posed = (time: number): BakedModel => {
        const shaped: PolyMesh = model.shapes ? { ...model.poly, positions: morphedPositions(model.poly, model.shapes.deltas, weightsAt(time)) } : model.poly;
        return { ...drawn, poly: { ...drawn.poly, positions: rig ? posedPositions(shaped, rig.joints, rig.skin, anim ?? null, time, solve) : shaped.positions } };
    };
    if (!anim) {
        return renderModelSheet(posed(0), o.views ?? DEFAULT_MODEL_VIEWS, panel, o.focus, o.wire === true, { overlay: overlayAt(0) });
    }
    const times = o.times ?? Array.from({ length: 4 }, (_, i) => (i / 4) * anim.duration);
    if (times.length === 0) throw new Error('`times` names no moment');
    if (times.length * panel > 2048) throw new Error(`${times.length} panels of ${panel} is too wide a strip; use fewer or a smaller size`);
    const view = o.views?.[0] ?? 'iso';
    // One frame for all of them, so what moves in the strip is the model and not the camera.
    const poses = times.map(posed);
    const framedBy = o.focus === undefined ? poses.flatMap((m) => m.poly.positions)
        : poses.flatMap((m) => selectFaces(m.poly, o.focus!).flatMap((f) => m.poly.faces[f]!.v.map((v) => m.poly.positions[v]!)));
    if (framedBy.length === 0) throw new Error(`focus ${JSON.stringify(o.focus)} matched no face`);
    const frame = boundsOf({ positions: framedBy, faces: [] });
    const sheets = poses.map((m, i) => renderModelSheet(m, [view], panel, undefined, o.wire === true, {
        frame, overlay: overlayAt(times[i]!),
    }));
    const width = times.length * panel + (times.length - 1);
    const height = sheets[0]!.height;
    const rgba = new Uint8Array(width * height * 4);
    sheets.forEach((s, i) => {
        for (let y = 0; y < height; y++) {
            rgba.set(s.rgba.subarray(y * s.width * 4, (y + 1) * s.width * 4), (y * width + i * (panel + 1)) * 4);
        }
    });
    return { width, height, rgba, views: times.map(() => view), unitsPerPixel: sheets[0]!.unitsPerPixel };
}
