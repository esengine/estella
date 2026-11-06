// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  modelViews.ts — a contact sheet of a model, drawn on the CPU.
 *
 *        Each view is drawn twice: shaded with its polygon edges, and as a bare
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
import { add, boundsOf, cross, dot, faceNormal, normalize, selectFaces, sub, type FaceSelector, type Vec3 } from './polyMesh';

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

/** Lays the views out as columns over two rows, each panel `panel` pixels square. */
export function renderModelSheet(model: BakedModel, views: readonly ModelViewName[] = DEFAULT_MODEL_VIEWS, panel = 384, focus?: FaceSelector): ModelSheet {
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
    const { min, max } = boundsOf(poly, framed);
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
        for (const face of poly.faces) {
            if (face.smooth) continue;
            for (let i = 0; i < face.v.length; i++) {
                const a = screen[face.v[i]!]!, b = screen[face.v[(i + 1) % face.v.length]!]!;
                const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))));
                for (let s = 0; s <= steps; s++) {
                    const t = s / steps;
                    const x = Math.floor(a[0] + (b[0] - a[0]) * t), y = Math.floor(a[1] + (b[1] - a[1]) * t);
                    if (x < 0 || y < 0 || x >= panel || y >= panel) continue;
                    if (a[2] + (b[2] - a[2]) * t + bias < depth[y * panel + x]!) continue;
                    put(ox + x, y, WIRE);
                }
            }
        }
    });
    return { width, height, rgba, views, unitsPerPixel };
}
