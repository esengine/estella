// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    atlas.ts
 * @brief   Which texel of the atlas is which point of the world.
 *
 * Every object gets a patch sized by the surface it actually has, so one
 * world-to-texel ratio holds across the whole bake — the same rule the unwrap
 * follows inside one mesh, applied between them.
 */

import { MeshChannel, MeshChannelType, type MeshData, type MeshChannelDesc } from '../asset/meshFormat';
import { packSkyline } from './pack';

/** One object to bake: geometry with a lightmap UV set, and where it stands. */
export interface BakeSurface {
    mesh: MeshData;
    /** Column-major 4x4, as `glm` and the engine write one. */
    transform: ArrayLike<number>;
    /** What fraction of each channel the surface reflects. Drives the bounce;
     *  a surface that reflects nothing still receives light. */
    albedo?: readonly [number, number, number];
}

/** Texels of one object's patch, and where in the atlas it sits. */
export interface SurfacePatch {
    /** Side of the square patch, in texels. */
    side: number;
    x: number;
    y: number;
    rotated: boolean;
    /** What a `MeshLightmap` carries: `[scaleU, scaleV, offsetU, offsetV]`. */
    scaleOffset: [number, number, number, number];
}

/** Every texel a bake will solve, as parallel arrays. */
export interface LumelField {
    count: number;
    /** World position, three floats each. */
    position: Float32Array;
    /** World normal, three floats each. */
    normal: Float32Array;
    /** Index into the atlas, one per lumel. */
    texel: Int32Array;
    /** Which surface each lumel belongs to. */
    surface: Int32Array;
}

const chan = (m: MeshData, s: number): MeshChannelDesc | undefined =>
    m.channels.find((c) => c.semantic === s);

function reader(mesh: MeshData): (v: number, semantic: number, n: number, out: Float32Array, at: number) => boolean {
    const view = new DataView(mesh.vertices.buffer, mesh.vertices.byteOffset, mesh.vertices.byteLength);
    return (v, semantic, n, out, at) => {
        const c = chan(mesh, semantic);
        if (!c || c.type !== MeshChannelType.Float32) return false;
        const base = v * mesh.vertexStride + c.offset;
        for (let k = 0; k < n; k++) out[at + k] = k < c.components ? view.getFloat32(base + k * 4, true) : 0;
        return true;
    };
}

function transformPoint(m: ArrayLike<number>, x: number, y: number, z: number, out: Float32Array, at: number): void {
    out[at] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[at + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[at + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
}

/** Direction under the same transform, without its translation. Not the inverse
 *  transpose: a bake takes objects as placed, and a non-uniform scale on baked
 *  geometry is a modelling choice this does not try to rescue. */
function transformDir(m: ArrayLike<number>, x: number, y: number, z: number, out: Float32Array, at: number): void {
    const nx = m[0] * x + m[4] * y + m[8] * z;
    const ny = m[1] * x + m[5] * y + m[9] * z;
    const nz = m[2] * x + m[6] * y + m[10] * z;
    const len = Math.hypot(nx, ny, nz) || 1;
    out[at] = nx / len; out[at + 1] = ny / len; out[at + 2] = nz / len;
}

/** World and UV area of one surface, which together give its texel ratio. */
function areasOf(surface: BakeSurface): { world: number; uv: number } {
    const read = reader(surface.mesh);
    const p = new Float32Array(9);
    const t = new Float32Array(6);
    const w = new Float32Array(9);
    let world = 0, uv = 0;
    const idx = surface.mesh.indices;
    for (let i = 0; i + 2 < idx.length; i += 3) {
        for (let k = 0; k < 3; k++) {
            if (!read(idx[i + k], MeshChannel.Position, 3, p, k * 3)) return { world: 0, uv: 0 };
            if (!read(idx[i + k], MeshChannel.TexCoord1, 2, t, k * 2)) return { world: 0, uv: 0 };
            transformPoint(surface.transform, p[k * 3], p[k * 3 + 1], p[k * 3 + 2], w, k * 3);
        }
        const ux = w[3] - w[0], uy = w[4] - w[1], uz = w[5] - w[2];
        const vx = w[6] - w[0], vy = w[7] - w[1], vz = w[8] - w[2];
        world += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
        uv += Math.abs((t[2] - t[0]) * (t[5] - t[1]) - (t[4] - t[0]) * (t[3] - t[1])) / 2;
    }
    return { world, uv };
}

/**
 * Gives every surface a patch of an `size`-by-`size` atlas at `texelsPerUnit`.
 *
 * Returns null when they do not fit — the caller's signal to ask for a bigger
 * atlas or a coarser density, which is a decision an author makes rather than
 * one a packer should make quietly by shrinking someone.
 */
export function layoutAtlas(surfaces: readonly BakeSurface[], size: number,
                            texelsPerUnit: number): SurfacePatch[] | null {
    const sides = surfaces.map((s) => {
        const { world, uv } = areasOf(s);
        if (world <= 0 || uv <= 0) return 1;
        // The unwrap kept one ratio inside the mesh; this is what that ratio is,
        // and it says how many texels a patch needs to hit the density asked for.
        const side = texelsPerUnit / Math.sqrt(uv / world);
        return Math.max(2, Math.min(size, Math.ceil(side)));
    });
    const placed = packSkyline(sides.map((s) => [s, s] as const), size);
    if (!placed) return null;
    return sides.map((side, i) => ({
        side,
        x: placed[i].x,
        y: placed[i].y,
        rotated: placed[i].rotated,
        scaleOffset: [side / size, side / size, placed[i].x / size, placed[i].y / size],
    }));
}

/**
 * The world point and normal behind every texel the surfaces cover.
 *
 * A texel centred outside every triangle is not in the field: solving it would
 * pay for the gaps between charts. What keeps a bilinear tap off those gaps is
 * the dilate afterwards, not a lumel invented here.
 */
export function rasterizeLumels(surfaces: readonly BakeSurface[],
                                patches: readonly SurfacePatch[], size: number): LumelField {
    const position: number[] = [];
    const normal: number[] = [];
    const texel: number[] = [];
    const owner: number[] = [];
    const seen = new Set<number>();

    const p = new Float32Array(9);
    const n = new Float32Array(9);
    const t = new Float32Array(6);
    const wp = new Float32Array(9);
    const wn = new Float32Array(9);

    for (let s = 0; s < surfaces.length; s++) {
        const surface = surfaces[s];
        const patch = patches[s];
        const read = reader(surface.mesh);
        const idx = surface.mesh.indices;
        const hasNormals = chan(surface.mesh, MeshChannel.Normal) !== undefined;
        for (let i = 0; i + 2 < idx.length; i += 3) {
            let ok = true;
            for (let k = 0; k < 3 && ok; k++) {
                ok = read(idx[i + k], MeshChannel.Position, 3, p, k * 3)
                  && read(idx[i + k], MeshChannel.TexCoord1, 2, t, k * 2);
                if (!ok) break;
                transformPoint(surface.transform, p[k * 3], p[k * 3 + 1], p[k * 3 + 2], wp, k * 3);
                if (hasNormals && read(idx[i + k], MeshChannel.Normal, 3, n, k * 3)) {
                    transformDir(surface.transform, n[k * 3], n[k * 3 + 1], n[k * 3 + 2], wn, k * 3);
                }
            }
            if (!ok) continue;
            if (!hasNormals) {
                // The face's own normal, for geometry that carries none.
                const ux = wp[3] - wp[0], uy = wp[4] - wp[1], uz = wp[5] - wp[2];
                const vx = wp[6] - wp[0], vy = wp[7] - wp[1], vz = wp[8] - wp[2];
                const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
                const len = Math.hypot(fx, fy, fz) || 1;
                for (let k = 0; k < 3; k++) {
                    wn[k * 3] = fx / len; wn[k * 3 + 1] = fy / len; wn[k * 3 + 2] = fz / len;
                }
            }

            // Into the patch's own texels, then into the atlas.
            const ax: number[] = [], ay: number[] = [];
            for (let k = 0; k < 3; k++) {
                const u = patch.rotated ? t[k * 2 + 1] : t[k * 2];
                const v = patch.rotated ? t[k * 2] : t[k * 2 + 1];
                ax.push(patch.x + u * patch.side);
                ay.push(patch.y + v * patch.side);
            }
            const area = (ax[1] - ax[0]) * (ay[2] - ay[0]) - (ax[2] - ax[0]) * (ay[1] - ay[0]);
            if (Math.abs(area) < 1e-9) continue;
            const minX = Math.max(0, Math.floor(Math.min(...ax)));
            const maxX = Math.min(size - 1, Math.ceil(Math.max(...ax)));
            const minY = Math.max(0, Math.floor(Math.min(...ay)));
            const maxY = Math.min(size - 1, Math.ceil(Math.max(...ay)));
            for (let y = minY; y <= maxY; y++) {
                for (let x = minX; x <= maxX; x++) {
                    const cx = x + 0.5, cy = y + 0.5;
                    const w0 = ((ax[1] - cx) * (ay[2] - cy) - (ax[2] - cx) * (ay[1] - cy)) / area;
                    const w1 = ((ax[2] - cx) * (ay[0] - cy) - (ax[0] - cx) * (ay[2] - cy)) / area;
                    const w2 = 1 - w0 - w1;
                    if (w0 < 0 || w1 < 0 || w2 < 0) continue;
                    const at = y * size + x;
                    if (seen.has(at)) continue;
                    seen.add(at);
                    for (let k = 0; k < 3; k++) {
                        position.push(w0 * wp[k] + w1 * wp[3 + k] + w2 * wp[6 + k]);
                    }
                    let nx = w0 * wn[0] + w1 * wn[3] + w2 * wn[6];
                    let ny = w0 * wn[1] + w1 * wn[4] + w2 * wn[7];
                    let nz = w0 * wn[2] + w1 * wn[5] + w2 * wn[8];
                    const len = Math.hypot(nx, ny, nz) || 1;
                    nx /= len; ny /= len; nz /= len;
                    normal.push(nx, ny, nz);
                    texel.push(at);
                    owner.push(s);
                }
            }
        }
    }

    return {
        count: texel.length,
        position: Float32Array.from(position),
        normal: Float32Array.from(normal),
        texel: Int32Array.from(texel),
        surface: Int32Array.from(owner),
    };
}
