// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"

namespace esengine::ecs {

ES_ENUM()
enum class ScrollMovement : u8 {
    /** Stop dead at the ends. */
    Clamped,
    /** Overshoot and spring back — the touch-UI feel. */
    Elastic
};

/**
 * A scrollable viewport, authored in the scene.
 *
 * The behaviour lives in the SDK's UI behaviour plugin, which attaches a
 * ScrollContainer to any entity carrying this component: wheel and drag move
 * `content` inside this node's box, which clips it (pair with a UIMask — the
 * ScrollView template does).
 *
 * It exists because scrolling used to be reachable only by CONSTRUCTING the
 * ScrollView widget from game code. A scene could describe the parts of a
 * scroll area — the clipped box, the oversized child — but not the fact that it
 * scrolls, so a ScrollView dropped from the editor's Create menu sat there.
 */
ES_COMPONENT()
struct UIScroll {
    ES_PROPERTY()
    bool enabled{true};

    /** The child that moves. Unset ⇒ this node's first child. */
    ES_PROPERTY(entity_ref, tooltip="The child that scrolls inside this node. Leave empty to use the first child.")
    u32 content{0};

    ES_PROPERTY()
    bool horizontal{false};
    ES_PROPERTY()
    bool vertical{true};

    ES_PROPERTY(tooltip="Clamped stops at the ends; Elastic overshoots and springs back.")
    ScrollMovement movement{ScrollMovement::Clamped};

    /** Wheel notches → pixels, and whether a drag inside the box scrolls it. */
    ES_PROPERTY(min=0)
    f32 wheelSpeed{1.0f};
    ES_PROPERTY()
    bool dragScroll{true};

    /**
     * How fast a flick decays, as the fraction of velocity kept per second.
     * 0 ends the flick on release; the default is the usual touch-UI glide.
     */
    ES_PROPERTY(min=0, max=1, tooltip="Fraction of flick velocity kept per second. 0 stops on release.")
    f32 decelerationRate{0.135f};
};

}  // namespace esengine::ecs
