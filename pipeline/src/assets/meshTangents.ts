// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    meshTangents.ts
 * @brief   The tangent frame an imported mesh carries: xyz along +u, w the handedness of its bitangent.
 *
 * @details A normal map is a vector in a frame — the one the baker used. Deriving that frame per pixel from screen-space
 *          derivatives is right on average and wrong at every UV seam and wherever a texture is stretched; carrying it with
 *          the vertices reads the map as it was baked. A tangent the source supplies keeps its direction (it is the baker's);
 *          one it does not is made from the triangles' own UV derivatives, weighted by the angle each makes at the vertex.
 *
 *          The bitangent's SIDE is always taken from the geometry as stored: the shader builds it as `cross(N, T) * w`, and
 *          `w` is chosen so that matches the direction the stored v grows. That makes it correct under whatever flip the
 *          importer applied to v, which a handedness copied from the source would not be.
 */

/**
 * @param positions  3 floats per vertex.
 * @param normals    3 floats per vertex, unit length.
 * @param uvs        2 floats per vertex, exactly as stored in the mesh (after any v flip).
 * @param indices    A triangle list.
 * @param supplied   The source's own tangents (3 or 4 floats per vertex), or null to derive them.
 * @returns 4 floats per vertex.
 */
export function generateTangents(
    positions: ArrayLike<number>, normals: ArrayLike<number>, uvs: ArrayLike<number>,
    indices: ArrayLike<number>, supplied: ArrayLike<number> | null = null, suppliedStride = 4,
): Float32Array {
    const count = Math.floor(positions.length / 3);
    const tan = new Float64Array(count * 3);
    const bit = new Float64Array(count * 3);

    for (let t = 0; t + 2 < indices.length; t += 3) {
        const a = indices[t]!, b = indices[t + 1]!, c = indices[t + 2]!;
        if (a >= count || b >= count || c >= count) continue;
        const e1x = positions[b * 3]! - positions[a * 3]!, e1y = positions[b * 3 + 1]! - positions[a * 3 + 1]!, e1z = positions[b * 3 + 2]! - positions[a * 3 + 2]!;
        const e2x = positions[c * 3]! - positions[a * 3]!, e2y = positions[c * 3 + 1]! - positions[a * 3 + 1]!, e2z = positions[c * 3 + 2]! - positions[a * 3 + 2]!;
        const du1 = uvs[b * 2]! - uvs[a * 2]!, dv1 = uvs[b * 2 + 1]! - uvs[a * 2 + 1]!;
        const du2 = uvs[c * 2]! - uvs[a * 2]!, dv2 = uvs[c * 2 + 1]! - uvs[a * 2 + 1]!;
        const det = du1 * dv2 - du2 * dv1;
        if (Math.abs(det) < 1e-20) continue;  // a triangle with no UV area says nothing about the frame
        const r = 1 / det;
        const tx = (e1x * dv2 - e2x * dv1) * r, ty = (e1y * dv2 - e2y * dv1) * r, tz = (e1z * dv2 - e2z * dv1) * r;
        const bx = (e2x * du1 - e1x * du2) * r, by = (e2y * du1 - e1y * du2) * r, bz = (e2z * du1 - e1z * du2) * r;
        const tl = Math.hypot(tx, ty, tz), bl = Math.hypot(bx, by, bz);
        if (!(tl > 0) || !(bl > 0)) continue;
        // The angle the triangle makes at each of its corners: a vertex shared by a fan of slivers and one big face is
        // shaped by the face, as its normal is.
        const corner = [a, b, c];
        for (let k = 0; k < 3; k++) {
            const i = corner[k]!, j = corner[(k + 1) % 3]!, l = corner[(k + 2) % 3]!;
            const ux = positions[j * 3]! - positions[i * 3]!, uy = positions[j * 3 + 1]! - positions[i * 3 + 1]!, uz = positions[j * 3 + 2]! - positions[i * 3 + 2]!;
            const vx = positions[l * 3]! - positions[i * 3]!, vy = positions[l * 3 + 1]! - positions[i * 3 + 1]!, vz = positions[l * 3 + 2]! - positions[i * 3 + 2]!;
            const ul = Math.hypot(ux, uy, uz), vl = Math.hypot(vx, vy, vz);
            if (!(ul > 0) || !(vl > 0)) continue;
            const angle = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy + uz * vz) / (ul * vl))));
            tan[i * 3] += tx / tl * angle; tan[i * 3 + 1] += ty / tl * angle; tan[i * 3 + 2] += tz / tl * angle;
            bit[i * 3] += bx / bl * angle; bit[i * 3 + 1] += by / bl * angle; bit[i * 3 + 2] += bz / bl * angle;
        }
    }

    const out = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
        const nx = normals[i * 3]!, ny = normals[i * 3 + 1]!, nz = normals[i * 3 + 2]!;
        let tx = tan[i * 3]!, ty = tan[i * 3 + 1]!, tz = tan[i * 3 + 2]!;
        if (supplied) {
            const sx = supplied[i * suppliedStride]!, sy = supplied[i * suppliedStride + 1]!, sz = supplied[i * suppliedStride + 2]!;
            if (Math.hypot(sx, sy, sz) > 1e-6) { tx = sx; ty = sy; tz = sz; }
        }
        // Square to the normal (Gram-Schmidt): a tangent that leans on it is a shear, not a frame.
        const along = tx * nx + ty * ny + tz * nz;
        tx -= nx * along; ty -= ny * along; tz -= nz * along;
        let len = Math.hypot(tx, ty, tz);
        if (!(len > 1e-8)) {
            // No usable direction (no UV area here): any axis square to the normal keeps the frame well-formed.
            if (Math.abs(nx) < 0.9) {
                tx = 0;
                ty = -nz;
                tz = ny;
            } else {
                tx = nz;
                ty = 0;
                tz = -nx;
            }
            len = Math.hypot(tx, ty, tz) || 1;
        }
        tx /= len; ty /= len; tz /= len;
        // The side the stored v grows toward, against cross(N, T): that sign is the handedness.
        const cx = ny * tz - nz * ty, cy = nz * tx - nx * tz, cz = nx * ty - ny * tx;
        const side = cx * bit[i * 3]! + cy * bit[i * 3 + 1]! + cz * bit[i * 3 + 2]!;
        out[i * 4] = tx; out[i * 4 + 1] = ty; out[i * 4 + 2] = tz;
        out[i * 4 + 3] = side < 0 ? -1 : 1;
    }
    return out;
}
