// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    LODGroup.hpp
 * @brief   The cheaper geometry that may stand in for a MeshRenderer once it is small.
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

namespace esengine::ecs {

/**
 * @brief Stand-in geometry chosen by how much of the screen the object covers.
 *
 * @details The MeshRenderer beside it stays level 0; this says what may be drawn
 *          instead as it shrinks. Thresholds are fractions of the viewport HEIGHT,
 *          which hold across resolutions, fields of view and both projections where
 *          a distance holds across none. Selection belongs to the VIEW, not the entity.
 */
ES_COMPONENT(stability=beta)
struct LODGroup {
    /** @brief Geometry drawn once the object is smaller than @ref lod1Size. */
    ES_PROPERTY(asset = mesh, tooltip="Geometry drawn below the LOD 1 screen size.")
    resource::MeshHandle lod1;

    /** @brief Geometry drawn once the object is smaller than @ref lod2Size. */
    ES_PROPERTY(asset = mesh, tooltip="Geometry drawn below the LOD 2 screen size.")
    resource::MeshHandle lod2;

    /** @brief Geometry drawn once the object is smaller than @ref lod3Size. */
    ES_PROPERTY(asset = mesh, tooltip="Geometry drawn below the LOD 3 screen size.")
    resource::MeshHandle lod3;

    /** @brief Fraction of the viewport height below which @ref lod1 replaces the
     *         MeshRenderer's own mesh. The sizes must descend. */
    ES_PROPERTY(min=0, max=1, tooltip="Screen height fraction below which LOD 1 takes over.")
    f32 lod1Size{0.5f};

    ES_PROPERTY(min=0, max=1, tooltip="Screen height fraction below which LOD 2 takes over.")
    f32 lod2Size{0.25f};

    ES_PROPERTY(min=0, max=1, tooltip="Screen height fraction below which LOD 3 takes over.")
    f32 lod3Size{0.1f};

    /** @brief Fraction of the viewport height below which nothing is drawn at all.
     *         0 disables it, so a group without one is never invisible. */
    ES_PROPERTY(min=0, max=1, tooltip="Screen height fraction below which nothing is drawn (0 = never).")
    f32 cullSize{0.02f};

    /** @brief How much further than a threshold the object must grow before the
     *         finer level comes back — 0.1 turns a 0.20 boundary into 0.20 down,
     *         0.22 up. Zero lets a level flip every frame at the boundary. */
    ES_PROPERTY(min=0, max=1, advanced, tooltip="Extra fraction to grow past a threshold before the finer level returns.")
    f32 hysteresis{0.1f};

    ES_PROPERTY(tooltip="Off: the MeshRenderer's own mesh is always drawn.")
    bool enabled{true};

    LODGroup() = default;
};

}  // namespace esengine::ecs
