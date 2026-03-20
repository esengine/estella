#pragma once

#include "../core/Types.hpp"
#include "RenderStage.hpp"
#include "RenderItem.hpp"
#include "DrawCommand.hpp"
#include "DrawList.hpp"
#include "ClipState.hpp"
#include "TransientBufferPool.hpp"
#include "StateTracker.hpp"
#include "../ecs/Registry.hpp"
#include "../resource/ResourceManager.hpp"

#include <glm/glm.hpp>

namespace esengine {

struct Frustum;
class RenderContext;

struct RenderFrameContext {
    RenderContext& render_context;
    resource::ResourceManager& resources;
    u32 white_texture_id = 0;
    u32 batch_shader_id = 0;
    RenderStage current_stage = RenderStage::Transparent;
    glm::mat4 view_projection{1.0f};
};

struct RenderCollectContext {
    ecs::Registry& registry;
    const Frustum& frustum;
    const ClipState& clip_state;
    TransientBufferPool& buffer_pool;
    DrawList& draw_list;
    RenderFrameContext& frame_context;
};

class RenderTypePlugin {
public:
    virtual ~RenderTypePlugin() = default;

    virtual void init(RenderFrameContext& ctx) { (void)ctx; }
    virtual void shutdown() {}

    virtual u32 skipFlag() const { return 0; }

    virtual void collect(RenderCollectContext& ctx) = 0;

    virtual bool needsCustomDraw() const { return false; }
    virtual bool handlesType(RenderType type) const { (void)type; return false; }
    virtual void customDraw(const DrawCommand& cmd,
                            StateTracker& state,
                            TransientBufferPool& buffers,
                            RenderFrameContext& ctx) {
        (void)cmd; (void)state; (void)buffers; (void)ctx;
    }
};

}  // namespace esengine
