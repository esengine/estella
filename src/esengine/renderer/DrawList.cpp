#include "DrawList.hpp"

#include <glm/glm.hpp>

#ifdef ES_PLATFORM_WEB
    #include <GLES3/gl3.h>
#else
    #ifdef _WIN32
        #include <windows.h>
    #endif
    #include <glad/glad.h>
#endif

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

    std::vector<DrawCommand> sorted;
    sorted.reserve(count);
    for (u32 i = 0; i < count; ++i) {
        sorted.push_back(commands_[sort_entries_[i].index]);
    }
    commands_ = std::move(sorted);

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

void DrawList::execute(StateTracker& state, TransientBufferPool& buffers,
                       const glm::mat4& viewProjection,
                       FrameCapture* capture) {
    u32 lastShader = 0;
    for (u32 i = 0; i < merged_draw_calls_; ++i) {
        const auto& cmd = commands_[i];

        if (cmd.shader_id != lastShader) {
            state.useProgram(cmd.shader_id);
            GLint loc = glGetUniformLocation(cmd.shader_id, "u_projection");
            if (loc >= 0) {
                glUniformMatrix4fv(loc, 1, GL_FALSE, &viewProjection[0][0]);
            }
            lastShader = cmd.shader_id;
        }
        state.setBlendMode(cmd.blend_mode);

        if (cmd.state_flags & CMD_STATE_SCISSOR) {
            state.setScissorEnabled(true);
            state.setScissor(cmd.scissor.x, cmd.scissor.y, cmd.scissor.w, cmd.scissor.h);
        } else {
            state.setScissorEnabled(false);
        }

        if (cmd.state_flags & CMD_STATE_STENCIL_WRITE) {
            state.beginStencilWrite(cmd.stencil_ref);
        } else if (cmd.state_flags & CMD_STATE_STENCIL_TEST) {
            state.beginStencilTest(cmd.stencil_ref);
        } else {
            state.endStencilTest();
        }

        for (u8 slot = 0; slot < cmd.texture_count; ++slot) {
            state.bindTexture(slot, cmd.texture_ids[slot]);
        }

        buffers.bindLayout(cmd.layout_id);

        glDrawElements(GL_TRIANGLES,
                       static_cast<GLsizei>(cmd.index_count),
                       GL_UNSIGNED_SHORT,
                       reinterpret_cast<void*>(
                           static_cast<uintptr_t>(cmd.index_offset) * sizeof(u16)));

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
