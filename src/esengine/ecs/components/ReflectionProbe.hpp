// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ReflectionProbe.hpp
 * @brief   What a shiny surface standing HERE reflects, when the sky is not it.
 *          LightProbeVolume answers the same question for the diffuse half.
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
#include "../../resource/Handle.hpp"

#include <glm/glm.hpp>

namespace esengine::ecs {

/**
 * @brief A box inside which reflections come from a bake rather than from the sky.
 *
 * @details The atlas is the SCENE's and this says which column is here, which is
 *          what lets a room full of shiny things still merge into one draw.
 *          Axis-aligned about the entity, like LightProbeVolume: the box is what
 *          a reflection is PROJECTED onto, and a turned one costs a pixel more.
 */
ES_COMPONENT(stability=beta)
struct ReflectionProbe {
    /** @brief The scene's baked reflections — an `.esenv` whose atlas holds a
     *         column per probe. The baker writes it; invalid means nothing is
     *         baked yet, and what stands here reflects the sky as before. */
    ES_PROPERTY(asset = environment, tooltip="The scene's baked reflections (the baker writes this).")
    resource::EnvironmentHandle reflection;

    /** @brief Half the box this probe answers inside, in world units. */
    ES_PROPERTY(min=0, tooltip="Half the box this probe answers inside, from the entity's position.")
    glm::vec3 halfExtents{200.0f, 200.0f, 200.0f};

    /** @brief Which column of the atlas holds it. Column 0 is the environment —
     *         what a surface outside every probe reflects — so a probe's own is
     *         1 or more, and 0 reads as "not baked yet". */
    ES_PROPERTY(min=0, advanced, tooltip="Which column of the atlas this probe occupies (the baker writes this).")
    u32 slot{0};

    /** @brief Disabled probes are skipped, and what stands inside reflects the sky. */
    ES_PROPERTY(tooltip="Off: what stands inside this box reflects the sky again.")
    bool enabled{true};

    ReflectionProbe() = default;
};

}  // namespace esengine::ecs
