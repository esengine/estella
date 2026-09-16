// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "./DrawList.hpp"
#include "./BatchVertex.hpp"
#include "../store/MaterialStore.hpp"
#include "../store/InstanceConstants.hpp"
#include "../store/SkinConstants.hpp"
#include "../../core/FrameProfiler.hpp"

#include <glm/glm.hpp>
#include <algorithm>
#include <cstring>

namespace esengine {

namespace {
/// relocateInstance: the first record of a run lands wherever the pool has room.
constexpr u32 NO_EXPECTED_OFFSET = 0xFFFFFFFFu;

// Stamp a merged sampler slot onto every vertex of a Batch-layout command. The vertices
// are still in CPU staging at finalize time (finalize runs before upload), so the shader
// later samples u_textures[texIndex]. Only the Batch layout carries a texIndex attribute.
void rewriteTexIndex(TransientBufferPool& pool, const DrawCommand& cmd, i32 slot) {
    auto* verts = reinterpret_cast<BatchVertex*>(pool.vertexData(LayoutId::Batch) + cmd.vertex_byte_offset);
    f32 fslot = static_cast<f32>(slot);
    for (u32 k = 0; k < cmd.vertex_count; ++k) verts[k].texIndex = fslot;
}

/**
 * Move one instance record to the end of its stream, where the run being built
 * is growing — the sort reordered the draws, so a run adjacent after it is
 * almost never adjacent here. False when the allocation did not land where the
 * run needs it: the caller leaves the draws apart rather than draw stray bytes.
 */
bool relocateInstance(TransientBufferPool& pool, DrawCommand& cmd, u32 expectedAt) {
    const u32 at = pool.allocVertices(LayoutId::MeshInstance, cmd.instance_stride);
    if (expectedAt != NO_EXPECTED_OFFSET && at != expectedAt) return false;
    // After the alloc: growing the staging can move it.
    u8* base = pool.vertexData(LayoutId::MeshInstance);
    std::memmove(base + at, base + cmd.vertex_byte_offset, cmd.instance_stride);
    cmd.vertex_byte_offset = at;
    return true;
}
}  // namespace

void DrawList::clear() {
    commands_.clear();
    sort_entries_.clear();
    skin_matrices_.clear();
    morph_shapes_.clear();
    probes_.clear();
    probe_slots_.clear();
    merged_draw_calls_ = 0;
    depth_required_ = false;
}

u32 DrawList::addSkinMatrices(const glm::mat4* matrices, u32 count) {
    const u32 at = static_cast<u32>(skin_matrices_.size());
    skin_matrices_.insert(skin_matrices_.end(), matrices, matrices + count);
    return at;
}

u32 DrawList::addMorphShapes(const MorphConstants& shapes) {
    morph_shapes_.push_back(shapes);
    return static_cast<u32>(morph_shapes_.size());
}

u32 DrawList::addProbe(const ProbeConstants& probe) {
    probes_.push_back(probe);
    return static_cast<u32>(probes_.size());
}

void DrawList::push(const DrawCommand& cmd) {
    // Accumulated where commands ENTER, not scanned where the answer is wanted:
    // push is the one funnel every render path goes through, so a path added
    // later cannot produce a depth draw this fails to count. See needsDepth.
    depth_required_ = depth_required_ || cmd.depth_test || cmd.depth_write;
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
            if (blocker == BatchBreak::None && head.instance_count != 0) {
                // One more instance of geometry already being drawn. The head's
                // own record moves first, so the run has somewhere to grow.
                const u32 stride = head.instance_stride;
                bool ok = head.instances_relocated
                       || relocateInstance(pool, head, NO_EXPECTED_OFFSET);
                if (ok) {
                    ok = relocateInstance(pool, commands_[i],
                                          head.vertex_byte_offset + head.instance_count * stride);
                }
                if (ok) {
                    head.instances_relocated = true;
                    head.instance_count += commands_[i].instance_count;
                    head.entity_count += commands_[i].entity_count;
                    // One more instance in this run, and its own irradiance with
                    // it: the merge is the last place an instance's probe and its
                    // position in the run are both known.
                    probe_slots_.push_back(commands_[i].probe_index);
                    didMerge = true;
                } else {
                    blocker = BatchBreak::Instanced;
                }
            } else if (blocker == BatchBreak::None) {
                if (head.layout_id == LayoutId::Batch && commands_[i].texture_count >= 1) {
                    // Multi-texture: give this command's texture a slot in the head's set
                    // (or bail to a new draw if all 8 slots are taken), then stamp its verts.
                    const u8 slotBudget =
                        static_cast<u8>(MAX_CMD_TEXTURE_SLOTS - mask_2d_slots_);
                    i32 slot = head.addTextureSlot(commands_[i].texture_ids[0], slotBudget);
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
            if (commands_[writeIdx].instance_count != 0) {
                commands_[writeIdx].probe_base = static_cast<u32>(probe_slots_.size());
                probe_slots_.push_back(commands_[writeIdx].probe_index);
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
                       FrameCapture* capture, const PerDrawBlockSet& blocks) {
    PipelineDesc lastDesc{};
    PipelineHandle lastHandle = PipelineHandle::Invalid;

    // Once for the pass, not once per draw: every resident mesh reads the same
    // texture. Rebound each pass because growing it mints a new handle.
    if (buffers.instanceTexture() != TextureHandle::Invalid) {
        device.bindTexture(MESH_INSTANCE_TEXTURE_UNIT, buffers.instanceTexture());
    }

    for (u32 i = 0; i < merged_draw_calls_; ++i) {
        const auto& cmd = commands_[i];

        const GfxStencilMode stencil = stencilModeOf(cmd.state_flags);

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

        // The pose, for a draw that has one — in a buffer of this draw's own. A
        // block shared between two draws of one pass is read by both with what
        // the last wrote, which is a room of characters in one pose.
        if (cmd.skin_count > 0 && blocks.skin) {
            device.setUniformBuffer(
                SKIN_CONSTANTS_BINDING,
                blocks.skin->write(skin_matrices_.data() + cmd.skin_offset,
                                   cmd.skin_count * static_cast<u32>(sizeof(glm::mat4))));
        }

        // The shapes, the same way — and a draw with none binds the zeroed block
        // rather than erasing the last one's, so "unshaped" is an object instead
        // of an erasure someone has to remember to perform.
        if (blocks.morph) {
            device.setUniformBuffer(MORPH_CONSTANTS_BINDING,
                                    cmd.morph_index > 0
                                        ? blocks.morph->write(&morph_shapes_[cmd.morph_index - 1],
                                                              sizeof(MorphConstants))
                                        : blocks.morph->zero());
        }

        // WHERE this draw's instances read their irradiance, not what it is: the
        // coefficients are in the frame's texture, one run per instance, so a
        // merged draw holding objects in many places still says one thing here.
        if (blocks.probe) {
            // Every instance of this run, in the order it draws them, capped at
            // what the block holds — a longer run carries no irradiance at all,
            // so its tail reads zeroes and takes the environment.
            const u32 runs = std::min(cmd.instance_count > 0 ? cmd.instance_count : 1u,
                                      PROBE_MAX_INSTANCES);
            probe_run_.assign(static_cast<size_t>(runs) * PROBE_TEXELS, glm::vec4(0.0f));
            for (u32 n = 0; n < runs; ++n) {
                const size_t at = static_cast<size_t>(cmd.probe_base) + n;
                const u32 index = at < probe_slots_.size() ? probe_slots_[at] : 0u;
                if (index == 0) continue;
                std::memcpy(&probe_run_[static_cast<size_t>(n) * PROBE_TEXELS],
                            probes_[index - 1].irradiance, sizeof(ProbeConstants));
            }
            device.setUniformBuffer(
                PROBE_CONSTANTS_BINDING,
                blocks.probe->write(probe_run_.data(),
                                    static_cast<u32>(probe_run_.size() * sizeof(glm::vec4))));
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
        // A draw that samples binds every unit its shader declares, not only the
        // ones it reads: an untouched unit holds what the last draw put there, in
        // any pass. The fill is a STABLE white, so unused units cost no rebind.
        if (cmd.texture_count > 0) {
            for (u8 slot = 0; slot < MAX_CMD_TEXTURE_SLOTS; ++slot) {
                // The top units are the frame's screen-space light masks wherever one
                // exists — the merge was kept off them, so what a draw holds there is
                // the mask, or the fill where the pass drew nothing.
                const bool masked = slot >= MAX_CMD_TEXTURE_SLOTS - mask_2d_slots_;
                u32 tex = masked ? (mask_2d_textures_[slot] != 0 ? mask_2d_textures_[slot]
                                                                 : white_texture_id)
                                 : ((slot < cmd.texture_count) ? cmd.texture_ids[slot]
                                                               : white_texture_id);
                device.bindTexture(slot, TextureHandle{tex});
            }
        }

        if (cmd.hasPersistentGeometry()) {
            // gl_InstanceID restarts at zero every draw while the frame's
            // records are one continuous run, so a draw has to say where its own
            // run begins in them.
            if (blocks.instance) {
                const InstanceConstants at{cmd.vertex_byte_offset / MESH_INSTANCE_STRIDE, {}};
                device.setUniformBuffer(INSTANCE_CONSTANTS_BINDING,
                                        blocks.instance->write(&at, sizeof(at)));
            }
            device.setVertexBuffer(0, cmd.vertex_buffer, 0);
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