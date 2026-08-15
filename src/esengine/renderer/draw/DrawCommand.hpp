// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../../core/Types.hpp"
#include "../frame/RenderStage.hpp"
#include "./RenderItem.hpp"
#include "./BlendMode.hpp"
#include "../rhi/TransientBufferPool.hpp"

#include <algorithm>
#include <bit>
#include <cstring>

namespace esengine {

static constexpr u32 MAX_CMD_TEXTURE_SLOTS = 8;

static constexpr u16 CMD_STATE_SCISSOR       = 0x01;
static constexpr u16 CMD_STATE_STENCIL_WRITE = 0x02;
static constexpr u16 CMD_STATE_STENCIL_TEST  = 0x04;
static constexpr u16 CMD_STATE_CUSTOM_DRAW   = 0x08;

/**
 * Why a draw call had to start rather than join the one before it. Every member
 * is a condition the merge itself tests, so the list cannot drift from the rule.
 */
enum class BatchBreak : u8 {
    None = 0,
    RunStart,
    Instanced,
    Shader,
    Blend,
    Layout,
    Material,
    Depth,
    Cull,
    State,
    Scissor,
    Stencil,
    IndexGap,
    TextureSlots,
    Count,
};

/**
 * The profiler counter each reason publishes under. String LITERALS: FrameProfiler
 * keys entries by the pointer's contents and never copies, so a built-up buffer
 * would dangle the moment the frame ended.
 */
inline const char* batchBreakCounter(BatchBreak r) {
    switch (r) {
        case BatchBreak::RunStart:     return "batch.break.runStart";
        case BatchBreak::Instanced:    return "batch.break.instanced";
        case BatchBreak::Shader:       return "batch.break.shader";
        case BatchBreak::Blend:        return "batch.break.blend";
        case BatchBreak::Layout:       return "batch.break.layout";
        case BatchBreak::Material:     return "batch.break.material";
        case BatchBreak::Depth:        return "batch.break.depth";
        case BatchBreak::Cull:         return "batch.break.cull";
        case BatchBreak::State:        return "batch.break.state";
        case BatchBreak::Scissor:      return "batch.break.scissor";
        case BatchBreak::Stencil:      return "batch.break.stencil";
        case BatchBreak::IndexGap:     return "batch.break.indexGap";
        case BatchBreak::TextureSlots: return "batch.break.textureSlots";
        default:                       return "batch.break.none";
    }
}

struct DrawCommand {
    u64 sort_key = 0;

    u32 index_offset = 0;
    u32 index_count = 0;
    u32 vertex_byte_offset = 0;

    u32 shader_id = 0;
    BlendMode blend_mode = BlendMode::Normal;
    LayoutId layout_id = LayoutId::Batch;

    // The material handle this draw resolved from (0 = none). Identity for sort + merge so
    // distinct materials never coalesce, and the lookup key for per-material GPU state.
    u32 material_id = 0;
    // Pipeline depth/cull state, resolved from the material (or defaults). depth_write stays
    // on with the test off — the engine's 2D state — unless a material overrides it.
    bool depth_test = false;
    bool depth_write = true;
    u8 cull = 0;  ///< CullMode: 0 = none, 1 = back, 2 = front.
    BatchBreak break_reason = BatchBreak::RunStart;  ///< Why this draw call started.

    u8 texture_count = 0;
    u32 texture_ids[MAX_CMD_TEXTURE_SLOTS] = {};

    u16 state_flags = 0;
    ScissorRect scissor;
    i32 stencil_ref = 0;

    Entity entity = INVALID_ENTITY;
    RenderType type = RenderType::Sprite;
    // Kept beside the sort key rather than unpacked from it: the bit layout is
    // buildSortKey's business alone, and a second place that knows it is a second
    // place to forget when it moves. `layer` is here for the same reason.
    RenderStage stage = RenderStage::Transparent;
    i32 layer = 0;
    u32 entity_count = 1;
    bool merged = false;

    // > 0 selects an instanced draw: index_count indices drawn instance_count times,
    // with per-instance attributes based at vertex_byte_offset (see LayoutId::ParticleInstance).
    u32 instance_count = 0;

    // Geometry on the GPU rather than in this frame's pool. Set together or not
    // at all; index_offset/index_count then index INTO these. Sorting, material and
    // depth state are unchanged — where vertices live is not what is drawn.
    BufferHandle vertex_buffer = BufferHandle::Invalid;
    BufferHandle index_buffer = BufferHandle::Invalid;
    VertexLayoutHandle vertex_layout = VertexLayoutHandle::Invalid;

    bool hasPersistentGeometry() const { return vertex_buffer != BufferHandle::Invalid; }

    // Vertices owned by this command (from vertex_byte_offset). Needed so the merge pass
    // can rewrite their texIndex when coalescing into a multi-texture batch.
    u32 vertex_count = 0;

    // Texture is no longer part of the sort key: dropping it lets draws that differ only
    // by texture sort adjacent and coalesce into one multi-texture batch (up to 8 textures,
    // selected per-vertex in the shader). Order within a layer is otherwise unchanged.
    // Below stage the field order depends on it: a blended draw composites onto what is
    // already there, so its depth order IS the result and outranks batching, while an
    // opaque draw is order-independent, so material groups first and depth breaks ties.
    //
    // Layer outranks stage, and that order is load-bearing. A sorting layer is a promise
    // the user made about what draws on top of what; a stage is how one layer resolves
    // its own contents. Ranking stage first — the classic 3D pipeline order, where every
    // opaque draw precedes every transparent one — would let an opaque draw in layer 5
    // jump ahead of a painter draw in layer 3, which is the sorting layer's entire
    // meaning inverted. Within a layer the 3D order is the right one: opaque first
    // (front-to-back, early-z), then blended (back-to-front).
    //
    // [63:48] layer | [47:44] stage, then 44 bits whose order the stage decides:
    //   opaque   [43:36] shader | [35:33] blend | [32:31] flags | [30:14] material | [13:0] depth
    //   blended  [43:24] depth  | [23:16] shader | [15:13] blend | [12:11] flags | [10:0] material
    static u64 buildSortKey(RenderStage stage, i32 layer, u32 shaderId,
                            BlendMode blend, u16 stateFlags, f32 depth, u32 materialId = 0) {
        i32 normalizedLayer = std::clamp(layer + 32768, 0, 65535);
        u64 layerKey = static_cast<u64>(normalizedLayer & 0xFFFF) << 48;

        u64 stageKey = static_cast<u64>(stage) << 44;

        // Order-preserving float mapping — monotonic over the FULL float range.
        // The old [-1,1] normalize-and-truncate silently wrapped any real-world z
        // (e.g. a backdrop at z=-5 sorted as if nearest), and had the painter's
        // order inverted for the blended stages. Camera looks down -z, so larger
        // z = nearer: transparent/overlay draw back-to-front (far first, near
        // lands on top); opaque draws front-to-back (early-z friendly).
        const bool blended = stage == RenderStage::Transparent || stage == RenderStage::Overlay;
        u32 orderedDepth = blended ? orderedFloatBits(depth) : ~orderedFloatBits(depth);

        // Blended spends its bits on depth (20: sign, exponent, 11 mantissa — a step of
        // ~0.004 around z=10) and leaves material 11. Material here is a batching hint,
        // not identity: truncating it costs a merge, and canMergeWith compares in full.
        if (blended) {
            return layerKey | stageKey
                 | (static_cast<u64>(orderedDepth >> 12) << 24)
                 | (static_cast<u64>(shaderId & 0xFF) << 16)
                 | (static_cast<u64>(blend) << 13)
                 | (static_cast<u64>(stateFlags & 0x03) << 11)
                 | (static_cast<u64>(materialId) & 0x7FF);
        }
        return layerKey | stageKey
             | (static_cast<u64>(shaderId & 0xFF) << 36)
             | (static_cast<u64>(blend) << 33)
             | (static_cast<u64>(stateFlags & 0x03) << 31)
             | ((static_cast<u64>(materialId) & 0x1FFFF) << 14)
             | static_cast<u64>(orderedDepth >> 18);
    }

    // Order-preserving float → u32: flip the sign bit for positives, all bits for
    // negatives, so unsigned compare matches float compare (finite values).
    static u32 orderedFloatBits(f32 v) {
        u32 bits = std::bit_cast<u32>(v);
        return (bits & 0x80000000u) ? ~bits : (bits | 0x80000000u);
    }

    // Y-sorted variant (top-down occlusion): within a layer the painter's order by
    // world Y dominates everything — higher Y (further "back" under Y-up) draws
    // first, so lower-on-screen entities land on top. Material/depth leave the key
    // (Y-order beats batching by design; adjacent same-state runs still merge in
    // finalize), shader/blend/flags remain as tie-breaks so equal-Y draws group.
    // Same top two fields as buildSortKey, so a y-sorted layer and a plain one order
    // correctly against each other; below them this spends its bits on worldY instead.
    //
    // [63:48] layer | [47:44] stage | [43:20] worldY | [19:12] shader
    // [11:9] blend  | [8:7] flags
    static u64 buildSortKeyYSorted(RenderStage stage, i32 layer, f32 worldY,
                                   u32 shaderId, BlendMode blend, u16 stateFlags) {
        i32 normalizedLayer = std::clamp(layer + 32768, 0, 65535);
        u64 layerKey = static_cast<u64>(normalizedLayer & 0xFFFF) << 48;

        u64 stageKey = static_cast<u64>(stage) << 44;

        u32 yDescending = (~orderedFloatBits(worldY)) >> 8;  // 24 bits, larger Y → smaller key
        u64 yKey = static_cast<u64>(yDescending & 0xFFFFFF) << 20;

        u64 shaderKey = static_cast<u64>(shaderId & 0xFF) << 12;
        u64 blendKey = static_cast<u64>(blend) << 9;
        u64 flagsKey = static_cast<u64>(stateFlags & 0x03) << 7;

        return stageKey | layerKey | yKey | shaderKey | blendKey | flagsKey;
    }

    /** @brief Finds @p texId in this command's texture set, adds it (returns its slot), or
     *         -1 if the set is full. Used by the merge to assign per-vertex sampler slots. */
    i32 addTextureSlot(u32 texId) {
        for (u8 i = 0; i < texture_count; ++i) {
            if (texture_ids[i] == texId) return static_cast<i32>(i);
        }
        if (texture_count >= MAX_CMD_TEXTURE_SLOTS) return -1;
        texture_ids[texture_count] = texId;
        return static_cast<i32>(texture_count++);
    }

    /**
     * Why `next` cannot join this draw, or None if it can.
     *
     * The predicate answers with the reason rather than a bare no: a frame is
     * some number of draw calls, and the only actionable thing about that number
     * is what kept them apart. canMergeWith is this, read as a bool.
     */
    BatchBreak mergeBlocker(const DrawCommand& next) const {
        // Instanced draws are one command per emitter — never coalesce them. This
        // covers resident meshes too: their per-object transform IS the instance
        // stream, so every such draw carries a count.
        if (instance_count != 0 || next.instance_count != 0) return BatchBreak::Instanced;
        if (shader_id != next.shader_id) return BatchBreak::Shader;
        if (blend_mode != next.blend_mode) return BatchBreak::Blend;
        if (layout_id != next.layout_id) return BatchBreak::Layout;
        // Same material handle => same uniforms/textures; different ones must not
        // coalesce. material_id 0 (no material) shares the path's defaults, so they still merge.
        if (material_id != next.material_id) return BatchBreak::Material;
        // Depth state is checked on its own rather than trusted to follow from the
        // material. It used to: every draw resolved its depth from a material, so equal
        // material_id implied equal state, and material_id 0 meant one shared set of
        // defaults. Once a layer derives depth from the stage instead, two material-0
        // draws in the same layer can differ — one opaque and writing depth, one blended
        // and not — and merging them would silently give one of them the other's state.
        // The symptom would be a blended sprite occasionally clipping what is behind it,
        // depending on whether the two happened to land adjacent. Compared here as render
        // state, not as stage: the stage is the reason, these three are the effect.
        if (depth_test != next.depth_test) return BatchBreak::Depth;
        if (depth_write != next.depth_write) return BatchBreak::Depth;
        if (cull != next.cull) return BatchBreak::Cull;
        if (state_flags != next.state_flags) return BatchBreak::State;
        if (state_flags & CMD_STATE_SCISSOR) {
            if (scissor != next.scissor) return BatchBreak::Scissor;
        }
        if (state_flags & (CMD_STATE_STENCIL_WRITE | CMD_STATE_STENCIL_TEST)) {
            if (stencil_ref != next.stencil_ref) return BatchBreak::Stencil;
        }
        // Texture compatibility is decided by the merge (the combined set must fit in 8
        // slots), not here, so different-texture draws can coalesce.
        if (index_offset + index_count != next.index_offset) return BatchBreak::IndexGap;
        return BatchBreak::None;
    }

    bool canMergeWith(const DrawCommand& next) const {
        return mergeBlocker(next) == BatchBreak::None;
    }
};

}  // namespace esengine
