// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    DragonBonesAnimation.hpp
 * @brief   A DragonBones armature on an entity.
 *
 * @details Declared here rather than in TypeScript for the same reason
 *          SpineAnimation is: this table is the authority the editor's inspector,
 *          the Create menu and the serializer all read through EHT, so a component
 *          that skipped it would need each of them told about it separately.
 *
 *          It reads almost exactly like SpineAnimation, and the one field that
 *          differs is the point. A Spine file IS a skeleton; a DragonBones file is
 *          a project holding several armatures, so `armature` names which one —
 *          there is nothing to derive it from, and an entity that does not say
 *          gets the first in the file.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"
#include "../../math/Math.hpp"

#include <string>

namespace esengine::ecs {

ES_COMPONENT()
struct DragonBonesAnimation {
    /** @brief Skeleton data (`*_ske.json` or `.dbbin`) */
    ES_PROPERTY(asset = dragonbones_skeleton)
    std::string skeletonPath;

    /** @brief Texture atlas data (`*_tex.json`) */
    ES_PROPERTY(asset = dragonbones_atlas)
    std::string atlasPath;

    /** @brief Which armature in the file; empty takes the first */
    ES_PROPERTY(enum_source=dragonbonesArmatures)
    std::string armature;

    /** @brief Current animation name */
    ES_PROPERTY(enum_source=dragonbonesAnimations)
    std::string animation;

    /** @brief Animation playback speed multiplier */
    ES_PROPERTY(min=0)
    f32 timeScale{1.0f};

    /** @brief Whether to loop the animation */
    ES_PROPERTY()
    bool loop{true};

    /** @brief Whether animation is currently playing */
    ES_PROPERTY()
    bool playing{true};

    /** @brief Seconds to crossfade over when the animation changes */
    ES_PROPERTY(min=0, step=0.05)
    f32 fadeInTime{0.0f};

    /** @brief Flip armature horizontally */
    ES_PROPERTY()
    bool flipX{false};

    /** @brief Flip armature vertically */
    ES_PROPERTY()
    bool flipY{false};

    /** @brief Color tint (RGBA, 0-1 range) */
    ES_PROPERTY()
    glm::vec4 color{1.0f, 1.0f, 1.0f, 1.0f};

    /** @brief Sorting layer (higher = rendered on top) */
    ES_PROPERTY(step=1, enum_source=sortingLayers)
    i32 layer{0};

    /** @brief Armature scale factor */
    ES_PROPERTY(min=0)
    f32 skeletonScale{1.0f};

    /** @brief Custom material ID (0 = use default batch shader) */
    ES_PROPERTY(asset = material)
    u32 material{0};

    ES_PROPERTY()
    bool enabled{true};

    /** @brief Set while the paths have changed and the armature is not built yet */
    bool needsReload{true};

    DragonBonesAnimation() = default;
};

}  // namespace esengine::ecs
