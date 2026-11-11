// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    meshCards.ts
 * @brief   Bakes the six axis cards of a mesh at import: what the surface cache lights (docs/GI_LUMEN_DESIGN.md, 3.3).
 *
 * @details Each card is an orthographic render from outside along one axis, done on the CPU: every triangle that faces the viewer is
 *          scan-converted at the card's pixel centres and the nearest wins. Colour is the material's base colour times the vertex
 *          colour where the mesh has one; a base-colour TEXTURE is not read (the bake works from the mesh and its constants), so a
 *          textured surface is cached at its tint, not its picture. That is stated here because it is the largest thing the bake
 *          leaves out.
 */
import { MeshChannel, MeshChannelType, type MeshData } from 'esengine';
import { CARD_AXES, NO_DEPTH, type MeshCard, type MeshCards } from '../../../sdk/src/gi/cardFormat';
import { meshPositions } from './meshSdf';

export interface MeshCardOptions {
    /** World size of a card pixel; raised so no card is wider than `maxResolution`. */
    cell: number;
    maxResolution?: number;
    baseColor?: readonly [number, number, number];
    emissive?: readonly [number, number, number];
}

function vertexColors(data: MeshData): Float32Array | null {
    const c = data.channels.find((ch) => ch.semantic === MeshChannel.Color && ch.components >= 3
        && (ch.type === MeshChannelType.Float32 || ch.type === MeshChannelType.UNorm8));
    if (!c) return null;
    const view = new DataView(data.vertices.buffer, data.vertices.byteOffset, data.vertices.byteLength);
    const out = new Float32Array(data.vertexCount * 3);
    for (let v = 0; v < data.vertexCount; v++) for (let k = 0; k < 3; k++) {
        out[v * 3 + k] = c.type === MeshChannelType.Float32
            ? view.getFloat32(v * data.vertexStride + c.offset + k * 4, true)
            : view.getUint8(v * data.vertexStride + c.offset + k) / 255;
    }
    return out;
}

export function bakeMeshCards(data: MeshData, options: MeshCardOptions): MeshCards | null {
    const positions = meshPositions(data);
    if (!positions || data.indices.length < 3) return null;
    const colors = vertexColors(data), base = options.baseColor ?? [1, 1, 1], emit = options.emissive ?? [0, 0, 0];
    const maxRes = options.maxResolution ?? 32;
    const extent = [0, 1, 2].map((k) => data.aabbMax[k]! - data.aabbMin[k]!);
    const cell = Math.max(options.cell, Math.max(...extent, 1e-9) / maxRes);
    const emissiveScale = Math.max(...emit, 1e-6);
    const cards: MeshCard[] = [];
    for (const { axis, sign, u, v } of CARD_AXES) {
        const width = Math.max(1, Math.min(maxRes, Math.ceil(extent[u]! / cell))), height = Math.max(1, Math.min(maxRes, Math.ceil(extent[v]! / cell)));
        const n = width * height;
        const card: MeshCard = { width, height, depth: new Uint16Array(n).fill(NO_DEPTH), normal: new Int8Array(n * 3), albedo: new Uint8Array(n * 3), emissive: new Uint8Array(n * 3) };
        const best = new Float32Array(n).fill(Infinity);
        const du = extent[u]! / width, dv = extent[v]! / height, ext = extent[axis]! || 1;
        for (let t = 0; t < data.indices.length; t += 3) {
            const i = [data.indices[t]!, data.indices[t + 1]!, data.indices[t + 2]!];
            const P = i.map((k) => [positions[k * 3]!, positions[k * 3 + 1]!, positions[k * 3 + 2]!]);
            const e1 = [0, 1, 2].map((k) => P[1]![k]! - P[0]![k]!), e2 = [0, 1, 2].map((k) => P[2]![k]! - P[0]![k]!);
            const nx = e1[1]! * e2[2]! - e1[2]! * e2[1]!, ny = e1[2]! * e2[0]! - e1[0]! * e2[2]!, nz = e1[0]! * e2[1]! - e1[1]! * e2[0]!;
            const nl = Math.hypot(nx, ny, nz);
            if (nl < 1e-20) continue;
            const nrm = [nx / nl, ny / nl, nz / nl];
            if (nrm[axis]! * sign <= 1e-6) continue;  // not facing this card's viewer
            // Barycentric in the (u, v) plane.
            const ax = P[0]![u]!, ay = P[0]![v]!, bx = P[1]![u]!, by = P[1]![v]!, cx = P[2]![u]!, cy = P[2]![v]!;
            const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
            if (Math.abs(det) < 1e-20) continue;
            const x0 = Math.max(Math.floor((Math.min(ax, bx, cx) - data.aabbMin[u]!) / du), 0), x1 = Math.min(Math.floor((Math.max(ax, bx, cx) - data.aabbMin[u]!) / du), width - 1);
            const y0 = Math.max(Math.floor((Math.min(ay, by, cy) - data.aabbMin[v]!) / dv), 0), y1 = Math.min(Math.floor((Math.max(ay, by, cy) - data.aabbMin[v]!) / dv), height - 1);
            for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
                const pu = data.aabbMin[u]! + (x + 0.5) * du, pv = data.aabbMin[v]! + (y + 0.5) * dv;
                const l1 = ((pu - ax) * (cy - ay) - (cx - ax) * (pv - ay)) / det, l2 = ((bx - ax) * (pv - ay) - (pu - ax) * (by - ay)) / det, l0 = 1 - l1 - l2;
                const eps = -1e-6;
                if (l0 < eps || l1 < eps || l2 < eps) continue;
                const a = l0 * P[0]![axis]! + l1 * P[1]![axis]! + l2 * P[2]![axis]!;
                const depth = sign > 0 ? data.aabbMax[axis]! - a : a - data.aabbMin[axis]!;
                const px = x + y * width;
                if (depth >= best[px]!) continue;
                best[px] = depth;
                card.depth[px] = Math.min(Math.round((depth / ext) * 65534), 65534);
                for (let k = 0; k < 3; k++) {
                    card.normal[px * 3 + k] = Math.round(nrm[k]! * 127);
                    const tint = colors ? l0 * colors[i[0]! * 3 + k]! + l1 * colors[i[1]! * 3 + k]! + l2 * colors[i[2]! * 3 + k]! : 1;
                    card.albedo[px * 3 + k] = Math.round(Math.min(Math.max(base[k]! * tint, 0), 1) * 255);
                    card.emissive[px * 3 + k] = Math.round(Math.min(Math.max(emit[k]! / emissiveScale, 0), 1) * 255);
                }
            }
        }
        cards.push(card);
    }
    return { aabbMin: [...data.aabbMin], aabbMax: [...data.aabbMax], cell, emissiveScale, cards };
}
