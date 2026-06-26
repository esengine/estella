// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../core/Types.hpp"

namespace esengine {

enum class RenderStage : u8 {
    Background = 0,
    Opaque = 1,
    Transparent = 2,
    Overlay = 3,
};

}  // namespace esengine
