// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    syntheticSpine.ts
 * @brief   Spine skeletons authored to hold one thing constant and vary another.
 *
 * @details Clipping cost cannot be read off shipped assets: coin's clip polygon
 *          has 39 vertices around 20 generated vertices, so every axis moves at
 *          once. These build a skeleton with a chosen number of input triangles
 *          and a chosen clip polygon, and place the two so that a KNOWN share of
 *          the triangles fall inside, outside, or across the boundary.
 *
 *          The mesh is one row of quads, which is what makes the share
 *          controllable: a rectangle that spans the row but not its height
 *          crosses every quad, one that ends midway crosses one.
 */

/** A 3.8 skeleton and the atlas its attachments resolve against. */
export interface SyntheticSkeleton {
    json: string;
    atlas: string;
}

/** Where the clip polygon sits relative to the strip of quads. */
export type ClipRelation = 'inside' | 'outside' | 'one-crossing' | 'all-crossing' | 'notched';

export interface SyntheticOptions {
    /** Quads in the row; the mesh has twice this many triangles. */
    quads: number;
    relation: ClipRelation;
    /** Vertices on the clip polygon. Ignored for the rectangle relations. */
    polygonVertices?: number;
    /** A star rather than a regular polygon — concave, so it decomposes. */
    concave?: boolean;
    /** Authored the other way round, to separate convexity from winding. */
    reverseWinding?: boolean;
    /**
     * Shapes a proof must decline. Both are NEAR-degenerate rather than exactly
     * so: an exactly repeated point and an exactly collinear triple both give a
     * cross product of zero, which any test catches. These are the ones only a
     * tolerance catches.
     */
    degenerate?: 'near-repeated-point' | 'near-collinear';
    /**
     * A pentagram — every turn agrees in sign, so a proof that only checks the
     * turns calls it convex. It is not: the edges cross.
     */
    selfIntersecting?: boolean;
    /** A second skin whose mesh is four times the size of the default's. */
    hugeSkin?: boolean;
    /** A second animation that carries the strip far from where the first does. */
    farAnimation?: boolean;
    /** An animation that deforms the polygon from convex to concave at 0.5s. */
    deformToConcave?: boolean;
}

const STRIP_WIDTH = 800;
const STRIP_HEIGHT = 100;

/** One row of quads spanning [-W/2, W/2] x [-H/2, H/2]. */
function strip(quads: number): { vertices: number[]; uvs: number[]; triangles: number[]; hull: number } {
    const vertices: number[] = [];
    const uvs: number[] = [];
    const triangles: number[] = [];
    const step = STRIP_WIDTH / quads;
    for (let i = 0; i <= quads; i++) {
        const x = -STRIP_WIDTH / 2 + i * step;
        vertices.push(x, -STRIP_HEIGHT / 2, x, STRIP_HEIGHT / 2);
        uvs.push(i / quads, 1, i / quads, 0);
    }
    for (let i = 0; i < quads; i++) {
        const a = i * 2;
        triangles.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
    return { vertices, uvs, triangles, hull: (quads + 1) * 2 };
}

/** A closed polygon, counter-clockwise; a star alternates two radii. */
function polygon(vertexCount: number, radius: number, concave: boolean): number[] {
    const out: number[] = [];
    for (let i = 0; i < vertexCount; i++) {
        const angle = (i / vertexCount) * Math.PI * 2;
        const r = concave && i % 2 === 1 ? radius * 0.4 : radius;
        out.push(Math.cos(angle) * r, Math.sin(angle) * r);
    }
    return out;
}

/** The same ring, with the shapes a convexity proof has to decline folded in. */
function degeneratePolygon(kind: 'near-repeated-point' | 'near-collinear', radius: number): number[] {
    const ring = polygon(8, radius, false);
    // Several float32 ulps of the coordinates, and still small enough that the
    // cross product lands inside the proof's tolerance. Below that window the
    // offset rounds away and the points come out EXACTLY collinear.
    const nudge = radius * 4e-7;
    if (kind === 'near-repeated-point') {
        return [ring[0] + nudge, ring[1] + nudge, ...ring];
    }
    // Two points along one edge, bulged OUTWARD by a hair. The polygon stays
    // convex and every turn keeps its sign, so nothing but the tolerance can
    // decline it — which is the whole point of putting it here.
    const [ax, ay] = [ring[0], ring[1]];
    const [bx, by] = [ring[2], ring[3]];
    const out = (t: number): number[] => {
        const x = ax + (bx - ax) * t;
        const y = ay + (by - ay) * t;
        const scale = 1 + nudge / Math.hypot(x, y);
        return [x * scale, y * scale];
    };
    return [ax, ay, ...out(1 / 3), ...out(2 / 3), ...ring.slice(2)];
}

/** A pentagram: five points, visited every other one, so the edges cross. */
function pentagram(radius: number): number[] {
    const out: number[] = [];
    for (let step = 0; step < 5; step++) {
        const angle = ((step * 2) % 5 / 5) * Math.PI * 2;
        out.push(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    return out;
}

/**
 * The clip polygon for a relation. The rectangles are the point: they put a
 * known number of quads across the boundary rather than however many a circle's
 * circumference happens to touch.
 */
function clipShape(options: SyntheticOptions): number[] {
    const { relation } = options;
    if (options.degenerate) {
        return degeneratePolygon(options.degenerate, STRIP_WIDTH * 1.5);
    }
    if (options.selfIntersecting) {
        return pentagram(STRIP_WIDTH * 1.5);
    }
    if (options.polygonVertices !== undefined) {
        // Big enough that even a star's inner radius clears the strip's corners,
        // so "inside" means inside whatever the shape is.
        if (relation === 'inside') {
            return polygon(options.polygonVertices, STRIP_WIDTH * 1.5, options.concave ?? false);
        }
        // The polygon axis: same relation for every vertex count — a shape that
        // covers the strip's width and cuts through its height.
        return polygon(options.polygonVertices, STRIP_WIDTH, options.concave ?? false)
            .map((v, i) => (i % 2 === 1 ? v * (STRIP_HEIGHT / 4 / STRIP_WIDTH) : v));
    }
    const halfW = STRIP_WIDTH / 2;
    const halfH = STRIP_HEIGHT / 2;
    switch (relation) {
        case 'inside':
            return [-halfW * 4, -halfH * 4, halfW * 4, -halfH * 4, halfW * 4, halfH * 4, -halfW * 4, halfH * 4];
        case 'outside':
            return [-halfW, halfH * 20, halfW, halfH * 20, halfW, halfH * 40, -halfW, halfH * 40];
        case 'one-crossing':
            // Ends inside the middle quad, and is tall enough to clear the strip.
            return [-halfW * 4, -halfH * 4, 0.5, -halfH * 4, 0.5, halfH * 4, -halfW * 4, halfH * 4];
        case 'all-crossing':
            // Spans the whole row but only its middle band, so every quad is cut.
            return [-halfW * 4, -halfH / 2, halfW * 4, -halfH / 2, halfW * 4, halfH / 2, -halfW * 4, halfH / 2];
        case 'notched':
            // Concave, but only clear of the strip: a rectangle with a bite out
            // of its top edge at x 600..1000, where the strip ends at 400. So
            // nothing of the strip is outside the region, and it is still cut.
            return [
                -halfW * 4, -halfH * 8, halfW * 4, -halfH * 8, halfW * 4, halfH * 8,
                halfW * 2.5, halfH * 8, halfW * 2.5, halfH * 4, halfW * 1.5, halfH * 4,
                halfW * 1.5, halfH * 8, -halfW * 4, halfH * 8,
            ];
    }
}

/** A skeleton whose only slots are one clip region and one mesh inside it. */
export function syntheticSkeleton(options: SyntheticOptions): SyntheticSkeleton {
    const mesh = strip(options.quads);
    let clip = clipShape(options);
    if (options.reverseWinding) {
        const reversed: number[] = [];
        for (let i = clip.length - 2; i >= 0; i -= 2) reversed.push(clip[i], clip[i + 1]);
        clip = reversed;
    }
    const json = {
        skeleton: { spine: '3.8.55', hash: 'synthetic', width: STRIP_WIDTH, height: STRIP_HEIGHT },
        bones: [{ name: 'root' }],
        slots: [
            { name: 'clip', bone: 'root', attachment: 'clip' },
            { name: 'mesh', bone: 'root', attachment: 'mesh' },
        ],
        skins: skinsOf(options, mesh, clip),
        animations: options.deformToConcave ? { idle: concaveDeform(clip) }
            : options.farAnimation ? { near: {}, far: farTravel() } : { idle: {} },
    };
    return { json: JSON.stringify(json), atlas: ATLAS };
}

/** The default skin, and optionally a second one carrying a far bigger mesh. */
function skinsOf(options: SyntheticOptions, mesh: ReturnType<typeof strip>,
                 clip: number[]): unknown[] {
    const meshAttachment = (scale: number) => ({
        type: 'mesh', path: 'white',
        uvs: mesh.uvs, triangles: mesh.triangles,
        vertices: mesh.vertices.map((v) => v * scale),
        hull: mesh.hull, width: STRIP_WIDTH * scale, height: STRIP_HEIGHT * scale,
    });
    const skins: unknown[] = [{
        name: 'default',
        attachments: { clip: { clip: { type: 'clipping', end: 'mesh', vertexCount: clip.length / 2, vertices: clip } },
                       mesh: { mesh: meshAttachment(1) } },
    }];
    if (options.hugeSkin) {
        skins.push({ name: 'huge', attachments: { mesh: { mesh: meshAttachment(4) } } });
    }
    return skins;
}

/** A bone translation that takes the whole strip well outside the setup pose. */
function farTravel(): Record<string, unknown> {
    return {
        bones: { root: { translate: [{ time: 0, x: 0, y: 0 }, { time: 0.5, x: STRIP_WIDTH, y: STRIP_HEIGHT * 4 }] } },
    };
}

/**
 * A deform timeline that pulls one vertex of the clip polygon inward, so the
 * same attachment is convex at rest and concave half a second later. Nothing a
 * convexity proof may answer once and remember.
 */
function concaveDeform(clip: number[]): Record<string, unknown> {
    const deltas = new Array(clip.length).fill(0);
    const inward = 1.6;
    deltas[2] = -clip[2] * inward;
    deltas[3] = -clip[3] * inward;
    return {
        deform: {
            default: { clip: { clip: [{ time: 0 }, { time: 0.5, offset: 0, vertices: deltas }] } },
        },
    };
}

const ATLAS = `
synthetic.png
size: 64,64
format: RGBA8888
filter: Linear,Linear
repeat: none
white
  rotate: false
  xy: 0, 0
  size: 64, 64
  orig: 64, 64
  offset: 0, 0
  index: -1
`;
