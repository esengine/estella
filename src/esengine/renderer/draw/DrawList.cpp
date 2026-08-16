// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "./DrawList.hpp"
#include "./BatchVertex.hpp"
#include "../store/MaterialStore.hpp"
#include "../../core/FrameProfiler.hpp"

#include <glm/glm.hpp>
#include <algorithm>

namespace esengine {

namespace {
// Stamp a merged sampler slot onto every vertex of a Batch-layout command. The vertices
// are still in CPU staging at finalize time (finalize runs before upload), so the shader
// later samples u_textures[texIndex]. Only the Batch layout carries a texIndex attribute.
void rewriteTexIndex(TransientBufferPool& pool, const DrawCommand& cmd, i32 slot) {
    auto* verts = reinterpret_cast<BatchVertex*>(pool.vertexData(LayoutId::Batch) + cmd.vertex_byte_offset);
    f32 fslot = static_cast<f32>(slot);
    for (u32 k = 0; k < cmd.vertex_count; ++k) verts[k].texIndex = fslot;
}
}  // namespace

void DrawList::clear() {
    commands_.clear();
    sort_entries_.clear();
    skin_matrices_.clear();
    merged_draw_calls_ = 0;
}

u32 DrawList::addSkinMatrices(const glm::mat4* matrices, u32 count) {
    const u32 at = static_cast<u32>(skin_matrices_.size());
    skin_matrices_.insert(skin_matrices_.end(), matrices, matrices + count);
    return at;
}

void DrawList::push(const DrawCommand& cmd) {
    commands_.push_back(cmd);
}

void DrawList::finalize(TransientBufferPool& pool) {
    u32 count = static_cast<u32>(commands_.size());
    if (count == 0) {
        merged_draw_calls_ = 0;
        return;
    }

    sort_entries_.resize(count);
    for (u32 i = 0; i < count; ++i) {
        sort_entries_[i] = { commands_[i].sort_key, i };
    }

    // Tie-break on emit index so same-key commands keep submission order: that keeps an
    // emit-contiguous run contiguous after sorting, which is what lets the merge coalesce it
    // (including across different textures, now that texture is out of the key).
    std::sort(sort_entries_.begin(), sort_entries_.end(),
              [](const SortEntry& a, const SortEntry& b) {
                  return a.key < b.key || (a.key == b.key && a.index < b.index);
              });

    // Gather into a reused scratch buffer (not a fresh per-frame vector) and swap
    // it with commands_, so the allocation is amortized across frames.
    sorted_scratch_.resize(count);
    for (u32 i = 0; i < count; ++i) {
        sorted_scratch_[i] = commands_[sort_entries_[i].index];
    }
    commands_.swap(sorted_scratch_);

    merged_draw_calls_ = 0;
    u32 writeIdx = 0;
    u32 breaks[static_cast<u32>(BatchBreak::Count)] = {};

    for (u32 i = 0; i < count; ++i) {
        bool didMerge = false;
        BatchBreak blocker = BatchBreak::RunStart;
        if (writeIdx > 0) {
            DrawCommand& head = commands_[writeIdx - 1];
            blocker = head.mergeBlocker(commands_[i]);
            if (blocker == BatchBreak::None) {
                if (head.layout_id == LayoutId::Batch && commands_[i].texture_count >= 1) {
                    // Multi-texture: give this command's texture a slot in the head's set
                    // (or bail to a new draw if all 8 slots are taken), then stamp its verts.
                    i32 slot = head.addTextureSlot(commands_[i].texture_ids[0]);
                    if (slot >= 0) {
                        // Staging verts default to texIndex 0, so only a non-zero slot
                        // needs the per-vertex rewrite; a same-texture merge reuses
                        // slot 0 and is already correct.
                        if (slot != 0) rewriteTexIndex(pool, commands_[i], slot);
                        head.index_count += commands_[i].index_count;
                        head.entity_count += commands_[i].entity_count;
                        didMerge = true;
                    } else {
                        blocker = BatchBreak::TextureSlots;
                    }
                } else {
                    head.index_count += commands_[i].index_count;
                    head.entity_count += commands_[i].entity_count;
                    didMerge = true;
                }
            }
        }
        if (!didMerge) {
            if (writeIdx != i) {
                commands_[writeIdx] = commands_[i];
            }
            commands_[writeIdx].break_reason = blocker;
            ++breaks[static_cast<u32>(blocker)];
            // The run head owns slot 0; staging verts already default to texIndex 0,
            // so it needs no rewrite (this is the common single-texture case).
            ++writeIdx;
        }
    }
    commands_.resize(writeIdx);
    merged_draw_calls_ = writeIdx;

    // What the frame's draw-call count is made of. Emitted per reason and only
    // where it happened, so a clean frame publishes nothing rather than a wall
    // of zeroes for a caller to read past.
    if (FrameProfiler::get().enabled()) {
        ES_PROFILE_COUNTER("batch.draws", merged_draw_calls_);
        ES_PROFILE_COUNTER("batch.merged", count - merged_draw_calls_);
        for (u32 r = 1; r < static_cast<u32>(BatchBreak::Count); ++r) {
            if (breaks[r] == 0) continue;
            FrameProfiler::get().counter(batchBreakCounter(static_cast<BatchBreak>(r)), breaks[r]);
        }
    }
}

void DrawList::execute(GfxDevice& device, TransientBufferPool& buffers,
                       MaterialStore& materials, u32 white_texture_id,
                       FrameCapture* capture, BufferHandle skin_ubo) {
    PipelineDesc lastDesc{};
    PipelineHandle lastHandle = PipelineHandle::Invalid;

    for (u32 i = 0; i < merged_draw_calls_; ++i) {
        const auto& cmd = commands_[i];

        GfxStencilMode stencil = GfxStencilMode::Off;
        if (cmd.state_flags & CMD_STATE_STENCIL_WRITE) stencil = GfxStencilMode::Write;
        else if (cmd.state_flags & CMD_STATE_STENCIL_TEST) stencil = GfxStencilMode::Test;

        // Resolve the immutable pipeline. Depth/cull come from the command (resolved from
        // its material, or the 2D defaults: depth_write on with the test off). createPipeline
        // caches; a one-entry memo skips the lookup for identical consecutive (sorted) commands.
        PipelineDesc desc{};
        desc.program = ShaderHandle{cmd.shader_id};
        desc.vertexLayout = cmd.hasPersistentGeometry()
            ? cmd.vertex_layout
            : buffers.layoutHandle(cmd.layout_id);
        desc.blend = cmd.blend_mode;
        // Opaque is a blend mode, not a second switch beside one: a material that
        // says None is asking for the source to replace the destination, and any
        // other value is asking to read it. Keeping it in the same field is what
        // stops "Additive, blending off" from being expressible at all — and the
        // sort key and canMergeWith already carry blend, so nothing else has to
        // learn about this.
        desc.blendEnabled = cmd.blend_mode != BlendMode::None;
        desc.depthTest = cmd.depth_test;
        desc.depthWrite = cmd.depth_write;
        desc.stencil = stencil;
        desc.cullEnabled = cmd.cull != 0;
        desc.cullFront = cmd.cull == 2;

        if (lastHandle == PipelineHandle::Invalid || !(desc == lastDesc)) {
            lastHandle = device.createPipeline(desc);
            lastDesc = desc;
        }
        device.setPipeline(lastHandle);

        // Per-material constants (binding 1): upload-if-dirty + bind this draw's material UBO.
        // A no-op for material 0 and for materials whose shader declares no params.
        if (cmd.material_id != 0) {
            materials.bindForDraw(cmd.material_id);
        }

        // The pose, for a draw that has one. Written immediately before the draw
        // that reads it: one draw's bones are in flight at a time, which is what
        // lets a single block serve every skinned mesh in the frame.
        if (cmd.skin_count > 0 && skin_ubo != BufferHandle::Invalid) {
            device.updateBuffer(skin_ubo, 0, skin_matrices_.data() + cmd.skin_offset,
                                cmd.skin_count * sizeof(glm::mat4));
        }

        // Dynamic per-draw state (sorted+merged draws already group these coarsely).
        if (cmd.state_flags & CMD_STATE_SCISSOR) {
            device.setScissorTest(true);
            device.setScissor(cmd.scissor.x, cmd.scissor.y, cmd.scissor.w, cmd.scissor.h);
        } else {
            device.setScissorTest(false);
        }
        if (stencil != GfxStencilMode::Off) {
            device.setStencilReference(cmd.stencil_ref);
        }
        // The batch shader declares 8 samplers, and WebGL2 invalidates a draw if any
        // referenced sampler unit lacks a complete texture — even units the per-vertex
        // branch never samples. For the Batch layout, fill the unused slots with a
        // STABLE white texture: those units then stay pinned across draws, so the
        // per-slot bind cache makes them no-ops and only slot 0 rebinds per texture
        // change (filling with this draw's own tex re-pointed all 8 units each time).
        // Other layouts bind only the samplers they declare.
        if (cmd.layout_id == LayoutId::Batch) {
            for (u8 slot = 0; slot < MAX_CMD_TEXTURE_SLOTS; ++slot) {
                u32 tex = (slot < cmd.texture_count) ? cmd.texture_ids[slot] : white_texture_id;
                device.bindTexture(slot, TextureHandle{tex});
            }
        } else {
            for (u8 slot = 0; slot < cmd.texture_count; ++slot) {
                device.bindTexture(slot, TextureHandle{cmd.texture_ids[slot]});
            }
        }

        if (cmd.hasPersistentGeometry()) {
            // The mesh's buffers for geometry, the frame's pool for transforms.
            // Only the second was written this frame: an unchanged mesh costs no
            // upload, and drawing it twice costs one more transform.
            device.setVertexBuffer(0, cmd.vertex_buffer, 0);
            device.setVertexBuffer(1, buffers.vertexBuffer(LayoutId::MeshInstance),
                                   cmd.vertex_byte_offset);
            device.setIndexBuffer(cmd.index_buffer);
            device.drawElementsInstanced(
                cmd.index_count, GfxDataType::UnsignedInt,
                static_cast<u32>(static_cast<uintptr_t>(cmd.index_offset) * sizeof(u32)),
                cmd.instance_count);
        } else if (cmd.instance_count > 0) {
            // Instanced: static geometry (index_count indices from offset 0) drawn
            // instance_count times, instance attributes rebased at vertex_byte_offset.
            buffers.bindInstanceLayout(cmd.layout_id, cmd.vertex_byte_offset);
            device.drawElementsInstanced(cmd.index_count, GfxDataType::UnsignedInt, 0, cmd.instance_count);
        } else {
            buffers.bindLayout(cmd.layout_id);
            device.drawElements(
                cmd.index_count,
                GfxDataType::UnsignedInt,
                static_cast<u32>(static_cast<uintptr_t>(cmd.index_offset) * sizeof(u32)));
        }

        if (capture && capture->isCapturing()) {
            capture->recordDrawCall(
                cmd.stage,
                cmd.type, cmd.blend_mode,
                cmd.texture_count > 0 ? cmd.texture_ids[0] : 0,
                0, cmd.shader_id,
                0, cmd.index_count / 3,
                cmd.layer,
                cmd.break_reason,
                cmd.scissor,
                (cmd.state_flags & CMD_STATE_SCISSOR) != 0,
                (cmd.state_flags & CMD_STATE_STENCIL_WRITE) != 0,
                (cmd.state_flags & CMD_STATE_STENCIL_TEST) != 0,
                cmd.stencil_ref,
                cmd.texture_count);
        }

        if (capture && capture->isReplaying() && capture->shouldStop()) {
            break;
        }
    }
}

}  // namespace esengine
