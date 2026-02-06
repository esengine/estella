/**
 * @file    SpineAnimation.hpp
 * @brief   Spine skeletal animation component
 * @details Provides SpineAnimation component for 2D skeletal animation
 *          using the Spine runtime.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"
#include "../../math/Math.hpp"
#include "../../resource/Handle.hpp"

#include <string>

namespace esengine::ecs {

// =============================================================================
// SpineAnimation Component
// =============================================================================

/**
 * @brief Spine skeletal animation component
 *
 * @details Contains all data needed to render a Spine skeleton including
 *          skeleton/atlas paths, animation state, and rendering options.
 *
 * @code
 * Entity e = registry.create();
 * auto& spine = registry.emplace<SpineAnimation>(e);
 * spine.skeletonPath = "assets/spine/character.skel";
 * spine.atlasPath = "assets/spine/character.atlas";
 * spine.animation = "idle";
 * spine.loop = true;
 * @endcode
 */
ES_COMPONENT()
struct SpineAnimation {
    /** @brief Path to skeleton data file (.skel or .json) */
    ES_PROPERTY()
    std::string skeletonPath;

    /** @brief Path to atlas file (.atlas) */
    ES_PROPERTY()
    std::string atlasPath;

    /** @brief Current skin name (empty for default) */
    ES_PROPERTY()
    std::string skin;

    /** @brief Current animation name */
    ES_PROPERTY()
    std::string animation;

    /** @brief Animation playback speed multiplier */
    ES_PROPERTY()
    f32 timeScale{1.0f};

    /** @brief Whether to loop the animation */
    ES_PROPERTY()
    bool loop{true};

    /** @brief Whether animation is currently playing */
    ES_PROPERTY()
    bool playing{true};

    /** @brief Flip skeleton horizontally */
    ES_PROPERTY()
    bool flipX{false};

    /** @brief Flip skeleton vertically */
    ES_PROPERTY()
    bool flipY{false};

    /** @brief Color tint (RGBA, 0-1 range) */
    ES_PROPERTY()
    glm::vec4 color{1.0f, 1.0f, 1.0f, 1.0f};

    /** @brief Sorting layer (higher = rendered on top) */
    ES_PROPERTY()
    i32 layer{0};

    /** @brief Skeleton scale factor */
    ES_PROPERTY()
    f32 skeletonScale{1.0f};

    /** @brief Handle to cached skeleton data (runtime, not serialized) */
    resource::SpineDataHandle skeletonData;

    /** @brief Flag indicating skeleton needs to be reloaded */
    bool needsReload{true};

    /** @brief Default constructor */
    SpineAnimation() = default;

    /**
     * @brief Constructs SpineAnimation with paths
     * @param skelPath Path to skeleton file
     * @param atlPath Path to atlas file
     */
    SpineAnimation(const std::string& skelPath, const std::string& atlPath)
        : skeletonPath(skelPath), atlasPath(atlPath) {}
};

}  // namespace esengine::ecs
