// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ClusterSelection.hpp
 * @brief   Which clusters of a mesh's hierarchy one eye draws.
 *
 * @details A clustered mesh carries its triangles at every level of detail, cut into clusters (pipeline/src/assets/clusterLod.ts
 *          builds them). Each cluster has two bounds, its own and its group's: a sphere and an error in mesh units. A view
 *          draws a cluster when its own error is small enough on screen and its group's is not. A group's sphere holds its
 *          clusters' and its error is no smaller, so from any eye the group measures at least what its clusters do, and of a
 *          surface's levels exactly one is drawn everywhere. Header-only and free of the renderer, like LodSelection.hpp.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../../math/Math.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>
#include <vector>

namespace esengine::lod {

/**
 * @brief One cluster: its run of the hierarchy's indices, its own bounds and its group's.
 *
 * @details The layout an .esmesh stores and the asset layer hands over: 48 bytes, two u32 and ten f32. A cluster nothing
 *          replaces has an infinite `groupError`.
 */
struct Cluster {
    u32 firstIndex = 0;
    u32 indexCount = 0;
    f32 centre[3]{};
    f32 radius = 0.0f;
    f32 error = 0.0f;
    f32 groupCentre[3]{};
    f32 groupRadius = 0.0f;
    f32 groupError = 0.0f;
};
static_assert(sizeof(Cluster) == 48, "Cluster is the record an .esmesh stores");

/**
 * @brief A mesh's clusters and the indices they name, every level together.
 *
 * @details Kept in memory because a cut is assembled from it: the indices a view draws are copied out of here into the
 *          buffer it draws with. Level 0 comes first and is the mesh's own triangles.
 */
struct ClusterHierarchy {
    std::vector<Cluster> clusters;
    std::vector<u32> indices;
};

/**
 * @brief An eye as a hierarchy measures from it.
 *
 * @details In the mesh's own space, so a cluster's bounds are read as stored. `scale` is the size on screen of one mesh
 *          unit at one mesh unit from the eye (under an orthographic view, of one mesh unit anywhere), in whatever unit
 *          `threshold` is in: pixels, for a threshold of one pixel.
 */
struct ClusterEye {
    glm::vec3 position{0.0f};
    f32 scale = 1.0f;
    f32 threshold = 1.0f;
    /// An orthographic view: an error is the same size at every distance.
    bool flat = false;
};

/** @brief The nearest a sphere's surface is taken to be: an eye inside one sees its error as large as it can be. */
inline constexpr f32 kClusterNearGap = 1e-6f;

/** @brief The size on screen of @p error, read at the nearest point of the sphere it belongs to. */
inline f32 clusterErrorOnScreen(const ClusterEye& eye, const f32* centre, f32 radius, f32 error) {
    if (!(error < std::numeric_limits<f32>::infinity())) return std::numeric_limits<f32>::infinity();
    if (eye.flat) return error * eye.scale;
    const glm::vec3 to = glm::vec3(centre[0], centre[1], centre[2]) - eye.position;
    return error * eye.scale / std::max(glm::length(to) - radius, kClusterNearGap);
}

/** @brief Whether @p cluster is the level of its surface that @p eye draws. */
inline bool clusterDrawn(const ClusterEye& eye, const Cluster& cluster) {
    if (clusterErrorOnScreen(eye, cluster.centre, cluster.radius, cluster.error) > eye.threshold) return false;
    return clusterErrorOnScreen(eye, cluster.groupCentre, cluster.groupRadius, cluster.groupError) > eye.threshold;
}

/** @brief The clusters @p eye draws, in the hierarchy's order, into @p out. Returns the indices they hold together. */
inline u32 selectClusters(const ClusterHierarchy& hierarchy, const ClusterEye& eye, std::vector<u32>& out) {
    out.clear();
    u32 indices = 0;
    const u32 count = static_cast<u32>(hierarchy.clusters.size());
    for (u32 i = 0; i < count; ++i) {
        const Cluster& cluster = hierarchy.clusters[i];
        if (!clusterDrawn(eye, cluster)) continue;
        out.push_back(i);
        indices += cluster.indexCount;
    }
    return indices;
}

/** @brief A number that changes when the picked clusters do: two cuts with the same one are drawn from the same buffer. */
inline u64 cutSignature(const std::vector<u32>& picked) {
    u64 hash = 0xcbf29ce484222325ull;
    for (const u32 id : picked) {
        hash ^= id;
        hash *= 0x100000001b3ull;
    }
    return hash ^ (static_cast<u64>(picked.size()) << 40);
}

/**
 * @brief The picked clusters' indices, one run after another, into @p out.
 *
 * @details @p vertexBase is added to each: a mesh that shares a page of vertices with others draws with indices that
 *          count from the page's first vertex, not its own.
 */
inline void assembleCut(const ClusterHierarchy& hierarchy, const std::vector<u32>& picked, u32 vertexBase,
                        std::vector<u32>& out) {
    usize total = 0;
    for (const u32 id : picked) total += hierarchy.clusters[id].indexCount;
    out.resize(total);
    usize at = 0;
    for (const u32 id : picked) {
        const Cluster& cluster = hierarchy.clusters[id];
        const u32* from = hierarchy.indices.data() + cluster.firstIndex;
        if (vertexBase == 0) {
            std::memcpy(out.data() + at, from, static_cast<usize>(cluster.indexCount) * sizeof(u32));
        } else {
            for (u32 i = 0; i < cluster.indexCount; ++i) out[at + i] = from[i] + vertexBase;
        }
        at += cluster.indexCount;
    }
}

/**
 * @brief Whether @p hierarchy is one a cut can be assembled from: every run inside the indices, every index a vertex.
 *
 * @details Asked once, when the hierarchy arrives from a file, so that drawing never has to.
 */
inline bool clusterHierarchyValid(const ClusterHierarchy& hierarchy, u32 vertexCount) {
    const usize total = hierarchy.indices.size();
    for (const Cluster& cluster : hierarchy.clusters) {
        if (cluster.indexCount % 3 != 0) return false;
        if (cluster.firstIndex > total || cluster.indexCount > total - cluster.firstIndex) return false;
        if (!(cluster.groupError >= cluster.error)) return false;
    }
    for (const u32 index : hierarchy.indices) if (index >= vertexCount) return false;
    return !hierarchy.clusters.empty();
}

}  // namespace esengine::lod
