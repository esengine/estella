#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"

#include <string>

namespace esengine::ecs {

/**
 * @brief Generic named-state field for an entity.
 *
 * @details Holds the current state as a free-form string. State names are
 *          user-defined (e.g. "normal", "hover", "pressed", "loading").
 *          A StateMachine system compares `current` against `previous`
 *          each frame and raises a transition event when they differ.
 */
ES_COMPONENT()
struct StateMachine {
    /** @brief Active state name. Written by drivers (Interactable, user code). */
    ES_PROPERTY()
    std::string current;

    /** @brief State as of the last processed frame; consumed by transition diffing. */
    ES_PROPERTY()
    std::string previous;
};

}  // namespace esengine::ecs
