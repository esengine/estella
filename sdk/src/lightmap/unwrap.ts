// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    unwrap.ts
 * @brief   A second UV set for a mesh that has none — the whole unwrap, in order.
 *
 * Cut into flat charts, project each onto its own plane, scale them all by ONE
 * ratio, pack, split the vertices the cuts run through. A bake is read through
 * the result, so what it must guarantee is that no two surfaces share a texel —
 * which is exactly what the UV set the art is wrapped in does not.
 */

import { MeshChannel, MeshChannelType, type MeshData, type MeshChannelDesc } from '../asset/meshFormat';
import { buildCharts, weldByPosition, type Tri } from './charts';
import { packSkyline } from './pack';

export interface UnwrapOptions {
    /** Widest angle two neighbouring faces may differ by and stay one chart. */
    maxChartAngleDegrees?: number;
    /** Texels of empty space kept around every chart, at {@link atlasSize}. Two is
     *  the least that stops a bilinear tap reading the chart next door. */
    paddingTexels?: number;
    /** The atlas size the padding is reckoned against. Not stored anywhere: a UV
     *  set is resolution-independent, and this only fixes what "two texels" means. */
    atlasSize?: number;
}

export interface UnwrapResult {
    /** The mesh with a `TexCoord1` channel. Has MORE vertices than the input
     *  wherever a chart boundary runs through one — a vertex on a seam holds a
     *  different lightmap UV for each side of it. */
    mesh: MeshData;
    charts: number;
    /** Fraction of the unit square the charts occupy. What is left is the price
     *  of packing rectangles, and of the padding that keeps them apart. */
    coverage: number;
}

const DEFAULTS = { maxChartAngleDegrees: 60, paddingTexels: 2, atlasSize: 1024 };

function channelAt(channels: readonly MeshChannelDesc[], semantic: number): MeshChannelDesc | undefined {
    return channels.find((c) => c.semantic === semantic);
}

/** Positions as a tight `vertexCount * 3` array, whatever the source stride is. */
function readPositions(mesh: MeshData): Float32Array {
    const pos = channelAt(mesh.channels, MeshChannel.Position);
    if (!pos || pos.type !== MeshChannelType.Float32) {
        throw new Error('unwrapLightmapUV: the mesh carries no float Position channel');
    }
    const view = new DataView(mesh.vertices.buffer, mesh.vertices.byteOffset, mesh.vertices.byteLength);
    const out = new Float32Array(mesh.vertexCount * 3);
    for (let v = 0; v < mesh.vertexCount; v++) {
        const at = v * mesh.vertexStride + pos.offset;
        out[v * 3] = view.getFloat32(at, true);
        out[v * 3 + 1] = view.getFloat32(at + 4, true);
        out[v * 3 + 2] = pos.components >= 3 ? view.getFloat32(at + 8, true) : 0;
    }
    return out;
}

/** The diagonal of the bounds, as the scale a weld epsilon is relative to. */
function weldEpsilon(mesh: MeshData): number {
    const d = Math.hypot(mesh.aabbMax[0] - mesh.aabbMin[0],
                         mesh.aabbMax[1] - mesh.aabbMin[1],
                         mesh.aabbMax[2] - mesh.aabbMin[2]);
    return Math.max(d, 1e-6) * 1e-5;
}

/**
 * Gives `mesh` a lightmap UV set, splitting vertices where charts meet.
 *
 * Every per-vertex datum follows its vertex, morph deltas included, so the result
 * is the same mesh — drawn, skinned and shaped identically — that now also
 * carries somewhere to read a bake from.
 */
export function unwrapLightmapUV(mesh: MeshData, options: UnwrapOptions = {}): UnwrapResult {
    const opts = { ...DEFAULTS, ...options };
    const positions = readPositions(mesh);
    const tris: Tri[] = [];
    for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
        tris.push({ a: mesh.indices[i], b: mesh.indices[i + 1], c: mesh.indices[i + 2] });
    }
    const rep = weldByPosition(positions, mesh.vertexCount, weldEpsilon(mesh));
    const maxCos = Math.cos((opts.maxChartAngleDegrees * Math.PI) / 180);
    const charts = buildCharts(positions, tris, rep, maxCos);

    // Project every corner into its chart's plane. Held per (triangle, corner)
    // rather than per vertex: a vertex on a seam belongs to more than one chart
    // and has a different answer in each.
    const cornerU = new Float32Array(tris.length * 3);
    const cornerV = new Float32Array(tris.length * 3);
    const lo = new Float32Array(charts.count * 2).fill(Infinity);
    const hi = new Float32Array(charts.count * 2).fill(-Infinity);
    for (let t = 0; t < tris.length; t++) {
        const c = charts.chartOf[t] * 6;
        const corners = [tris[t].a, tris[t].b, tris[t].c];
        for (let k = 0; k < 3; k++) {
            const p = corners[k] * 3;
            const u = positions[p] * charts.basis[c] + positions[p + 1] * charts.basis[c + 1]
                    + positions[p + 2] * charts.basis[c + 2];
            const v = positions[p] * charts.basis[c + 3] + positions[p + 1] * charts.basis[c + 4]
                    + positions[p + 2] * charts.basis[c + 5];
            cornerU[t * 3 + k] = u;
            cornerV[t * 3 + k] = v;
            const b = charts.chartOf[t] * 2;
            if (u < lo[b]) lo[b] = u;
            if (u > hi[b]) hi[b] = u;
            if (v < lo[b + 1]) lo[b + 1] = v;
            if (v > hi[b + 1]) hi[b + 1] = v;
        }
    }

    const extent: Array<readonly [number, number]> = [];
    for (let c = 0; c < charts.count; c++) {
        extent.push([Math.max(hi[c * 2] - lo[c * 2], 0), Math.max(hi[c * 2 + 1] - lo[c * 2 + 1], 0)]);
    }
    const pad = opts.paddingTexels / opts.atlasSize;

    // ONE ratio for every chart, found by shrinking until they fit. A chart
    // scaled on its own would be lit at a different resolution from the surface
    // it joins, and the seam is where that shows.
    let area = 0;
    for (const [w, h] of extent) area += w * h;
    let scale = area > 0 ? Math.sqrt(0.5 / area) : 1;
    let placed = null as ReturnType<typeof packSkyline>;
    for (let attempt = 0; attempt < 24 && !placed; attempt++) {
        const boxes = extent.map(([w, h]) => [w * scale + pad * 2, h * scale + pad * 2] as const);
        placed = packSkyline(boxes, 1);
        if (!placed) scale *= 0.8;
    }
    if (!placed) throw new Error('unwrapLightmapUV: charts do not fit even at 0.5% of their size');

    let covered = 0;
    for (let c = 0; c < charts.count; c++) covered += extent[c][0] * extent[c][1] * scale * scale;

    // Split: a vertex is one new vertex per chart that uses it.
    const remap = new Map<number, number>();
    const source: number[] = [];
    const uv: number[] = [];
    const indices = new Uint32Array(tris.length * 3);
    for (let t = 0; t < tris.length; t++) {
        const chart = charts.chartOf[t];
        const box = placed[chart];
        const corners = [tris[t].a, tris[t].b, tris[t].c];
        for (let k = 0; k < 3; k++) {
            const key = corners[k] * charts.count + chart;
            let out = remap.get(key);
            if (out === undefined) {
                out = source.length;
                remap.set(key, out);
                source.push(corners[k]);
                const du = (cornerU[t * 3 + k] - lo[chart * 2]) * scale;
                const dv = (cornerV[t * 3 + k] - lo[chart * 2 + 1]) * scale;
                uv.push(box.rotated ? box.x + pad + dv : box.x + pad + du,
                        box.rotated ? box.y + pad + du : box.y + pad + dv);
            }
            indices[t * 3 + k] = out;
        }
    }

    return {
        mesh: rebuild(mesh, source, uv, indices),
        charts: charts.count,
        coverage: covered,
    };
}

/** The same mesh over a new vertex table, with the UV set appended to each. */
function rebuild(mesh: MeshData, source: number[], uv: number[], indices: Uint32Array): MeshData {
    const had = channelAt(mesh.channels, MeshChannel.TexCoord1);
    const stride = had ? mesh.vertexStride : mesh.vertexStride + 8;
    const at = had ? had.offset : mesh.vertexStride;
    const channels: MeshChannelDesc[] = had ? [...mesh.channels] : [
        ...mesh.channels,
        { semantic: MeshChannel.TexCoord1, components: 2, type: MeshChannelType.Float32, offset: at },
    ];

    const vertices = new Uint8Array(source.length * stride);
    const view = new DataView(vertices.buffer);
    for (let v = 0; v < source.length; v++) {
        vertices.set(mesh.vertices.subarray(source[v] * mesh.vertexStride,
                                            (source[v] + 1) * mesh.vertexStride), v * stride);
        view.setFloat32(v * stride + at, uv[v * 2], true);
        view.setFloat32(v * stride + at + 4, uv[v * 2 + 1], true);
    }

    let morph = mesh.morph;
    if (morph) {
        const per = morph.hasNormals ? 6 : 3;
        const targets = morph.names.length;
        const deltas = new Float32Array(targets * source.length * per);
        for (let t = 0; t < targets; t++) {
            for (let v = 0; v < source.length; v++) {
                const from = (t * mesh.vertexCount + source[v]) * per;
                deltas.set(morph.deltas.subarray(from, from + per), (t * source.length + v) * per);
            }
        }
        morph = { ...morph, deltas };
    }

    return {
        ...mesh,
        channels,
        vertexStride: stride,
        vertexCount: source.length,
        vertices,
        indices,
        morph,
    };
}
