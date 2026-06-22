#include "DrawList.hpp"

#include <glm/glm.hpp>
#include <algorithm>

namespace esengine {

void DrawList::clear() {
    commands_.clear();
    sort_entries_.clear();
    merged_draw_calls_ = 0;
}

void DrawList::push(const DrawCommand& cmd) {
    commands_.push_back(cmd);
}

void DrawList::finalize() {
    u32 count = static_cast<u32>(commands_.size());
    if (count == 0) {
        merged_draw_calls_ = 0;
        return;
    }

    sort_entries_.resize(count);
    for (u32 i = 0; i < count; ++i) {
        sort_entries_[i] = { commands_[i].sort_key, i };
    }

    std::sort(sort_entries_.begin(), sort_entries_.end(),
              [](const SortEntry& a, const SortEntry& b) {
                  return a.key < b.key;
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
        if (writeIdx > 0 && commands_[writeIdx - 1].canMergeWith(commands_[i])) {
            commands_[writeIdx - 1].index_count += commands_[i].index_count;
            commands_[writeIdx - 1].entity_count += commands_[i].entity_count;
        } else {
            if (writeIdx != i) {
                commands_[writeIdx] = commands_[i];
            }
            ++writeIdx;
        }
    }
    commands_.resize(writeIdx);
    merged_draw_calls_ = writeIdx;
}

void DrawList::execute(GfxDevice& device, TransientBufferPool& buffers,
                       FrameCapture* capture) {
    PipelineDesc lastDesc{};
    PipelineHandle lastHandle = PipelineHandle::Invalid;

    for (u32 i = 0; i < merged_draw_calls_; ++i) {
        const auto& cmd = commands_[i];

        GfxStencilMode stencil = GfxStencilMode::Off;
        if (cmd.state_flags & CMD_STATE_STENCIL_WRITE) stencil = GfxStencilMode::Write;
        else if (cmd.state_flags & CMD_STATE_STENCIL_TEST) stencil = GfxStencilMode::Test;

        // Resolve the immutable pipeline. depthWrite stays on with the test off, matching
        // the engine's 2D state. createPipeline caches; a one-entry memo skips the lookup
        // for the common run of identical consecutive (sorted) commands.
        PipelineDesc desc{};
        desc.program = cmd.shader_id;
        desc.vertexLayout = cmd.layout_id;
        desc.blend = cmd.blend_mode;
        desc.blendEnabled = true;
        desc.depthTest = false;
        desc.depthWrite = true;
        desc.stencil = stencil;
        desc.cullEnabled = false;

        if (lastHandle == PipelineHandle::Invalid || !(desc == lastDesc)) {
            lastHandle = device.createPipeline(desc);
            lastDesc = desc;
        }
        device.setPipeline(lastHandle);

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
        for (u8 slot = 0; slot < cmd.texture_count; ++slot) {
            device.bindTexture(slot, cmd.texture_ids[slot]);
        }

        buffers.bindLayout(cmd.layout_id);
        device.drawElements(
            cmd.index_count,
            GfxDataType::UnsignedInt,
            static_cast<u32>(static_cast<uintptr_t>(cmd.index_offset) * sizeof(u32)));

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
