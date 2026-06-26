// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

#include "EngineContext.hpp"

namespace esengine {

EngineContext& EngineContext::instance() {
    static EngineContext ctx;
    return ctx;
}

}  // namespace esengine

