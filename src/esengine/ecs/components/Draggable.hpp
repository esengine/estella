// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Draggable.hpp
 * @brief   Pointer-drag configuration.
 * @details Authored per entity; the drag system reads it and writes DragState.
 *          Works on a UI node and on a plain world-space sprite alike — the hit
 *          test answers for both.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"
#include "../../math/Math.hpp"

namespace esengine::ecs {

// Not marked public yet: it has just become an engine component and its
// bounds fields changed shape in doing so. It earns that once it has held.
ES_COMPONENT()
struct Draggable {
    ES_PROPERTY(tooltip="Whether this entity can be dragged at all.")
    bool enabled{true};

    // Screen pixels the pointer must travel before a press becomes a drag. Below
    // it the press is still a click, which is what makes a draggable button work.
    ES_PROPERTY(min=0, unit=px, tooltip="Pointer travel before a press becomes a drag.")
    f32 dragThreshold{5.0f};

    ES_PROPERTY(category=Axis, tooltip="Pin the X axis; the drag only moves in Y.")
    bool lockX{false};

    ES_PROPERTY(category=Axis, tooltip="Pin the Y axis; the drag only moves in X.")
    bool lockY{false};

    // A bound and a flag rather than an optional value: zero is a perfectly good
    // limit, so it cannot double as "no limit".
    ES_PROPERTY(category=Bounds, tooltip="Apply the lower bound below.")
    bool constrainMin{false};

    ES_PROPERTY(category=Bounds, tooltip="Lowest world position the drag may reach.")
    glm::vec2 constraintMin{0.0f, 0.0f};

    ES_PROPERTY(category=Bounds, tooltip="Apply the upper bound below.")
    bool constrainMax{false};

    ES_PROPERTY(category=Bounds, tooltip="Highest world position the drag may reach.")
    glm::vec2 constraintMax{0.0f, 0.0f};
};

} // namespace esengine::ecs
