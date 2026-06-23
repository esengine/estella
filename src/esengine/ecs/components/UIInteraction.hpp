// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../../core/Types.hpp"
#include "../../core/Reflection.hpp"

namespace esengine::ecs {

ES_COMPONENT()
struct UIInteraction {
    ES_PROPERTY()
    bool hovered{false};
    ES_PROPERTY()
    bool pressed{false};
    ES_PROPERTY()
    bool justPressed{false};
    ES_PROPERTY()
    bool justReleased{false};
};

}  // namespace esengine::ecs
