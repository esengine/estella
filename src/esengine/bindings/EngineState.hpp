// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include <glm/glm.hpp>
#include "../core/Types.hpp"

namespace esengine {

struct EngineState {
    int webgl_context = 0;
    bool initialized = false;
    bool immediate_draw_active = false;
    // Off by default: glGetError is a SYNCHRONOUS round-trip to the GPU process,
    // and the per-frame drain (renderer_flush/renderer_end) pays it on every
    // frame of every shipped game. Under a slow or contended GPU process those
    // round-trips starve the renderer's event loop — measured as the editor's
    // automation surface timing out while `getError` topped the profile. Opt in
    // via GLDebug.enable(); gl_checkErrors() probes force a check regardless.
    bool gl_error_check_enabled = false;
    u32 viewport_width = 1280;
    u32 viewport_height = 720;
    glm::vec4 clear_color{0.0f, 0.0f, 0.0f, 1.0f};
    glm::mat4 current_view_projection{1.0f};
    bool transforms_updated = false;
};

}  // namespace esengine
