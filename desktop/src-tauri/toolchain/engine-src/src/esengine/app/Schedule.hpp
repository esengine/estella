/**
 * @file    Schedule.hpp
 * @brief   System execution schedule phases
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

#include "../core/Types.hpp"

namespace esengine {

/**
 * @brief Execution phases for systems
 */
enum class Schedule : u8 {
    Startup,      ///< Run once at application start
    PreUpdate,    ///< Before main update (input processing)
    Update,       ///< Main game logic
    PostUpdate,   ///< After update (physics, collision response)
    PreRender,    ///< Before rendering (culling, sorting)
    Render,       ///< Rendering
    PostRender,   ///< After rendering (debug overlays)

    Count
};

constexpr usize SCHEDULE_COUNT = static_cast<usize>(Schedule::Count);

}  // namespace esengine
