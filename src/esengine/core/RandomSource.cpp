// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "RandomSource.hpp"

namespace esengine {
namespace {
bool g_hasPendingSeed = false;
u32 g_pendingSeed = 0;
}  // namespace

void setPendingRandomSeed(u32 seed) {
    g_hasPendingSeed = true;
    g_pendingSeed = seed;
}

bool takePendingRandomSeed(u32& out) {
    if (!g_hasPendingSeed) return false;
    out = g_pendingSeed;
    return true;
}

}  // namespace esengine
