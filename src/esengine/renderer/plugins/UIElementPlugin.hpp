// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "BatchPlugin.hpp"
#include "../../resource/TextureMetadata.hpp"
#include "../../core/Reflection.hpp"

namespace esengine {

class UIElementPlugin : public BatchPlugin {
public:
    void collect(RenderCollectContext& ctx) override;

    // UI draws above world content: its sort layer is offset past the world
    // layer range. The SDK's own text renderer puts quads at the same base, so
    // it crosses — and a second spelling of it is two layers, not one.
    ES_CONST()
    static constexpr i32 UI_BASE_LAYER = 1000;
};

}  // namespace esengine
