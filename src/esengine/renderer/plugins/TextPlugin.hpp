// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "BatchPlugin.hpp"

namespace esengine {
namespace text { class BitmapFont; }

class TextPlugin : public BatchPlugin {
public:
    void collect(RenderCollectContext& ctx) override;

private:
    static u32 decodeUtf8(const char* data, u16 length, u16& pos);
};

}  // namespace esengine
