// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "DrawList.hpp"
#include "BatchVertex.hpp"
#include "MaterialStore.hpp"

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
    merged_draw_calls_ = 0;
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

    for (u32 i = 0; i < count; ++i) {
        bool didMerge = false;
        if (writeIdx > 0) {
            DrawCommand& head = commands_[writeIdx - 1];
            if (head.canMergeWith(commands_[i])) {
                if (head.layout_id == LayoutId::Batch && commands_[i].texture_count >= 1) {
                    // Multi-texture: give this command's texture a slot in the head's set
                    // (or bail to a new draw if all 8 slots are taken), then stamp its verts.
                    i32 slot = head.addTextureSlot(commands_[i].texture_ids[0]);
                    if (slot >= 0) {
                        rewriteTexIndex(pool, commands_[i], slot);
                        head.index_count += commands_[i].index_count;
                        head.entity_count += commands_[i].entity_count;
                        didMerge = true;
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
            // First command of a run owns slot 0 of its (so far single-texture) set.
            if (commands_[writeIdx].layout_id == LayoutId::Batch) {
                rewriteTexIndex(pool, commands_[writeIdx], 0);
            }
            ++writeIdx;
        }
    }
    commands_.resize(writeIdx);
    merged_draw_calls_ = writeIdx;
}

void DrawList::execute(GfxDevice& device, TransientBufferPool& buffers,
                       MaterialStore& materials, FrameCapture* capture) {
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
        desc.program = cmd.shader_id;
        desc.vertexLayout = cmd.layout_id;
        desc.blend = cmd.blend_mode;
        desc.blendEnabled = true;
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
        // branch never samples. For the Batch layout, fill the unused slots with slot 0's
        // (always-valid) texture; other layouts bind only the samplers they declare.
        if (cmd.layout_id == LayoutId::Batch) {
            for (u8 slot = 0; slot < MAX_CMD_TEXTURE_SLOTS; ++slot) {
                u32 tex = (slot < cmd.texture_count) ? cmd.texture_ids[slot] : cmd.texture_ids[0];
                device.bindTexture(slot, tex);
            }
        } else {
            for (u8 slot = 0; slot < cmd.texture_count; ++slot) {
                device.bindTexture(slot, cmd.texture_ids[slot]);
            }
        }

        if (cmd.instance_count > 0) {
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
                static_cast<RenderStage>(cmd.sort_key >> 60),
                cmd.type, cmd.blend_mode,
                cmd.texture_count > 0 ? cmd.texture_ids[0] : 0,
                0, cmd.shader_id,
                0, cmd.index_count / 3,
                cmd.layer,
                FlushReason::FrameEnd,
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
