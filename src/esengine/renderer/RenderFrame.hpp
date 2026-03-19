#pragma once

#include "../core/Types.hpp"
#include "RenderItem.hpp"
#include "RenderTarget.hpp"
#include "RenderContext.hpp"
#include "RenderTypePlugin.hpp"
#ifdef ES_ENABLE_POSTPROCESS
#include "PostProcessPipeline.hpp"
#endif
#include "FrameCapture.hpp"
#include "GfxDevice.hpp"
#include "StateTracker.hpp"
#include "TransientBufferPool.hpp"
#include "DrawList.hpp"
#include "ClipState.hpp"
#include "../ecs/Registry.hpp"
#include "../resource/ResourceManager.hpp"

#include <glm/glm.hpp>
#include <vector>
#include <memory>
#include <unordered_map>

namespace esengine {

struct Plane {
    glm::vec3 normal;
    f32 distance;
    f32 signedDistance(const glm::vec3& point) const;
};

struct Frustum {
    Plane planes[6];
    void extractFromMatrix(const glm::mat4& vp);
    bool intersectsAABB(const glm::vec3& center, const glm::vec3& halfExtents) const;
};

class RenderFrame {
public:
    struct Stats {
        u32 draw_calls = 0;
        u32 triangles = 0;
        u32 sprites = 0;
#ifdef ES_ENABLE_SPINE
        u32 spine = 0;
#endif
        u32 meshes = 0;
        u32 text = 0;
        u32 particles = 0;
        u32 shapes = 0;
        u32 culled = 0;
    };

    RenderFrame(GfxDevice& device, RenderContext& context, resource::ResourceManager& resource_manager);
    ~RenderFrame();

    RenderFrame(const RenderFrame&) = delete;
    RenderFrame& operator=(const RenderFrame&) = delete;

    void init(u32 width, u32 height);
    void shutdown();
    void resize(u32 width, u32 height);

    void begin(const glm::mat4& view_projection, RenderTargetManager::Handle target = 0);
    void flush();
    void end();

    void processMasks(ecs::Registry& registry, i32 vpX, i32 vpY, i32 vpW, i32 vpH);

    void setEntityClipRect(u32 entity, i32 x, i32 y, i32 w, i32 h);
    void clearEntityClipRect(u32 entity);
    void clearAllClipRects();

    void setEntityStencilMask(u32 entity, i32 refValue);
    void setEntityStencilTest(u32 entity, i32 refValue);
    void clearEntityStencilMask(u32 entity);
    void clearAllStencilMasks();
    void beginStencilWrite(i32 refValue);
    void endStencilWrite();
    void beginStencilTest(i32 refValue);
    void endStencilTest();

    void submitTileQuad(
        const glm::vec2& position, const glm::vec2& size,
        const glm::vec2& uvOffset, const glm::vec2& uvScale,
        const glm::vec4& color, u32 textureId,
        Entity entity, i32 layer, f32 depth
    );

#ifdef ES_ENABLE_SPINE
    void submitSpineBatch(
        const f32* vertices, i32 vertexCount,
        const u16* indices, i32 indexCount,
        u32 textureId, i32 blendMode,
        const f32* transform16,
        Entity entity, i32 layer, f32 depth
    );
#endif

    void setStage(RenderStage stage) { current_stage_ = stage; }
    RenderStage getStage() const { return current_stage_; }

#ifdef ES_ENABLE_POSTPROCESS
    PostProcessPipeline* postProcess() { return post_process_.get(); }
#endif
    RenderTargetManager& targetManager() { return target_manager_; }

    const Stats& stats() const { return stats_; }
    FrameCapture& frameCapture() { return frame_capture_; }

    void replayToDrawCall(i32 stopAtDrawCall);
    const u8* getSnapshotPixels() const { return snapshot_pixels_.data(); }
    u32 getSnapshotSize() const { return static_cast<u32>(snapshot_pixels_.size()); }
    u32 getSnapshotWidth() const { return width_; }
    u32 getSnapshotHeight() const { return height_; }

    void addPlugin(std::unique_ptr<RenderTypePlugin> plugin);
    void collectAll(ecs::Registry& registry, u32 skipFlags = 0);

    static constexpr u32 STAGE_COUNT = 4;

private:
    GfxDevice& device_;
    RenderContext& context_;
    resource::ResourceManager& resource_manager_;
    StateTracker state_tracker_;

#ifdef ES_ENABLE_POSTPROCESS
    Unique<PostProcessPipeline> post_process_;
#endif
    RenderTargetManager target_manager_;

    glm::mat4 view_projection_{1.0f};
    Frustum frustum_;
    RenderTargetManager::Handle current_target_ = 0;
    RenderStage current_stage_ = RenderStage::Transparent;

    Stats stats_;
    FrameCapture frame_capture_;
    std::vector<u8> snapshot_pixels_;
    RenderTargetManager::Handle replay_rt_ = 0;
    bool in_frame_ = false;
    bool flushed_ = false;
    u32 width_ = 0;
    u32 height_ = 0;

    std::unordered_map<u32, ScissorRect> clip_rects_;

    struct EntityStencilInfo {
        i32 ref_value = 0;
        bool is_mask = false;
    };
    std::unordered_map<u32, EntityStencilInfo> stencil_masks_;

    u32 batch_shader_id_ = 0;
    TransientBufferPool pool_;
    DrawList draw_list_;
    ClipState clip_state_;
    std::vector<std::unique_ptr<RenderTypePlugin>> plugins_;

    RenderFrameContext makeContext();
    void buildClipState();
    u32 initBatchShader();
};

}  // namespace esengine
