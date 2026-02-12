#pragma once

#include "../core/Types.hpp"
#include "RenderStage.hpp"
#include "BlendMode.hpp"

#include <glm/glm.hpp>

namespace esengine {

struct ScissorRect {
    i32 x = 0, y = 0, w = 0, h = 0;
    bool operator==(const ScissorRect& o) const {
        return x == o.x && y == o.y && w == o.w && h == o.h;
    }
    bool operator!=(const ScissorRect& o) const { return !(*this == o); }
};

enum class RenderType : u8 {
    Sprite = 0,
#ifdef ES_ENABLE_SPINE
    Spine = 1,
#endif
    Mesh = 2,
    ExternalMesh = 3,
    Text = 4,
};

struct RenderItem {
    Entity entity = INVALID_ENTITY;
    RenderType type = RenderType::Sprite;
    RenderStage stage = RenderStage::Transparent;

    glm::mat4 transform{1.0f};
    glm::vec3 world_position{0.0f};
    f32 world_angle = 0.0f;
    glm::vec2 world_scale{1.0f};

    i32 layer = 0;
    f32 depth = 0.0f;
    u32 texture_id = 0;
    BlendMode blend_mode = BlendMode::Normal;

    glm::vec2 size{0.0f};
    glm::vec4 color{1.0f};
    glm::vec2 uv_offset{0.0f};
    glm::vec2 uv_scale{1.0f};
    bool flip_x = false;
    bool flip_y = false;
    bool use_nine_slice = false;
    glm::vec4 slice_border{0.0f};
    glm::vec2 texture_size{0.0f};

#ifdef ES_ENABLE_SPINE
    void* skeleton = nullptr;
    glm::vec4 tint_color{1.0f};
#endif

    void* geometry = nullptr;
    void* shader = nullptr;

    u32 material_id = 0;

    const void* font_data = nullptr;
    const char* text_data = nullptr;
    u16 text_length = 0;
    f32 font_size = 1.0f;
    u8 text_align = 0;
    f32 text_spacing = 0.0f;

    const f32* ext_vertices = nullptr;
    i32 ext_vertex_count = 0;
    const u16* ext_indices = nullptr;
    i32 ext_index_count = 0;
    u32 ext_bind_texture = 0;

    bool scissor_enabled = false;
    ScissorRect scissor;

    u64 sortKey() const {
        u64 stageKey = static_cast<u64>(stage) << 60;

        i32 normalizedLayer = layer + 32768;
        u64 layerKey = static_cast<u64>(normalizedLayer & 0xFFFF) << 44;

        u64 textureKey = static_cast<u64>(texture_id & 0xFFFFF) << 24;

        u32 depthBits;
        if (stage == RenderStage::Transparent) {
            f32 invDepth = 1.0f - (depth * 0.5f + 0.5f);
            depthBits = static_cast<u32>(invDepth * 16777215.0f);
        } else {
            f32 normDepth = depth * 0.5f + 0.5f;
            depthBits = static_cast<u32>(normDepth * 16777215.0f);
        }
        u64 depthKey = static_cast<u64>(depthBits & 0xFFFFFF);

        return stageKey | layerKey | textureKey | depthKey;
    }
};

}  // namespace esengine
