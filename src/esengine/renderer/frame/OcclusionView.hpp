// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    OcclusionView.hpp
 * @brief   What this view already has something solid in front of.
 *
 * @details The other half of the cull, beside Frustum: one says what is outside
 *          the view, this says what is inside it and hidden. Both are asked
 *          through one predicate (RenderCollectContext::visible) so a renderable
 *          cannot be judged by one of them and not the other.
 *
 *          A DEPTH GRID, not a query: the collect may not touch the device
 *          (RenderFrame's first invariant), and a GPU occlusion query answers a
 *          frame late through a readback the WebGL2 path would stall on. Solid
 *          boxes an author declared are rasterised onto a small grid here, and
 *          every bound is tested against it before it becomes a draw.
 *
 *          Conservative in one direction ON PURPOSE. Claiming too little costs
 *          draws that were already being paid; claiming too much makes objects
 *          vanish in front of the player, which no counter shows and no gate
 *          catches. Everything below rounds towards drawing: only texels a face
 *          covers WHOLE take a depth, that depth is the face's farthest point
 *          over the texel, and a box that reaches behind the eye is dropped
 *          rather than approximated.
 */
#pragma once

#include "../../core/Types.hpp"

#include <glm/glm.hpp>
#include <glm/gtc/quaternion.hpp>

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>

namespace esengine {

/**
 * @brief The depths this view is blocked at, and the test a bound asks it.
 *
 * @details `begin`, an `addBox` per declared occluder, `finish`, then `hidden`
 *          until the next `begin`. The stored view-projection serves both halves:
 *          a tester holding its own copy is how a raster and a test come to
 *          disagree about where something is.
 */
class OcclusionView {
public:
    /** @brief Grid resolution of the coarsest useful answer. A texel is ~1.5% of
     *         the screen, which is what an occluder must exceed to hide anything;
     *         finer costs the rasterisation, which is the only cost here. */
    static constexpr u32 kSize = 64;
    /** @brief 64, 32, 16, 8, 4, 2, 1 — down to one texel, so an object covering
     *         the whole screen still takes a bounded number of reads. */
    static constexpr u32 kLevels = 7;

    /** @brief Texels a side a bound is tested over: sixteen reads, whatever its
     *         size on screen. */
    static constexpr u32 kTestSpan = 4;

    /** @brief Depth of a texel nothing covers: no bound is ever farther. */
    static constexpr f32 kOpen = std::numeric_limits<f32>::infinity();

    /** @brief Smallest clip w a corner may have. Anything at or behind the eye
     *         plane makes the projection meaningless, and the cases that reach
     *         it — the eye inside the box, the box across the near plane — are
     *         exactly the ones a conservative answer must refuse. */
    static constexpr f32 kMinW = 1e-4f;

    /** @brief Opens a view looking through @p viewProjection. Nothing is blocked
     *         until a box is taken, which is what a scene declaring no occluder
     *         (every 2D one) pays: one comparison per renderable. */
    void begin(const glm::mat4& viewProjection) {
        view_projection_ = viewProjection;
        boxes_ = 0;
    }

    /**
     * @brief Takes one solid box — @p half world half-extents about @p centre,
     *        turned by @p rotation — as something sight does not pass through.
     *
     * @return Whether it was taken. A refusal is not an error: a box reaching
     *         behind the eye plane is dropped whole rather than clipped, because
     *         everything this class may get wrong must be got wrong towards
     *         drawing.
     */
    bool addBox(const glm::vec3& centre, const glm::quat& rotation, const glm::vec3& half) {
        glm::vec3 corners[8];
        if (!projectBox(centre, rotation, half, corners)) return false;

        // Grid coordinates, where a texel is one unit and its centre a half — the
        // edge bias and the depth slope below are both read in texels, and two
        // spaces would put the rounding in one of them only.
        glm::vec2 lo(static_cast<f32>(kSize)), hi(0.0f);
        for (const glm::vec3& c : corners) {
            lo = glm::min(lo, glm::vec2(c));
            hi = glm::max(hi, glm::vec2(c));
        }
        // The texels the silhouette TOUCHES, both ends floored: a rectangle that
        // rounded one end up would hand the coverage test a texel the box never
        // reaches, and the test and the scan must agree on which texels exist.
        const i32 x0 = std::max(0, static_cast<i32>(std::floor(lo.x)));
        const i32 y0 = std::max(0, static_cast<i32>(std::floor(lo.y)));
        const i32 x1 = std::min(static_cast<i32>(kSize) - 1, static_cast<i32>(std::floor(hi.x)));
        const i32 y1 = std::min(static_cast<i32>(kSize) - 1, static_cast<i32>(std::floor(hi.y)));
        // Off screen entirely: what is outside the view hides nothing inside it,
        // and the frustum has already answered for anything out there.
        if (x1 < x0 || y1 < y0) return false;

        Face faces[6];
        u32 faceCount = 0;
        for (const auto& quad : kFaces) {
            Face face;
            if (buildFace(corners, quad, face)) faces[faceCount++] = face;
        }
        // Every face edge-on at once means a box with no thickness on screen.
        if (faceCount == 0) return false;

        if (boxes_ == 0) base_.fill(kOpen);
        ++boxes_;

        for (i32 y = y0; y <= y1; ++y) {
            for (i32 x = x0; x <= x1; ++x) {
                const glm::vec2 p(static_cast<f32>(x) + 0.5f, static_cast<f32>(y) + 0.5f);
                f32 blocked = kOpen;
                for (u32 f = 0; f < faceCount; ++f) {
                    const Face& face = faces[f];
                    if (!face.covers(p)) continue;
                    // The face's FARTHEST depth over the whole texel, not its depth
                    // at the centre: the claim a texel makes is about every point in
                    // it, and half a texel of slope is what separates the two.
                    blocked = std::min(blocked, face.maxDepthOver(p));
                }
                if (blocked < kOpen) {
                    f32& cell = base_[static_cast<usize>(y) * kSize + static_cast<usize>(x)];
                    // Nearest wins: whatever is in front blocks most, and which box
                    // it came from cannot change the answer — so the order the
                    // registry hands them over in cannot either.
                    cell = std::min(cell, blocked);
                }
            }
        }
        return true;
    }

    /** @brief Closes the view: reduces the grid by MAXIMUM into a pyramid, so a
     *         bound of any size on screen costs four reads rather than its area.
     *         A coarse texel answers for a whole region, and taking the farthest
     *         of them is what keeps a region that is only partly blocked drawn. */
    void finish() {
        if (boxes_ == 0) return;
        for (u32 level = 1; level < kLevels; ++level) {
            const u32 size = kSize >> level;
            const u32 src = kSize >> (level - 1);
            f32* out = levelData(level);
            const f32* in = levelData(level - 1);
            for (u32 y = 0; y < size; ++y) {
                for (u32 x = 0; x < size; ++x) {
                    const f32 a = in[(2 * y) * src + 2 * x];
                    const f32 b = in[(2 * y) * src + 2 * x + 1];
                    const f32 c = in[(2 * y + 1) * src + 2 * x];
                    const f32 d = in[(2 * y + 1) * src + 2 * x + 1];
                    out[y * size + x] = std::max(std::max(a, b), std::max(c, d));
                }
            }
        }
    }

    /** @brief Whether nothing of a box bounded by @p centre / @p half can be seen,
     *         because every texel it covers is blocked nearer than its nearest point. */
    bool hidden(const glm::vec3& centre, const glm::vec3& half) const {
        if (boxes_ == 0) return false;

        glm::vec3 corners[8];
        if (!projectBox(centre, glm::quat(1.0f, 0.0f, 0.0f, 0.0f), half, corners)) return false;

        glm::vec2 lo(static_cast<f32>(kSize)), hi(0.0f);
        f32 nearest = kOpen;
        for (const glm::vec3& c : corners) {
            lo = glm::min(lo, glm::vec2(c));
            hi = glm::max(hi, glm::vec2(c));
            nearest = std::min(nearest, c.z);
        }

        // Clamped to the grid, because what falls outside it is off screen and needs
        // no occluder to be unseen. An empty rectangle after the clamp is entirely
        // off screen, which is the frustum's answer to give, not this one's.
        const i32 x0 = std::max(0, static_cast<i32>(std::floor(lo.x)));
        const i32 y0 = std::max(0, static_cast<i32>(std::floor(lo.y)));
        const i32 x1 = std::min(static_cast<i32>(kSize) - 1, static_cast<i32>(std::floor(hi.x)));
        const i32 y1 = std::min(static_cast<i32>(kSize) - 1, static_cast<i32>(std::floor(hi.y)));
        if (x1 < x0 || y1 < y0) return false;

        // FOUR texels a side, not two: a level's texels align to the grid and not to
        // this rectangle, so at two the overhang is the object's own width again —
        // measured, six of nine cubes squarely behind a wall went uncalled.
        u32 level = 0;
        while (level + 1 < kLevels
               && ((x1 >> level) - (x0 >> level) >= static_cast<i32>(kTestSpan)
                   || (y1 >> level) - (y0 >> level) >= static_cast<i32>(kTestSpan))) {
            ++level;
        }
        const u32 size = kSize >> level;
        const f32* cells = levelData(level);
        f32 farthest = -kOpen;
        for (i32 y = y0 >> level; y <= (y1 >> level); ++y) {
            for (i32 x = x0 >> level; x <= (x1 >> level); ++x) {
                farthest = std::max(farthest, cells[static_cast<usize>(y) * size
                                                    + static_cast<usize>(x)]);
            }
        }
        // Strictly nearer, so a bound resting exactly on the blocking depth is drawn:
        // equality here is a surface touching the occluder, which is visible.
        return farthest < nearest;
    }

    /** @brief Whether this view blocks nothing, so every bound is visible to it. */
    bool empty() const { return boxes_ == 0; }

    /** @brief How many declared boxes this view took. */
    u32 boxes() const { return boxes_; }

private:
    /** @brief One planar face of a box, in grid space: where it lies and how deep. */
    struct Face {
        /** Edge functions as (a, b, c) with a*x + b*y + c >= bias inside. */
        glm::vec3 edges[4];
        /** How far each edge function may fall across half a texel either way. */
        f32 bias[4];
        /** Depth as an affine function of grid position — which is what a PLANE's
         *  depth is in screen space, and why no perspective divide happens here. */
        f32 zx = 0.0f, zy = 0.0f, z0 = 0.0f;

        bool covers(const glm::vec2& p) const {
            for (u32 i = 0; i < 4; ++i) {
                if (edges[i].x * p.x + edges[i].y * p.y + edges[i].z < bias[i]) return false;
            }
            return true;
        }

        f32 maxDepthOver(const glm::vec2& p) const {
            return zx * p.x + zy * p.y + z0 + 0.5f * (std::fabs(zx) + std::fabs(zy));
        }
    };

    /** @brief The six faces as corner indices, each a ring around the quad. Winding
     *         is not read: which side faces the eye is decided per face from the
     *         projection, so a box turned inside out cannot flip the answer. */
    static constexpr u32 kFaces[6][4] = {
        {0, 1, 3, 2}, {4, 6, 7, 5}, {0, 4, 5, 1}, {2, 3, 7, 6}, {0, 2, 6, 4}, {1, 5, 7, 3},
    };

    /**
     * @brief Projects a box's eight corners into grid space with depth.
     *
     * @return False when any corner is at or behind the eye plane. Rejecting the
     *         whole box is what keeps the arithmetic honest: a projection is only
     *         monotone in depth where w stays positive, and the eye INSIDE an
     *         occluder is this same case — a box whose every ray would be called
     *         blocked.
     */
    bool projectBox(const glm::vec3& centre, const glm::quat& rotation, const glm::vec3& half,
                    glm::vec3 (&out)[8]) const {
        const glm::mat3 basis = glm::mat3_cast(rotation);
        for (u32 i = 0; i < 8; ++i) {
            const glm::vec3 local((i & 1u) ? half.x : -half.x,
                                  (i & 2u) ? half.y : -half.y,
                                  (i & 4u) ? half.z : -half.z);
            const glm::vec4 clip = view_projection_ * glm::vec4(centre + basis * local, 1.0f);
            if (clip.w <= kMinW) return false;
            const glm::vec3 ndc = glm::vec3(clip) / clip.w;
            // Behind the near plane in the convention every camera projection here
            // is built in (near = -1). A depth-zero-to-one projection simply never
            // trips it, which costs culling and never correctness.
            if (ndc.z < -1.0f) return false;
            out[i] = {(ndc.x + 1.0f) * 0.5f * static_cast<f32>(kSize),
                      (ndc.y + 1.0f) * 0.5f * static_cast<f32>(kSize), ndc.z};
        }
        return true;
    }

    /** @brief Builds the face @p quad names, or false if it projected to a sliver —
     *         a face seen edge-on covers nothing and has no depth to give. */
    static bool buildFace(const glm::vec3 (&corners)[8], const u32 (&quad)[4], Face& out) {
        const glm::vec3 v[4] = {corners[quad[0]], corners[quad[1]],
                                corners[quad[2]], corners[quad[3]]};
        // Signed area decides the orientation, so the inside test below is the same
        // expression for a face pointing at the eye and one pointing away.
        f32 area = 0.0f;
        for (u32 i = 0; i < 4; ++i) {
            const glm::vec3& a = v[i];
            const glm::vec3& b = v[(i + 1) % 4];
            area += a.x * b.y - b.x * a.y;
        }
        if (std::fabs(area) < 1e-3f) return false;
        const f32 sign = area > 0.0f ? 1.0f : -1.0f;

        for (u32 i = 0; i < 4; ++i) {
            const glm::vec3& a = v[i];
            const glm::vec3& b = v[(i + 1) % 4];
            const f32 ex = -(b.y - a.y) * sign;
            const f32 ey = (b.x - a.x) * sign;
            out.edges[i] = {ex, ey, -(ex * a.x + ey * a.y)};
            // Half a texel each way: the test is then "covers this texel WHOLE",
            // which is the difference between an occluder that may hide something
            // and one that only touches the pixels at its own silhouette.
            out.bias[i] = 0.5f * (std::fabs(ex) + std::fabs(ey));
        }

        const glm::vec2 d1(v[1].x - v[0].x, v[1].y - v[0].y);
        const glm::vec2 d2(v[2].x - v[0].x, v[2].y - v[0].y);
        const f32 det = d1.x * d2.y - d1.y * d2.x;
        if (std::fabs(det) < 1e-6f) return false;
        const f32 dz1 = v[1].z - v[0].z;
        const f32 dz2 = v[2].z - v[0].z;
        out.zx = (dz1 * d2.y - dz2 * d1.y) / det;
        out.zy = (d1.x * dz2 - d2.x * dz1) / det;
        out.z0 = v[0].z - out.zx * v[0].x - out.zy * v[0].y;
        return true;
    }

    /** @brief One pyramid in one array: level 0 is the grid, each next a quarter. */
    static constexpr usize kCells = (kSize * kSize * 4) / 3 + 1;

    f32* levelData(u32 level) { return base_.data() + offsetOf(level); }
    const f32* levelData(u32 level) const { return base_.data() + offsetOf(level); }

    static constexpr usize offsetOf(u32 level) {
        usize offset = 0;
        for (u32 i = 0; i < level; ++i) offset += static_cast<usize>(kSize >> i) * (kSize >> i);
        return offset;
    }

    glm::mat4 view_projection_{1.0f};
    std::array<f32, kCells> base_{};
    u32 boxes_ = 0;
};

}  // namespace esengine
