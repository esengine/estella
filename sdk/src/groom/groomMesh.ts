// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  groomMesh.ts — a group's strands as the mesh the Strands shader draws.
 *
 *        Every point is two vertices at the same place, one per edge of the ribbon (uv.x 0 and 1), with how far along its curve it is
 *        in uv.y, the curve's direction there in the normal, and its colour and radius in the vertex colour (the radius as a share of
 *        the group's widest, which the material is told). The shader moves each to its side; here they are still a line.
 */
import { MeshChannel, MeshChannelType, packChannels, type MeshData } from '../asset/meshFormat';
import type { CurveSet } from './groomFormat';

export interface StrandMesh {
    mesh: MeshData;
    /** The widest radius among the points, in world units: what the vertex colour's alpha is a share of. */
    maxRadius: number;
}

/**
 * The strands of `set`, with every position scaled by `scale` (world units a metre). `halfWidth` is the widest the shader will draw a strand
 * to either side, in world units, where it is not the curves' own radius: the bounds reach that far past the line. Null where there are none.
 */
export function buildStrandMesh(set: CurveSet, scale: number, halfWidth = 0): StrandMesh | null {
    const curves = set.counts.length;
    const points = set.radii.length;
    if (curves === 0 || points < 2) return null;
    const { channels, vertexStride } = packChannels([
        { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.TexCoord0, components: 2, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.Color, components: 4, type: MeshChannelType.UNorm8 },
    ]);
    const at = (semantic: number): number => channels.find((c) => c.semantic === semantic)!.offset;
    const posAt = at(MeshChannel.Position), normalAt = at(MeshChannel.Normal), uvAt = at(MeshChannel.TexCoord0), colorAt = at(MeshChannel.Color);
    let maxRadius = 0;
    for (let i = 0; i < points; i++) if (set.radii[i]! > maxRadius) maxRadius = set.radii[i]!;
    const vertexCount = points * 2;
    const vertices = new Uint8Array(vertexCount * vertexStride);
    const f32 = new Float32Array(vertices.buffer);
    const u8 = vertices;
    const stride4 = vertexStride / 4;
    const indices = new Uint32Array((points - curves) * 6);
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    const p = set.positions;
    let first = 0, index = 0;
    for (let c = 0; c < curves; c++) {
        const n = set.counts[c]!;
        // Length along the curve, so a point's t is how far along it is and not which point it is.
        let total = 0;
        for (let k = 1; k < n; k++) {
            const a = (first + k - 1) * 3, b = (first + k) * 3;
            total += Math.hypot(p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!);
        }
        let run = 0;
        for (let k = 0; k < n; k++) {
            const i = first + k;
            if (k > 0) {
                const a = (i - 1) * 3, b = i * 3;
                run += Math.hypot(p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!);
            }
            // The direction: from the point before to the point after (one-sided at the ends).
            const prev = (k > 0 ? i - 1 : i) * 3, next = (k < n - 1 ? i + 1 : i) * 3;
            let dx = p[next]! - p[prev]!, dy = p[next + 1]! - p[prev + 1]!, dz = p[next + 2]! - p[prev + 2]!;
            const len = Math.hypot(dx, dy, dz);
            if (len > 0) {
                dx /= len;
                dy /= len;
                dz /= len;
            } else {
                dx = 0;
                dy = 1;
                dz = 0;
            }
            const x = p[i * 3]! * scale, y = p[i * 3 + 1]! * scale, z = p[i * 3 + 2]! * scale;
            if (x < min[0]) min[0] = x; if (y < min[1]) min[1] = y; if (z < min[2]) min[2] = z;
            if (x > max[0]) max[0] = x; if (y > max[1]) max[1] = y; if (z > max[2]) max[2] = z;
            const t = total > 0 ? run / total : k / (n - 1);
            const share = maxRadius > 0 ? Math.round((set.radii[i]! / maxRadius) * 255) : 0;
            const r = set.colors ? set.colors[i * 4]! : 255, g = set.colors ? set.colors[i * 4 + 1]! : 255, b = set.colors ? set.colors[i * 4 + 2]! : 255;
            for (let e = 0; e < 2; e++) {
                const v = i * 2 + e;
                const o = v * stride4;
                f32[o + posAt / 4] = x; f32[o + posAt / 4 + 1] = y; f32[o + posAt / 4 + 2] = z;
                f32[o + normalAt / 4] = dx; f32[o + normalAt / 4 + 1] = dy; f32[o + normalAt / 4 + 2] = dz;
                f32[o + uvAt / 4] = e; f32[o + uvAt / 4 + 1] = t;
                const cb = v * vertexStride + colorAt;
                u8[cb] = r; u8[cb + 1] = g; u8[cb + 2] = b; u8[cb + 3] = share;
            }
            if (k < n - 1) {
                const a = i * 2, d = (i + 1) * 2;
                indices[index++] = a; indices[index++] = a + 1; indices[index++] = d;
                indices[index++] = a + 1; indices[index++] = d + 1; indices[index++] = d;
            }
        }
        first += n;
    }
    // The ribbons reach past the line by their half width; the shader's vertex bounds cover the pixel it may widen them to.
    const pad = Math.max(maxRadius * scale, halfWidth) * 4;
    for (let k = 0; k < 3; k++) { min[k] -= pad; max[k] += pad; }
    return { mesh: { channels, vertexStride, vertexCount, vertices, indices, aabbMin: min, aabbMax: max }, maxRadius: maxRadius * scale };
}
