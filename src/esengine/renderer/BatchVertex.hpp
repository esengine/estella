#pragma once

#include "../core/Types.hpp"
#include <glm/glm.hpp>

namespace esengine {

struct BatchVertex {
    glm::vec2 position;
    u32 color;
    glm::vec2 texCoord;
};

inline u32 packColor(const glm::vec4& c) {
    u8 r = static_cast<u8>(c.r * 255.0f + 0.5f);
    u8 g = static_cast<u8>(c.g * 255.0f + 0.5f);
    u8 b = static_cast<u8>(c.b * 255.0f + 0.5f);
    u8 a = static_cast<u8>(c.a * 255.0f + 0.5f);
    return static_cast<u32>(r) | (static_cast<u32>(g) << 8)
         | (static_cast<u32>(b) << 16) | (static_cast<u32>(a) << 24);
}

inline u32 packColor(f32 r, f32 g, f32 b, f32 a) {
    auto clamp = [](f32 v) -> u8 {
        return static_cast<u8>(std::min(std::max(v, 0.0f), 1.0f) * 255.0f + 0.5f);
    };
    return static_cast<u32>(clamp(r)) | (static_cast<u32>(clamp(g)) << 8)
         | (static_cast<u32>(clamp(b)) << 16) | (static_cast<u32>(clamp(a)) << 24);
}

}  // namespace esengine
