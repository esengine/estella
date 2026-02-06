#pragma once

#include "../core/Types.hpp"
#include "RenderStage.hpp"
#include "BlendMode.hpp"

#include <glm/glm.hpp>

namespace esengine {

enum class RenderType : u8 {
    Sprite = 0,
    Spine = 1,
    Mesh = 2,
};

struct RenderItem {
    Entity entity = INVALID_ENTITY;
    RenderType type = RenderType::Sprite;
    RenderStage stage = RenderStage::Transparent;

    glm::mat4 transform{1.0f};
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

    void* skeleton = nullptr;
    glm::vec4 tint_color{1.0f};

    void* geometry = nullptr;
    void* shader = nullptr;

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
