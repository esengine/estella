#pragma once

#ifdef ES_PLATFORM_WEB

#include <emscripten/html5.h>
#include <glm/glm.hpp>
#include "../core/Types.hpp"
#include "MaterialCache.hpp"

namespace esengine {

struct EngineState {
    EMSCRIPTEN_WEBGL_CONTEXT_HANDLE webgl_context = 0;
    bool initialized = false;
    bool immediate_draw_active = false;
    bool gl_error_check_enabled = true;
    u32 viewport_width = 1280;
    u32 viewport_height = 720;
    glm::vec4 clear_color{0.0f, 0.0f, 0.0f, 1.0f};
    glm::mat4 current_view_projection{1.0f};
    f32 delta_time = 0.016f;
    bool transforms_updated = false;
    MaterialCache material_cache;
};

}  // namespace esengine

#endif  // ES_PLATFORM_WEB
