#pragma once

#include "../core/Types.hpp"
#include "RenderItem.hpp"
#include "RenderTarget.hpp"
#include "RenderContext.hpp"
#include "PostProcessPipeline.hpp"
#include "../ecs/Registry.hpp"
#include "../resource/ResourceManager.hpp"

#include <glm/glm.hpp>
#include <vector>

namespace esengine {

class BatchRenderer2D;

namespace spine {
    class SpineSystem;
}

class RenderFrame {
public:
    struct Stats {
        u32 draw_calls = 0;
        u32 triangles = 0;
        u32 sprites = 0;
        u32 spine = 0;
        u32 meshes = 0;
        u32 culled = 0;
    };

    RenderFrame(RenderContext& context, resource::ResourceManager& resource_manager);
    ~RenderFrame();

    RenderFrame(const RenderFrame&) = delete;
    RenderFrame& operator=(const RenderFrame&) = delete;

    void init(u32 width, u32 height);
    void shutdown();
    void resize(u32 width, u32 height);

    void begin(const glm::mat4& view_projection, RenderTargetManager::Handle target = 0);
    void end();

    void submitSprites(ecs::Registry& registry);
    void submitSpine(ecs::Registry& registry, spine::SpineSystem& spine_system);

    void submit(const RenderItem& item);
    void setStage(RenderStage stage) { current_stage_ = stage; }
    RenderStage getStage() const { return current_stage_; }

    PostProcessPipeline* postProcess() { return post_process_.get(); }
    RenderTargetManager& targetManager() { return target_manager_; }

    const Stats& stats() const { return stats_; }

private:
    void sortItems();
    void executeStage(RenderStage stage);
    void renderSprites(const std::vector<RenderItem*>& items);
    void renderSpriteWithMaterial(RenderItem* item);
    void renderSpine(const std::vector<RenderItem*>& items);
    void renderMeshes(const std::vector<RenderItem*>& items);
    void flushSpineBatch();

    RenderContext& context_;
    resource::ResourceManager& resource_manager_;

    Unique<BatchRenderer2D> batcher_;
    Unique<PostProcessPipeline> post_process_;
    RenderTargetManager target_manager_;

    std::vector<RenderItem> items_;
    glm::mat4 view_projection_{1.0f};
    RenderTargetManager::Handle current_target_ = 0;
    RenderStage current_stage_ = RenderStage::Transparent;

    Stats stats_;
    bool in_frame_ = false;
    u32 width_ = 0;
    u32 height_ = 0;

    std::vector<f32> spine_world_vertices_;
    struct SpineVertex {
        glm::vec2 position;
        glm::vec2 uv;
        glm::vec4 color;
    };
    std::vector<SpineVertex> spine_vertices_;
    std::vector<u32> spine_indices_;
    u32 spine_current_texture_ = 0;
    BlendMode spine_current_blend_ = BlendMode::Normal;
};

}  // namespace esengine
