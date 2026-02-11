#pragma once

#include "../core/Types.hpp"
#include "RenderItem.hpp"
#include "RenderTarget.hpp"
#include "RenderContext.hpp"
#include "PostProcessPipeline.hpp"
#include "../ecs/Registry.hpp"
#include "../resource/ResourceManager.hpp"

#include <glm/glm.hpp>
#include <array>
#include <vector>

namespace esengine {

class BatchRenderer2D;

#ifdef ES_ENABLE_SPINE
namespace spine {
    class SpineSystem;
}
#endif

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
    void flush();
    void end();

    void submitSprites(ecs::Registry& registry);
#ifdef ES_ENABLE_SPINE
    void submitSpine(ecs::Registry& registry, spine::SpineSystem& spine_system);
#endif

    void submit(const RenderItem& item);
    void submitExternalTriangles(
        const f32* vertices, i32 vertexCount,
        const u16* indices, i32 indexCount,
        u32 textureId, i32 blendMode,
        const f32* transform16);
    void setStage(RenderStage stage) { current_stage_ = stage; }
    RenderStage getStage() const { return current_stage_; }

    PostProcessPipeline* postProcess() { return post_process_.get(); }
    RenderTargetManager& targetManager() { return target_manager_; }

    const Stats& stats() const { return stats_; }

    static constexpr u32 STAGE_COUNT = 4;

private:
    void sortAndBucket();
    void executeStage(RenderStage stage);
    void renderSprites(u32 begin, u32 end);
    void renderSpriteWithMaterial(RenderItem* item);
#ifdef ES_ENABLE_SPINE
    void renderSpine(u32 begin, u32 end);
    void flushSpineBatch();
#endif
    void renderMeshes(u32 begin, u32 end);
    void renderExternalMeshes(u32 begin, u32 end);

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
    bool flushed_ = false;
    u32 width_ = 0;
    u32 height_ = 0;

    struct StageBoundary {
        u32 begin = 0;
        u32 end = 0;
    };
    std::array<StageBoundary, STAGE_COUNT> stage_boundaries_{};

#ifdef ES_ENABLE_SPINE
    std::vector<f32> spine_world_vertices_;
    struct SpineVertex {
        glm::vec2 position;
        glm::vec2 uv;
        glm::vec4 color;
    };
    std::vector<SpineVertex> spine_vertices_;
    std::vector<u16> spine_indices_;
    u32 spine_current_texture_ = 0;
    BlendMode spine_current_blend_ = BlendMode::Normal;

    u32 spine_vao_ = 0;
    u32 spine_vbo_ = 0;
    u32 spine_ebo_ = 0;
    u32 spine_vbo_capacity_ = 0;
    u32 spine_ebo_capacity_ = 0;
#endif

    u32 ext_mesh_vao_ = 0;
    u32 ext_mesh_vbo_ = 0;
    u32 ext_mesh_ebo_ = 0;
    u32 ext_mesh_vbo_capacity_ = 0;
    u32 ext_mesh_ebo_capacity_ = 0;

    std::vector<std::vector<f32>> ext_vertex_storage_;
    std::vector<std::vector<u16>> ext_index_storage_;
    u32 ext_submit_order_ = 0;

    u32 mat_sprite_vao_ = 0;
    u32 mat_sprite_vbo_ = 0;
    u32 mat_sprite_ebo_ = 0;
    bool mat_sprite_ebo_initialized_ = false;
};

}  // namespace esengine
