#pragma once

#include "../core/Types.hpp"
#include "DrawCommand.hpp"
#include "StateTracker.hpp"
#include "TransientBufferPool.hpp"
#include "FrameCapture.hpp"

#include <glm/glm.hpp>
#include <vector>

namespace esengine {

class DrawList {
public:
    void clear();
    void push(const DrawCommand& cmd);

    void finalize();

    void execute(StateTracker& state, TransientBufferPool& buffers,
                 const glm::mat4& viewProjection,
                 FrameCapture* capture = nullptr);

    u32 commandCount() const { return static_cast<u32>(commands_.size()); }
    u32 mergedDrawCallCount() const { return merged_draw_calls_; }

    const DrawCommand* commands() const { return commands_.data(); }
    const DrawCommand& command(u32 index) const { return commands_[index]; }

private:
    struct SortEntry {
        u64 key;
        u32 index;
    };

    std::vector<DrawCommand> commands_;
    std::vector<SortEntry> sort_entries_;
    u32 merged_draw_calls_ = 0;
};

}  // namespace esengine
