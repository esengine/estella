// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../core/Types.hpp"

#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace esengine::ecs {

/** Draw layers inherited from Canvas order by sprites, emitters and skeletons. */
struct UITreeOrder {
    std::unordered_map<u32, i32> layers;
    i32 base = 0;
    u64 entitySet = 0;
};

/** Tables read together by camera, probe and overlay collects for one entity population. */
struct UIRenderData {
    std::unordered_set<u32> domain;
    std::vector<u32> roots;
    std::vector<u32> rootByIndex;
    UITreeOrder order;
    bool laidOut = false;
};

}  // namespace esengine::ecs
