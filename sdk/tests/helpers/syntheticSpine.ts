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

/**
 * The clip polygon for a relation. The rectangles are the point: they put a
 * known number of quads across the boundary rather than however many a circle's
 * circumference happens to touch.
 */
function clipShape(options: SyntheticOptions): number[] {
    const { relation } = options;
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
    const clip = clipShape(options);
    const json = {
        skeleton: { spine: '3.8.55', hash: 'synthetic', width: STRIP_WIDTH, height: STRIP_HEIGHT },
        bones: [{ name: 'root' }],
        slots: [
            { name: 'clip', bone: 'root', attachment: 'clip' },
            { name: 'mesh', bone: 'root', attachment: 'mesh' },
        ],
        skins: [{
            name: 'default',
            attachments: {
                clip: {
                    clip: { type: 'clipping', end: 'mesh', vertexCount: clip.length / 2, vertices: clip },
                },
                mesh: {
                    mesh: {
                        type: 'mesh', path: 'white',
                        uvs: mesh.uvs, triangles: mesh.triangles, vertices: mesh.vertices,
                        hull: mesh.hull, width: STRIP_WIDTH, height: STRIP_HEIGHT,
                    },
                },
            },
        }],
        animations: { idle: {} },
    };
    return { json: JSON.stringify(json), atlas: ATLAS };
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
