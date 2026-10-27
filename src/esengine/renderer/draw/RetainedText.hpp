// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "./TextVertexFormat.hpp"
#include "../../core/Types.hpp"

#include <algorithm>
#include <cmath>
#include <map>
#include <vector>

namespace esengine {

/**
 * @file  RetainedText.hpp
 * @brief Glyph geometry the engine keeps between frames, and the clipping of it against a view.
 *
 * @details The text system lays a label out in TS (it rasterizes glyphs through a canvas) and used to hand the quads back to the engine every
 *          frame, with the label's matrix, opacity, order and clip all asked of the engine one embind call at a time. A label that has not changed
 *          is the same quads next frame, so TS now hands them over once and the engine submits them itself, reading what it needs of the entity
 *          from the registry. TS comes back only for a label whose text, style or box changed.
 */

/// Quads in one bounds block: a view that misses the whole block does not look at its quads.
inline constexpr u32 RETAINED_TEXT_BLOCK_QUADS = 64;
inline constexpr u32 RETAINED_TEXT_QUAD_FLOATS = 4 * TEXT_VERTEX_FLOATS;

struct RetainedTextBatch {
    std::vector<f32> vertices;  ///< TEXT_VERTEX_FLOATS floats a vertex, four a quad.
    std::vector<u16> indices;   ///< Six a quad, naming this batch's own vertices.
    std::vector<f32> blocks;    ///< left, bottom, right, top of each RETAINED_TEXT_BLOCK_QUADS quads.
    u32 pageId = 0;             ///< The atlas page, which is the draw's texture.
};

struct RetainedText {
    std::vector<RetainedTextBatch> batches;
    bool sdf = false;
    bool screen = false;  ///< The domain the geometry was laid out for.
    bool hasBox = false;  ///< Laid out in a UINode box, so ordered by the UI tree rather than by `layer`.
    bool autoKind = false;  ///< The glyph pipeline was chosen from the entity's world scale, so a changed scale can change it.
    i32 layer = 0;        ///< Text.layer, for a label with no box.
    f32 boxWidth = 0.0f;  ///< The box the layout used: a label whose box has since changed is stale.
    f32 boxHeight = 0.0f;
};

/// The retained geometry of every label, by entity. Ordered: a frame submits in entity order, not in whatever order a hash left them.
class RetainedTextStore {
public:
    /// Replaces any geometry the entity held, with none yet: batches follow through add().
    void begin(u32 entity, bool sdf, bool screen, bool hasBox, i32 layer, f32 boxWidth, f32 boxHeight, bool autoKind = false) {
        RetainedText& text = entries_[entity];
        text = RetainedText{};
        text.sdf = sdf;
        text.screen = screen;
        text.hasBox = hasBox;
        text.autoKind = autoKind;
        text.layer = layer;
        text.boxWidth = boxWidth;
        text.boxHeight = boxHeight;
    }

    /// One batch of an entity begun with begin(). False when it was not begun or the batch is not whole quads.
    bool add(u32 entity, const f32* vertices, i32 vertexCount, const u16* indices, i32 indexCount, u32 pageId) {
        const auto found = entries_.find(entity);
        if (found == entries_.end() || vertexCount <= 0 || indexCount <= 0 || vertexCount % 4 != 0 || indexCount != vertexCount / 4 * 6) return false;
        RetainedTextBatch& batch = found->second.batches.emplace_back();
        batch.vertices.assign(vertices, vertices + static_cast<usize>(vertexCount) * TEXT_VERTEX_FLOATS);
        batch.indices.assign(indices, indices + indexCount);
        batch.pageId = pageId;
        const u32 quads = static_cast<u32>(vertexCount) / 4;
        batch.blocks.resize(static_cast<usize>((quads + RETAINED_TEXT_BLOCK_QUADS - 1) / RETAINED_TEXT_BLOCK_QUADS) * 4);
        for (u32 start = 0; start < quads; start += RETAINED_TEXT_BLOCK_QUADS) {
            f32 left = INFINITY, bottom = INFINITY, right = -INFINITY, top = -INFINITY;
            const u32 end = std::min(quads, start + RETAINED_TEXT_BLOCK_QUADS) * RETAINED_TEXT_QUAD_FLOATS;
            for (u32 i = start * RETAINED_TEXT_QUAD_FLOATS; i < end; i += TEXT_VERTEX_FLOATS) {
                left = std::min(left, batch.vertices[i]);
                right = std::max(right, batch.vertices[i]);
                bottom = std::min(bottom, batch.vertices[i + 1]);
                top = std::max(top, batch.vertices[i + 1]);
            }
            f32* block = batch.blocks.data() + static_cast<usize>(start / RETAINED_TEXT_BLOCK_QUADS) * 4;
            block[0] = left;
            block[1] = bottom;
            block[2] = right;
            block[3] = top;
        }
        return true;
    }

    void clear(u32 entity) { entries_.erase(entity); }
    void clearAll() { entries_.clear(); }
    usize size() const { return entries_.size(); }
    std::map<u32, RetainedText>& entries() { return entries_; }

private:
    std::map<u32, RetainedText> entries_;
};

/// Which glyph pipeline a label of automatic render mode draws with at a world scale: hinted bitmaps while the scale is within 2% of 1:1, SDF past
/// it. The same rule, in the same precision, as resolveTextRenderMode in sdk/src/ui/text/plugin.ts. True for SDF.
inline bool retainedTextAutoIsSdf(f32 worldScaleX) {
    constexpr double BITMAP_SCALE_EPSILON = 0.02;
    const double scale = worldScaleX;
    if (!std::isfinite(scale) || scale <= 0.0) return false;
    return std::abs(scale - 1.0) > BITMAP_SCALE_EPSILON;
}

// ---- Clipping a label's quads against a view ------------------------------------------------------------------------------------------------
// The same arithmetic, in the same precision, as sdk/src/ui/text/text-culling.ts, which the unretained path still runs: the two must agree on
// which quads a view keeps.

/// Six clip planes on the glyph's local z=0 plane, each with three coefficients and three rounding-error weights: 36 doubles. False for a view or
/// model matrix with a non-finite entry. Near uses -w, which stays conservative for both OpenGL and zero-to-one depth.
inline bool retainedTextClipPlanes(double* out, const f32* view, const f32* model) {
    constexpr double ROUNDING_MARGIN = 8.0 / 8388608.0;  // 8 * 2^-23
    for (int i = 0; i < 16; ++i) {
        if (!std::isfinite(view[i]) || !std::isfinite(model[i])) return false;
    }
    for (int plane = 0; plane < 6; ++plane) {
        const int row = plane >> 1;
        const double sign = plane % 2 == 0 ? 1.0 : -1.0;
        for (int slot = 0; slot < 3; ++slot) {
            const int column = slot == 2 ? 12 : slot * 4;
            double value = 0.0, error = 0.0;
            for (int k = 0; k < 4; ++k) {
                const double a = view[k * 4 + 3], b = view[k * 4 + row];
                value += (a + sign * b) * model[column + k];
                error += (std::abs(a) + std::abs(b)) * std::abs(static_cast<double>(model[column + k]));
            }
            out[plane * 6 + slot] = value;
            out[plane * 6 + slot + 3] = error * ROUNDING_MARGIN;
        }
    }
    return true;
}

/// 0 outside, 1 inside, 2 crossing a clip plane. Non-finite bounds stay visible.
inline int retainedTextClassify(const double* planes, double left, double bottom, double right, double top) {
    if (!std::isfinite(left) || !std::isfinite(bottom) || !std::isfinite(right) || !std::isfinite(top)) return 1;
    bool inside = true;
    const double x = std::max(std::abs(left), std::abs(right)), y = std::max(std::abs(bottom), std::abs(top));
    for (int p = 0; p < 36; p += 6) {
        const double a = planes[p], b = planes[p + 1], c = planes[p + 2];
        const double margin = planes[p + 3] * x + planes[p + 4] * y + planes[p + 5];
        const double lo = a * (a >= 0 ? left : right) + b * (b >= 0 ? bottom : top) + c;
        const double hi = a * (a >= 0 ? right : left) + b * (b >= 0 ? top : bottom) + c;
        if (hi < -margin) return 0;
        if (lo < margin) inside = false;
    }
    return inside ? 1 : 2;
}

/// Where the quads a view keeps are copied to, reused across batches and frames.
struct RetainedTextClip {
    std::vector<f32> vertices;
    std::vector<u16> indices;
    std::vector<u8> visible;
    std::vector<u8> blockVisibility;
};

/// What a view keeps of a batch: nothing, all of it (read the batch itself), or a subset copied into @p scratch.
enum class RetainedTextKept { None, All, Subset };

inline RetainedTextKept retainedTextClip(const RetainedTextBatch& batch, const double* planes, RetainedTextClip& scratch) {
    if (!planes) return RetainedTextKept::All;
    const u32 count = static_cast<u32>(batch.vertices.size() / RETAINED_TEXT_QUAD_FLOATS);
    scratch.visible.assign(count, 0);
    scratch.blockVisibility.assign(batch.blocks.size() / 4, 0);
    u32 visibleCount = 0;
    for (u32 start = 0; start < count; start += RETAINED_TEXT_BLOCK_QUADS) {
        const u32 block = start / RETAINED_TEXT_BLOCK_QUADS * 4;
        const u32 end = std::min(count, start + RETAINED_TEXT_BLOCK_QUADS);
        const int status = retainedTextClassify(planes, batch.blocks[block], batch.blocks[block + 1], batch.blocks[block + 2], batch.blocks[block + 3]);
        scratch.blockVisibility[start / RETAINED_TEXT_BLOCK_QUADS] = static_cast<u8>(status);
        if (status != 2) {
            std::fill(scratch.visible.begin() + start, scratch.visible.begin() + end, static_cast<u8>(status));
            if (status == 1) visibleCount += end - start;
            continue;
        }
        for (u32 quad = start; quad < end; ++quad) {
            const u32 offset = quad * RETAINED_TEXT_QUAD_FLOATS;
            const double x0 = batch.vertices[offset], y0 = batch.vertices[offset + 1];
            const double x1 = batch.vertices[offset + 2 * TEXT_VERTEX_FLOATS], y1 = batch.vertices[offset + 2 * TEXT_VERTEX_FLOATS + 1];
            const bool survives = retainedTextClassify(planes, std::min(x0, x1), std::min(y0, y1), std::max(x0, x1), std::max(y0, y1)) != 0;
            scratch.visible[quad] = survives ? 1 : 0;
            if (survives) ++visibleCount;
        }
    }
    if (visibleCount == 0) return RetainedTextKept::None;
    if (visibleCount == count) return RetainedTextKept::All;
    scratch.vertices.resize(static_cast<usize>(visibleCount) * RETAINED_TEXT_QUAD_FLOATS);
    scratch.indices.resize(static_cast<usize>(visibleCount) * 6);
    u32 output = 0;
    for (u32 start = 0; start < count; start += RETAINED_TEXT_BLOCK_QUADS) {
        if (scratch.blockVisibility[start / RETAINED_TEXT_BLOCK_QUADS] == 0) continue;
        const u32 end = std::min(count, start + RETAINED_TEXT_BLOCK_QUADS);
        for (u32 quad = start; quad < end; ++quad) {
            if (!scratch.visible[quad]) continue;
            std::copy_n(batch.vertices.begin() + static_cast<usize>(quad) * RETAINED_TEXT_QUAD_FLOATS, RETAINED_TEXT_QUAD_FLOATS,
                        scratch.vertices.begin() + static_cast<usize>(output) * RETAINED_TEXT_QUAD_FLOATS);
            const u16 base = static_cast<u16>(output * 4), sourceBase = static_cast<u16>(quad * 4);
            for (u32 i = 0; i < 6; ++i) scratch.indices[static_cast<usize>(output) * 6 + i] = static_cast<u16>(batch.indices[static_cast<usize>(quad) * 6 + i] - sourceBase + base);
            ++output;
        }
    }
    return RetainedTextKept::Subset;
}

}  // namespace esengine
