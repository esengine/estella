#pragma once

#include "../core/Types.hpp"
#include "RenderItem.hpp"
#include "TextureSlotAllocator.hpp"
#include "RenderTarget.hpp"
#include "RenderContext.hpp"
#include "PostProcessPipeline.hpp"
#include "../ecs/Registry.hpp"
#include "../resource/ResourceManager.hpp"
#include "../particle/ParticleSystem.hpp"

#include <glm/glm.hpp>
#include <array>
#include <vector>
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

class BatchRenderer2D;

struct MaterialUniformData {
    char name[32];
    u32 type;
    f32 values[4];
};

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
        u32 text = 0;
        u32 particles = 0;
        u32 shapes = 0;
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
    void submitShapes(ecs::Registry& registry);
    void submitBitmapText(ecs::Registry& registry);
    void submitParticles(ecs::Registry& registry, particle::ParticleSystem& particle_system);
#ifdef ES_ENABLE_SPINE
    void submitSpine(ecs::Registry& registry, spine::SpineSystem& spine_system);
#endif

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

    void submit(const RenderItemBase& item, const SpriteData& data);
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
    void accumulateMaterialSprite(const RenderItemBase& base, const SpriteData& data);
    void flushMaterialBatch();
#ifdef ES_ENABLE_SPINE
    void renderSpine(u32 begin, u32 end);
    void flushSpineBatch();
#endif
    void renderMeshes(u32 begin, u32 end);
    void renderExternalMeshes(u32 begin, u32 end);
    void renderText(u32 begin, u32 end);
    void renderParticles(u32 begin, u32 end);
    void renderShapes(u32 begin, u32 end);

    RenderContext& context_;
    resource::ResourceManager& resource_manager_;

    Unique<BatchRenderer2D> batcher_;
    Unique<PostProcessPipeline> post_process_;
    RenderTargetManager target_manager_;

    std::vector<RenderItemBase> items_;

    std::vector<SpriteData> sprite_data_;
    std::vector<TextData> text_data_;
#ifdef ES_ENABLE_SPINE
    std::vector<SpineData> spine_data_;
#endif
    std::vector<ExternalMeshData> ext_data_;
    std::vector<ParticleRenderData> particle_data_;
    std::vector<ShapeData> shape_data_;

    glm::mat4 view_projection_{1.0f};
    Frustum frustum_;
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
        glm::vec3 position;
        glm::vec4 color;
        glm::vec2 uv;
        f32 texIndex;
    };
    std::vector<SpineVertex> spine_vertices_;
    std::vector<u16> spine_indices_;
    BlendMode spine_current_blend_ = BlendMode::Normal;

    static constexpr u32 SPINE_MAX_TEXTURE_SLOTS = 8;
    TextureSlotAllocator<SPINE_MAX_TEXTURE_SLOTS> spine_tex_slots_;
    resource::ShaderHandle spine_shader_handle_;

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
    u32 ext_storage_count_ = 0;
    u32 ext_submit_order_ = 0;

    u32 mat_sprite_vao_ = 0;
    u32 mat_sprite_vbo_ = 0;
    u32 mat_sprite_ebo_ = 0;
    u32 mat_sprite_vbo_capacity_ = 0;
    u32 mat_sprite_ebo_capacity_ = 0;
    u32 mat_sprite_last_shader_ = 0;

    struct MatSpriteVertex {
        f32 px, py;
        f32 tx, ty;
        f32 cr, cg, cb, ca;
    };

    struct MatBatchState {
        u32 material_id = 0;
        u32 texture_id = 0;
        glm::vec4 color{0.0f};
        std::vector<MatSpriteVertex> vertices;
        std::vector<u16> indices;
    };
    MatBatchState mat_batch_;

    u32 particle_vao_ = 0;
    u32 particle_quad_vbo_ = 0;
    u32 particle_instance_vbo_ = 0;
    u32 particle_ebo_ = 0;
    u32 particle_instance_capacity_ = 0;
    resource::ShaderHandle particle_shader_handle_;

    struct ParticleInstanceData {
        glm::vec2 position;
        glm::vec2 size;
        f32 rotation;
        glm::vec4 color;
        glm::vec2 uv_offset;
        glm::vec2 uv_scale;
    };
    std::vector<ParticleInstanceData> particle_instances_;

    struct ShapeVertex {
        f32 px, py;
        f32 ux, uy;
        f32 cr, cg, cb, ca;
        f32 shapeType, halfW, halfH, cornerRadius;
    };
    std::vector<ShapeVertex> shape_vertices_;
    std::vector<u16> shape_indices_;
    u32 shape_vao_ = 0;
    u32 shape_vbo_ = 0;
    u32 shape_ebo_ = 0;
    u32 shape_vbo_capacity_ = 0;
    u32 shape_ebo_capacity_ = 0;
    resource::ShaderHandle shape_shader_handle_;

    std::unordered_map<u32, ScissorRect> clip_rects_;

    struct EntityStencilInfo {
        i32 ref_value = 0;
        bool is_mask = false;
    };
    std::unordered_map<u32, EntityStencilInfo> stencil_masks_;

    std::vector<MaterialUniformData> mat_uniforms_;
};

}  // namespace esengine
