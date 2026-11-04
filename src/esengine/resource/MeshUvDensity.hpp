// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    MeshUvDensity.hpp
 * @brief   How much texture a mesh's surface holds: UV units per world unit of its own surface.
 *
 * @details The square root of the mesh's UV area over its surface area, both summed over its triangles. A texture `side` texels
 *          across, drawn on it, puts `side * density` texels on a world unit of the mesh at its own size — which is what a view
 *          compares with the pixels a world unit covers to say how big a texture it needs. An average over the whole mesh: a mesh
 *          that packs one part of its surface much denser than another is answered for the mean.
 *
 *          Header-only: vertex bytes, their layout and the triangle list are the whole input. 0 for a mesh without float positions
 *          and a float first UV set, which no view then asks for a size of.
 */
#pragma once

#include "../core/Types.hpp"
#include "../renderer/rhi/GfxEnums.hpp"

#include <cmath>
#include <cstring>

namespace esengine::resource {

inline f32 meshUvDensity(const u8* vertexBytes, usize vertexByteCount, u32 vertexStride,
                         u32 positionOffset, u32 uvOffset, const u32* indices, usize indexCount) {
    if (!vertexBytes || vertexStride == 0 || indexCount < 3) return 0.0f;
    const usize vertexCount = vertexByteCount / vertexStride;
    const auto read = [&](u32 vertex, u32 offset, u32 k) {
        f32 value = 0.0f;
        std::memcpy(&value, vertexBytes + static_cast<usize>(vertex) * vertexStride + offset + k * 4u, sizeof(f32));
        return value;
    };
    f64 world = 0.0, tex = 0.0;
    for (usize i = 0; i + 2 < indexCount; i += 3) {
        const u32 a = indices[i], b = indices[i + 1], c = indices[i + 2];
        if (a >= vertexCount || b >= vertexCount || c >= vertexCount) continue;
        const f32 ux = read(b, positionOffset, 0) - read(a, positionOffset, 0);
        const f32 uy = read(b, positionOffset, 1) - read(a, positionOffset, 1);
        const f32 uz = read(b, positionOffset, 2) - read(a, positionOffset, 2);
        const f32 vx = read(c, positionOffset, 0) - read(a, positionOffset, 0);
        const f32 vy = read(c, positionOffset, 1) - read(a, positionOffset, 1);
        const f32 vz = read(c, positionOffset, 2) - read(a, positionOffset, 2);
        const f64 cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
        world += std::sqrt(cx * cx + cy * cy + cz * cz) * 0.5;
        const f32 su = read(b, uvOffset, 0) - read(a, uvOffset, 0), sv = read(b, uvOffset, 1) - read(a, uvOffset, 1);
        const f32 tu = read(c, uvOffset, 0) - read(a, uvOffset, 0), tv = read(c, uvOffset, 1) - read(a, uvOffset, 1);
        tex += std::abs(static_cast<f64>(su) * tv - static_cast<f64>(sv) * tu) * 0.5;
    }
    return world > 0.0 ? static_cast<f32>(std::sqrt(tex / world)) : 0.0f;
}

}  // namespace esengine::resource
