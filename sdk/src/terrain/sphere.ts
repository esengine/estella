// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    sphere.ts
 * @brief   Ground on a sphere: which squares of a cube's faces to draw, and where a square's point stands on the planet.
 *
 * @details A planet is a cube whose six faces are each a quadtree, with every point pushed out onto the sphere: a node is a square of a face
 *          (`level`, `ix`, `iz`), drawn with the same patch as flat ground, and its points are cut by distance exactly as the flat quadtree's
 *          are (quadtree.ts), only the distance is to the node's bounding sphere and the top of the tree is six faces round the planet's centre.
 *
 *          A face is (u, v) in -1 to 1. The point on the cube is `normal + tan(u * PI / 4) * a + tan(v * PI / 4) * b`, normalised: the tangent
 *          spreads the squares evenly by angle, so a node's size on the ground varies by a third from the middle of a face to its corner and not
 *          by two; it is closed in both directions (`direction` and `faceOf`), which is what lets a point be named by the face it is on.
 *
 *          Nothing here touches a renderer or a terrain: positions are in the planet's own space, its centre the origin and its radius `radius`.
 */

/** The six faces of the cube: the outward normal, and the directions u and v grow along. Each is a right-handed frame (a x b = normal). */
export const FACES: readonly { normal: readonly [number, number, number]; a: readonly [number, number, number]; b: readonly [number, number, number] }[] = [
    { normal: [1, 0, 0], a: [0, 0, -1], b: [0, 1, 0] },
    { normal: [-1, 0, 0], a: [0, 0, 1], b: [0, 1, 0] },
    { normal: [0, 1, 0], a: [1, 0, 0], b: [0, 0, -1] },
    { normal: [0, -1, 0], a: [1, 0, 0], b: [0, 0, 1] },
    { normal: [0, 0, 1], a: [1, 0, 0], b: [0, 1, 0] },
    { normal: [0, 0, -1], a: [-1, 0, 0], b: [0, 1, 0] },
];

/** One square of a face: its level (0 the finest), its place in that level's grid on the face, and the face. */
export interface SphereNode {
    face: number;
    level: number;
    ix: number;
    iz: number;
}

/** What the tree is cut by. */
export interface SphereTreeParams {
    /** The planet's radius, in metres. */
    radius: number;
    /** The ground's least and most height above the radius: the vertical extent every node's bound is measured with. */
    minHeight: number;
    maxHeight: number;
    /** The side of a level-0 node, in metres along the ground. */
    leafSize: number;
    /** The distance within which level 0 is drawn; each level's is twice the one below's. */
    range0: number;
}

const QUARTER_PI = Math.PI / 4;

/** The unit direction from the planet's centre to the point (u, v) of a face. */
export function direction(face: number, u: number, v: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
    const f = FACES[face]!;
    const tu = Math.tan(u * QUARTER_PI), tv = Math.tan(v * QUARTER_PI);
    const x = f.normal[0] + tu * f.a[0] + tv * f.b[0];
    const y = f.normal[1] + tu * f.a[1] + tv * f.b[1];
    const z = f.normal[2] + tu * f.a[2] + tv * f.b[2];
    const len = Math.hypot(x, y, z);
    out[0] = x / len; out[1] = y / len; out[2] = z / len;
    return out;
}

/** The face a direction falls on and where on it: the inverse of `direction`. */
export function faceOf(dx: number, dy: number, dz: number): { face: number; u: number; v: number } {
    const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
    let face: number;
    if (ax >= ay && ax >= az) face = dx >= 0 ? 0 : 1;
    else if (ay >= az) face = dy >= 0 ? 2 : 3;
    else face = dz >= 0 ? 4 : 5;
    const f = FACES[face]!;
    const n = dx * f.normal[0] + dy * f.normal[1] + dz * f.normal[2];
    const a = dx * f.a[0] + dy * f.a[1] + dz * f.a[2];
    const b = dx * f.b[0] + dy * f.b[1] + dz * f.b[2];
    return { face, u: Math.atan(a / n) / QUARTER_PI, v: Math.atan(b / n) / QUARTER_PI };
}

/** Where a direction falls on a given face's plane, in the face's units (beyond -1 to 1 past its edge); null for a direction that does not face it. */
export function facePlace(face: number, dx: number, dy: number, dz: number): { u: number; v: number } | null {
    const f = FACES[face]!;
    const n = dx * f.normal[0] + dy * f.normal[1] + dz * f.normal[2];
    if (n <= 1e-6) return null;
    const a = dx * f.a[0] + dy * f.a[1] + dz * f.a[2];
    const b = dx * f.b[0] + dy * f.b[1] + dz * f.b[2];
    return { u: Math.atan(a / n) / QUARTER_PI, v: Math.atan(b / n) / QUARTER_PI };
}

/** The side of a node of `level` on its face, in the face's -1 to 1 units. */
export const nodeSpan = (levels: number, level: number): number => 2 / 2 ** (levels - 1 - level);

/** How many levels a planet needs so that the finest node is about `leafSize` metres a side (to the nearest power of two): the top level's node is a whole face. */
export function levelsFor(radius: number, leafSize: number): number {
    // A face's middle spans a quarter turn of the great circle, radius * PI / 2 along its side.
    return Math.max(1, Math.round(Math.log2(Math.max(radius * Math.PI / 2 / Math.max(leafSize, 1e-6), 1))) + 1);
}

/** The corner of a node, in its face's units: u0, v0 and the span. */
export function nodeRect(levels: number, node: SphereNode): { u0: number; v0: number; span: number } {
    const span = nodeSpan(levels, node.level);
    return { u0: -1 + node.ix * span, v0: -1 + node.iz * span, span };
}

/** The point of a node on the planet at (s, t) in 0 to 1 across it, at `height` above the radius, in the planet's space. */
export function nodePoint(p: SphereTreeParams, levels: number, node: SphereNode, s: number, t: number, height: number,
                          out: [number, number, number] = [0, 0, 0]): [number, number, number] {
    const { u0, v0, span } = nodeRect(levels, node);
    direction(node.face, u0 + s * span, v0 + t * span, out);
    const r = p.radius + height;
    out[0] *= r; out[1] *= r; out[2] *= r;
    return out;
}

/**
 * A sphere that holds every point of the node whatever the ground's height is: centred on the node's middle at the middle of the height range,
 * as far across as the node's corners and the full height range between them.
 */
export function nodeBound(p: SphereTreeParams, levels: number, node: SphereNode): { x: number; y: number; z: number; r: number } {
    const mid = (p.minHeight + p.maxHeight) / 2, half = (p.maxHeight - p.minHeight) / 2;
    const c = nodePoint(p, levels, node, 0.5, 0.5, mid);
    let r = 0;
    const corner: [number, number, number] = [0, 0, 0];
    for (const [s, t] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
        for (const h of [p.minHeight, p.maxHeight]) {
            nodePoint(p, levels, node, s, t, h, corner);
            r = Math.max(r, Math.hypot(corner[0] - c[0], corner[1] - c[1], corner[2] - c[2]));
        }
    }
    return { x: c[0], y: c[1], z: c[2], r: Math.max(r, half) };
}

/**
 * How far the eye is from a node, measured on the shell of ground at the eye's own height (held to the ground's range): a node under the eye is at no
 * distance however high or low the ground there turns out to be, as a flat node's box is for an eye between its least and most height. A bound that
 * held the whole height range would be a few hundred metres across even for the finest node and split everything near it a level too far.
 */
export function nodeDistance(p: SphereTreeParams, levels: number, node: SphereNode, ex: number, ey: number, ez: number): number {
    const rho = Math.hypot(ex, ey, ez);
    const h = Math.min(Math.max(rho - p.radius, p.minHeight), p.maxHeight);
    const f = FACES[node.face]!;
    const n = (ex * f.normal[0] + ey * f.normal[1] + ez * f.normal[2]) / rho;
    const point: [number, number, number] = [0, 0, 0];
    if (n > 1e-6) {
        // The eye is over this node's face: the nearest place of the node is the eye's own place on the face held to the node's square, as a flat
        // node's box is measured. Under the node it is the eye's own place and the distance is the height between them.
        const u = Math.atan(((ex * f.a[0] + ey * f.a[1] + ez * f.a[2]) / rho) / n) / QUARTER_PI;
        const v = Math.atan(((ex * f.b[0] + ey * f.b[1] + ez * f.b[2]) / rho) / n) / QUARTER_PI;
        const { u0, v0, span } = nodeRect(levels, node);
        direction(node.face, Math.min(Math.max(u, u0), u0 + span), Math.min(Math.max(v, v0), v0 + span), point);
        const r = p.radius + h;
        return Math.hypot(ex - point[0] * r, ey - point[1] * r, ez - point[2] * r);
    }
    // Behind the face: the middle of the node and its reach, which is far enough off that the looseness does not matter.
    const c = nodePoint(p, levels, node, 0.5, 0.5, h);
    let r = 0;
    for (const [s, t] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
        nodePoint(p, levels, node, s, t, h, point);
        r = Math.max(r, Math.hypot(point[0] - c[0], point[1] - c[1], point[2] - c[2]));
    }
    return Math.max(Math.hypot(ex - c[0], ey - c[1], ez - c[2]) - r, 0);
}

/** The range of level `level`: where its nodes end and the next level's begin. */
export const sphereRange = (p: Pick<SphereTreeParams, 'range0'>, level: number): number => p.range0 * 2 ** level;

/**
 * The nodes to draw for an eye at (ex, ey, ez) in the planet's space, coarse to fine. Every point of the planet is covered by exactly one node: a node
 * nearer the eye than the level below's range is split into its four children, and the six faces' top nodes are where it begins.
 */
export function selectSphereNodes(p: SphereTreeParams, ex: number, ey: number, ez: number, levels = levelsFor(p.radius, p.leafSize), finest = 0): SphereNode[] {
    const out: SphereNode[] = [];
    const floor = Math.min(Math.max(finest, 0), levels - 1);
    for (let face = 0; face < 6; face++) visit(p, levels, floor, { face, level: levels - 1, ix: 0, iz: 0 }, ex, ey, ez, out);
    return out;
}

function visit(p: SphereTreeParams, levels: number, finest: number, node: SphereNode, ex: number, ey: number, ez: number, out: SphereNode[]): void {
    if (node.level <= finest || nodeDistance(p, levels, node, ex, ey, ez) > sphereRange(p, node.level - 1)) {
        out.push(node);
        return;
    }
    for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) {
        visit(p, levels, finest, { face: node.face, level: node.level - 1, ix: node.ix * 2 + dx, iz: node.iz * 2 + dz }, ex, ey, ez, out);
    }
}

/** The node of `level` on `face` that holds (u, v). */
export function nodeAt(levels: number, face: number, level: number, u: number, v: number): SphereNode {
    const n = 2 ** (levels - 1 - level);
    const clamp = (x: number) => Math.min(Math.max(Math.floor((x + 1) / 2 * n), 0), n - 1);
    return { face, level, ix: clamp(u), iz: clamp(v) };
}

/** A key that names a node, for the pages and the children a terrain keeps by it. */
export const sphereNodeKey = (n: SphereNode): string => `${n.face}:${n.level}:${n.ix}:${n.iz}`;
