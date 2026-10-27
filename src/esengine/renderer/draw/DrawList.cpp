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
    // Every record of the draw: one for an entity, as many as it has instances for a set of placements.
    const u32 bytes = cmd.instance_stride * std::max(cmd.instance_count, 1u);
    const u32 at = pool.allocVertices(LayoutId::MeshInstance, bytes);
    if (expectedAt != NO_EXPECTED_OFFSET && at != expectedAt) return false;
    // After the alloc: growing the staging can move it.
    u8* base = pool.vertexData(LayoutId::MeshInstance);
    std::memmove(base + at, base + cmd.vertex_byte_offset, bytes);
    cmd.vertex_byte_offset = at;
    return true;
}

bool joinBatchIndexRanges(TransientBufferPool& pool, DrawCommand& head, DrawCommand& next) {
    const u32 used = pool.indicesUsed(LayoutId::Batch);
    const u32 vertexBytes = pool.vertexBytesUsed(LayoutId::Batch);
    const u32 stride = pool.vertexStride(LayoutId::Batch);
    if (stride == 0) return false;
    const auto owned = [&](const DrawCommand& cmd) {
        return cmd.vertex_buffer == BufferHandle::Invalid && cmd.index_buffer == BufferHandle::Invalid
            && cmd.index_count != 0 && cmd.index_offset <= used && cmd.index_count <= used - cmd.index_offset
            && cmd.vertex_byte_offset <= vertexBytes
            && cmd.vertex_count <= (vertexBytes - cmd.vertex_byte_offset) / stride;
    };
    if (!owned(head) || !owned(next) || head.depth_bias != next.depth_bias
        || head.topology != next.topology) return false;
    u32 at;
    if (head.index_offset + head.index_count != used) {
        if (!pool.copyIndexRange(LayoutId::Batch, head.index_offset, head.index_count, at)) return false;
        head.index_offset = at;
    }
    if (!pool.copyIndexRange(LayoutId::Batch, next.index_offset, next.index_count, at)) return false;
    next.index_offset = at;
    return head.index_offset + head.index_count == next.index_offset;
}
}  // namespace

void DrawList::clear() {
    commands_.clear();
    entity_counts_.fill(0);
    skin_matrices_.clear();
    morph_shapes_.clear();
    probes_.clear();
    planar_.clear();
    probe_slots_.clear();
    run_entities_.clear();
    run_first_.clear();
    merged_draw_calls_ = 0;
    depth_required_ = false;
    ui_stencil_required_ = false;
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
    const auto type = static_cast<u32>(cmd.type);
    if (type < entity_counts_.size()) entity_counts_[type] += cmd.entity_count;
    commands_.push_back(cmd);
    ui_stencil_required_ = ui_stencil_required_ || (cmd.state_flags & CMD_STATE_UI_STENCIL);
}

void DrawList::finalize(TransientBufferPool& pool) {
    u32 count = static_cast<u32>(commands_.size());
    if (count == 0) {
        merged_draw_calls_ = 0;
        merged_away_ = 0;
        std::fill(std::begin(breaks_), std::end(breaks_), 0u);
        return;
    }

    // The order the keys give is the order the last frame's identical keys gave: the sort below is a function of the key sequence alone, so a
    // frame whose keys match is not sorted again. Sprites that move rarely change their key (2D keys hold layer, shader, blend and material, not
    // where a sprite is), which makes this the common frame.
    bool sameKeys = sorted_keys_.size() == count && sort_entries_.size() == count;
    for (u32 i = 0; sameKeys && i < count; ++i) sameKeys = sorted_keys_[i] == commands_[i].sort_key;
    ES_PROFILE_COUNTER("batch.sortReused", sameKeys ? 1 : 0);
    if (!sameKeys) {
        sort_entries_.resize(count);
        sorted_keys_.resize(count);
        for (u32 i = 0; i < count; ++i) {
            sort_entries_[i] = { commands_[i].sort_key, i };
            sorted_keys_[i] = commands_[i].sort_key;
        }

        // Tie-break on emit index so same-key commands keep submission order: that keeps an
        // emit-contiguous run contiguous after sorting, which is what lets the merge coalesce it
        // (including across different textures, now that texture is out of the key).
        std::sort(sort_entries_.begin(), sort_entries_.end(),
                  [](const SortEntry& a, const SortEntry& b) {
                      return a.key < b.key || (a.key == b.key && a.index < b.index);
                  });
    }

    // Gather into a reused scratch buffer (not a fresh per-frame vector) and swap
    // it with commands_, so the allocation is amortized across frames.
    sorted_scratch_.resize(count);
    for (u32 i = 0; i < count; ++i) {
        sorted_scratch_[i] = commands_[sort_entries_[i].index];
    }
    commands_.swap(sorted_scratch_);

    // Sorted UI order is a preorder walk. Reuse each mask's exact geometry to
    // restore its parent when the walk leaves that subtree; no new vertices,
    // rectangular approximation, or per-depth texture is needed.
    if (ui_stencil_required_) {
        stencil_commands_scratch_.clear();
        stencil_stack_scratch_.clear();
        stencil_level_first_.clear();
        const auto leaveMask = [&]() {
            const u32 first = stencil_level_first_.back();
            stencil_level_first_.pop_back();
            while (stencil_stack_scratch_.size() > first) {
                stencil_commands_scratch_.push_back(stencil_stack_scratch_.back());
                auto& restore = stencil_commands_scratch_.back();
                stencil_stack_scratch_.pop_back();
                restore.state_flags |= restore.stencil_depth == 1
                    ? CMD_STATE_STENCIL_ZERO : CMD_STATE_STENCIL_DECREMENT;
                restore.entity_count = 0;
                restore.entity = INVALID_ENTITY;
                restore.depth_test = false;
                restore.depth_write = false;
            }
        };
        for (const DrawCommand& source : commands_) {
            const bool ui = (source.state_flags & CMD_STATE_UI_STENCIL) != 0;
            const bool mask = ui && (source.state_flags & CMD_STATE_STENCIL_WRITE);
            const bool continuation = mask && !stencil_stack_scratch_.empty()
                && stencil_stack_scratch_.back().entity == source.entity
                && stencil_stack_scratch_.back().stencil_depth == source.stencil_depth;
            const u32 wanted = ui ? source.stencil_depth - (mask && !continuation ? 1 : 0) : 0;
            while (stencil_level_first_.size() > wanted) leaveMask();
            // A culled or absent mask cannot license a child's draw against stale
            // attachment values. A later root can still enter normally.
            if (ui && stencil_level_first_.size() != wanted) continue;
            stencil_commands_scratch_.push_back(source);
            auto& command = stencil_commands_scratch_.back();
            if (mask) {
                if (!continuation) {
                    stencil_level_first_.push_back(static_cast<u32>(stencil_stack_scratch_.size()));
                }
                stencil_stack_scratch_.push_back(command);
                command.depth_test = false;
                command.depth_write = false;
                if (command.stencil_depth > 1) {
                    command.state_flags |= CMD_STATE_STENCIL_INCREMENT;
                    --command.stencil_ref;
                }
            }
        }
        while (!stencil_level_first_.empty()) leaveMask();
        commands_.swap(stencil_commands_scratch_);
        count = static_cast<u32>(commands_.size());
    }

    merged_draw_calls_ = 0;
    run_entities_.clear();
    run_first_.clear();
    u32 writeIdx = 0;
    u32 breaks[static_cast<u32>(BatchBreak::Count)] = {};

    for (u32 i = 0; i < count; ++i) {
        bool didMerge = false;
        BatchBreak blocker = BatchBreak::RunStart;
        if (writeIdx > 0) {
            DrawCommand& head = commands_[writeIdx - 1];
            blocker = head.mergeBlocker(commands_[i]);
            // Reject a new sampler before moving indices: a full run cannot
            // use that copy. Existing samplers still fit at the slot ceiling.
            if ((blocker == BatchBreak::None || blocker == BatchBreak::IndexGap)
                && head.layout_id == LayoutId::Batch && commands_[i].texture_count >= 1
                && head.texture_count >= MAX_CMD_TEXTURE_SLOTS - mask_2d_slots_) {
                const auto* begin = head.texture_ids;
                const auto* end = begin + head.texture_count;
                if (std::find(begin, end, commands_[i].texture_ids[0]) == end) {
                    blocker = BatchBreak::TextureSlots;
                }
            }
            if (blocker == BatchBreak::IndexGap && head.layout_id == LayoutId::Batch
                && joinBatchIndexRanges(pool, head, commands_[i])) {
                blocker = head.mergeBlocker(commands_[i]);
            }
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
                    probe_slots_.insert(probe_slots_.end(), std::max(commands_[i].instance_count, 1u), commands_[i].probe_index);
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
            run_first_.push_back(static_cast<u32>(run_entities_.size()));
            if (commands_[writeIdx].instance_count != 0) {
                commands_[writeIdx].probe_base = static_cast<u32>(probe_slots_.size());
                probe_slots_.insert(probe_slots_.end(), commands_[writeIdx].instance_count, commands_[writeIdx].probe_index);
            }
            commands_[writeIdx].break_reason = blocker;
            ++breaks[static_cast<u32>(blocker)];
            // The run head owns slot 0; staging verts already default to texIndex 0,
            // so it needs no rewrite (this is the common single-texture case).
            ++writeIdx;
        }
        if (commands_[i].entity != INVALID_ENTITY) run_entities_.push_back(commands_[i].entity);
    }
    commands_.resize(writeIdx);
    merged_draw_calls_ = writeIdx;

    merged_away_ = count - merged_draw_calls_;
    std::copy(std::begin(breaks), std::end(breaks), std::begin(breaks_));
}

std::span<const Entity> DrawList::runEntities(u32 index) const {
    if (index >= run_first_.size()) return {};
    const u32 first = run_first_[index];
    const u32 end = index + 1 < run_first_.size() ? run_first_[index + 1]
                                                  : static_cast<u32>(run_entities_.size());
    return {run_entities_.data() + first, end - first};
}

void DrawList::stageBlocks(const PerDrawBlockSet& blocks) {
    staged_.assign(merged_draw_calls_, StagedBlocks{});
    for (u32 i = 0; i < merged_draw_calls_; ++i) {
        const auto& cmd = commands_[i];
        StagedBlocks& staged = staged_[i];

        if (blocks.planar && cmd.planar_index > 0) {
            staged.planar = blocks.planar->stage(&planar_[cmd.planar_index - 1], sizeof(PlanarConstants));
        }
        // The pose, for a draw that has one — in a range of this draw's own. A
        // block shared between two draws of one pass is read by both with what
        // the last wrote, which is a room of characters in one pose.
        if (cmd.skin_count > 0 && blocks.skin) {
            staged.skin = blocks.skin->stage(skin_matrices_.data() + cmd.skin_offset,
                                             cmd.skin_count * static_cast<u32>(sizeof(glm::mat4)));
        }

        // The shapes, the same way — and a draw with none binds the zeroed block
        // rather than erasing the last one's, so "unshaped" is an object instead
        // of an erasure someone has to remember to perform.
        if (blocks.morph && cmd.morph_index > 0) {
            staged.morph = blocks.morph->stage(&morph_shapes_[cmd.morph_index - 1], sizeof(MorphConstants));
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
                            &probes_[index - 1], sizeof(ProbeConstants));
            }
            staged.probe = blocks.probe->stage(
                probe_run_.data(), static_cast<u32>(probe_run_.size() * sizeof(glm::vec4)));
        }

        // gl_InstanceID restarts at zero every draw while the frame's records are
        // one continuous run, so a draw has to say where its own run begins in them.
        if (blocks.instance && cmd.hasPersistentGeometry() && cmd.instance_count != 0) {
            const InstanceConstants at{cmd.vertex_byte_offset / MESH_INSTANCE_STRIDE, {}};
            staged.instance = blocks.instance->stage(&at, sizeof(at));
        }
    }
    for (PerDrawBlocks* pool : {blocks.skin, blocks.morph, blocks.probe, blocks.instance, blocks.planar}) {
        if (pool) pool->upload();
    }
}

bool DrawList::anyUsesSceneColor(const MaterialStore& materials) const {
    for (u32 i = 0; i < merged_draw_calls_; ++i) {
        if (commands_[i].material_id != 0 && materials.usesSceneColor(commands_[i].material_id)) return true;
    }
    return false;
}

/// Whether a draw is in a stage sorted back to front and drawn over what is there, as against the opaque scene: what a blend mode on an opaque draw (a lit material whose
/// alpha is 1) cannot say, and what decides which side of the water a draw is drawn on.
static bool isBlendedStage(RenderStage stage) {
    return stage == RenderStage::Transparent || stage == RenderStage::Overlay;
}

bool DrawList::anyBlendedWithoutSceneColor(const MaterialStore& materials) const {
    for (u32 i = 0; i < merged_draw_calls_; ++i) {
        const auto& cmd = commands_[i];
        if (isBlendedStage(cmd.stage) && !(cmd.material_id != 0 && materials.usesSceneColor(cmd.material_id))) return true;
    }
    return false;
}

/// A draw the prepass takes in: opaque and depth-writing, with a program of its own for it, and nothing that changes where it lands (a stencil).
static bool takesPartInPrepass(const DrawCommand& cmd) {
    return cmd.depth_shader_id != 0 && cmd.depth_test && cmd.depth_write && stencilModeOf(cmd.state_flags) == GfxStencilMode::Off;
}

u32 DrawList::depthPrepassDraws() const {
    u32 n = 0;
    for (u32 i = 0; i < merged_draw_calls_; ++i) {
        if (takesPartInPrepass(commands_[i])) ++n;
    }
    return n;
}

bool DrawList::anyUsesSceneDepth(const MaterialStore& materials) const {
    for (u32 i = 0; i < merged_draw_calls_; ++i) {
        if (commands_[i].material_id != 0 && materials.usesSceneDepth(commands_[i].material_id)) return true;
    }
    return false;
}

void DrawList::execute(GfxDevice& device, TransientBufferPool& buffers,
                       MaterialStore& materials, u32 white_texture_id,
                       FrameCapture* capture, const PerDrawBlockSet& blocks, Phase phase, DrawPass pass) {
    const bool prepass = pass == DrawPass::DepthPrepass;
    const bool afterPrepass = pass == DrawPass::ColorAfterPrepass;
    PipelineDesc lastDesc{};
    PipelineHandle lastHandle = PipelineHandle::Invalid;
    const std::string* lastRun = nullptr;
    skipped_for_program_ = 0;
    const bool skipUnready = device.skipPendingPrograms();
    // The draws of this phase read the scene's colour and compose it under themselves.
    const bool composes = phase == Phase::SceneColorOnly;

    // Once for the pass, not once per draw: every resident mesh reads the same
    // texture. Rebound each pass because growing it mints a new handle.
    if (buffers.instanceTexture() != TextureHandle::Invalid) {
        device.bindTexture(MESH_INSTANCE_TEXTURE_UNIT, buffers.instanceTexture());
    }

    // The colour pass after a prepass is the same list the prepass staged the per-draw blocks for.
    if (!afterPrepass) stageBlocks(blocks);

    for (u32 i = 0; i < merged_draw_calls_; ++i) {
        const auto& cmd = commands_[i];
        const StagedBlocks& staged = staged_[i];
        if (prepass && !takesPartInPrepass(cmd)) continue;
        if (phase != Phase::All) {
            const bool refracts = cmd.material_id != 0 && materials.usesSceneColor(cmd.material_id);
            const bool blended = isBlendedStage(cmd.stage);
            bool drawn = false;
            switch (phase) {
                case Phase::WithoutSceneColor: drawn = !refracts; break;
                case Phase::SceneColorOnly: drawn = refracts; break;
                case Phase::OpaqueOnly: drawn = !refracts && !blended; break;
                case Phase::BlendedOnly: drawn = !refracts && blended; break;
                case Phase::All: drawn = true; break;
            }
            if (!drawn) continue;
        }

        if (shader_run_sink_) {
            const std::string& run = materials.shaderLabel(cmd.material_id);
            if (&run != lastRun && (!lastRun || run != *lastRun)) shader_run_sink_(run.c_str());
            lastRun = &run;
        }

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
        desc.depthBias = cmd.depth_bias;
        desc.topology = cmd.topology;
        desc.alphaToCoverage = !desc.blendEnabled && materials.alphaIsCoverage(cmd.material_id);
        // Only what replaces what was behind it records a surface (a blended normal is no one's), except a
        // draw that composes the scene behind it (water, refracting glass): it IS the pixel, so it owns its
        // record, written unblended where the device can say so per target.
        desc.gbuffer = gbuffer_pass_ && materials.programWritesGBuffer(cmd.shader_id)
                    && (!desc.blendEnabled || (composes && device.supportsUnblendedSurfaceTarget()));
        if (prepass) {
            // Depth alone: the draw's depth program, unblended, no colour to either attachment. A cut-out keeps the alpha-to-coverage the colour pass draws with.
            desc.program = ShaderHandle{cmd.depth_shader_id};
            desc.blend = BlendMode::None;
            desc.blendEnabled = false;
            desc.gbuffer = false;
            desc.colorWrite = false;
        } else if (afterPrepass && takesPartInPrepass(cmd)) {
            // Its depth is already in the buffer: it lands where it is level with it, and writes nothing there again.
            desc.depthEqual = true;
            desc.depthWrite = false;
        }

        // A program still compiling in the background: this draw waits for a later frame instead of making this one wait for it.
        if (skipUnready && desc.program != ShaderHandle::Invalid && !device.programReady(desc.program)) {
            ++skipped_for_program_;
            continue;
        }

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

        if (cmd.skin_count > 0 && blocks.skin) {
            blocks.skin->bind(SKIN_CONSTANTS_BINDING, staged.skin);
        }
        if (blocks.morph) {
            blocks.morph->bind(MORPH_CONSTANTS_BINDING, staged.morph);
        }
        if (blocks.probe) {
            blocks.probe->bind(PROBE_CONSTANTS_BINDING, staged.probe);
        }

        if (blocks.planar) blocks.planar->bind(PLANAR_CONSTANTS_BINDING, staged.planar);

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
        // A draw that samples binds every unit its shader declares, not only the ones it reads: an untouched unit holds what the last draw
        // put there, in any pass, the prepass too (a vertex hook reads textures). The fill is a STABLE white, so unused units cost no rebind.
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
            // Geometry the GPU already holds: instanced when it is a mesh placed by records, plain when it is a run of quads a plugin keeps
            // between frames (a tilemap's chunk strip), which has no records and draws once.
            if (blocks.instance && cmd.instance_count != 0) {
                blocks.instance->bind(INSTANCE_CONSTANTS_BINDING, staged.instance);
            }
            device.setVertexBuffer(0, cmd.vertex_buffer, 0);
            device.setIndexBuffer(cmd.index_buffer);
            const u32 firstIndexByte = static_cast<u32>(static_cast<uintptr_t>(cmd.index_offset) * sizeof(u32));
            if (cmd.instance_count != 0) {
                device.drawElementsInstanced(cmd.index_count, GfxDataType::UnsignedInt, firstIndexByte, cmd.instance_count);
            } else {
                device.drawElements(cmd.index_count, GfxDataType::UnsignedInt, firstIndexByte);
            }
        } else if (cmd.instance_count > 0) {
            // Instanced: static geometry (index_count indices from offset 0) drawn
            // instance_count times, instance attributes rebased at vertex_byte_offset.
            if (cmd.instance_buffer != BufferHandle::Invalid) {
                buffers.bindInstanceBuffer(cmd.layout_id, cmd.instance_buffer);
            } else {
                buffers.bindInstanceLayout(cmd.layout_id, cmd.vertex_byte_offset);
            }
            device.drawElementsInstanced(cmd.index_count, GfxDataType::UnsignedInt, 0, cmd.instance_count);
        } else {
            buffers.bindLayout(cmd.layout_id);
            device.drawElements(
                cmd.index_count,
                GfxDataType::UnsignedInt,
                static_cast<u32>(static_cast<uintptr_t>(cmd.index_offset) * sizeof(u32)));
        }

        if (capture && !prepass) {
            if (capture->isReplaying()) {
                if (capture->stepReplay()) break;
            } else if (capture->isCapturing()) {
                capture->record(cmd, runEntities(i));
            }
        }
    }
}

}  // namespace esengine
