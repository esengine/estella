// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

/**
 * @file    RandomSource.hpp
 * @brief   The engine's randomness, and the only place its seed lives.
 *
 * Seeded from the clock, so a game nobody configured varies from run to run —
 * which is what a player wants of particles. Reseeded on demand, so one run can
 * be reproduced: a replay, a bug report, a pixel assertion about a frame.
 *
 * A consumer takes a NAMED stream rather than sharing one generator. Sharing
 * makes every subsystem's sequence depend on how many numbers its neighbours
 * drew, so adding an emitter would change what the AI rolled and a seed would
 * stop meaning anything. The name is folded into the root instead, so streams
 * are independent of each other and stable as the engine grows.
 */

#include <chrono>
#include <random>
#include <string_view>

#include "Types.hpp"

namespace esengine {

class RandomSource {
public:
    RandomSource()
        : root_(static_cast<u32>(std::chrono::steady_clock::now().time_since_epoch().count())) {}

    explicit RandomSource(u32 root) : root_(root) {}

    /** Make every stream taken from here on reproduce from `root`. */
    void reseed(u32 root) { root_ = root; }

    u32 root() const { return root_; }

    /** An independent generator for `name`, the same one every time for a root. */
    std::mt19937 stream(std::string_view name) const {
        // FNV-1a over the name, mixed with the root: cheap, stable across builds,
        // and it does not care what order the streams are asked for.
        u32 h = 2166136261u;
        for (const char c : name) {
            h ^= static_cast<u8>(c);
            h *= 16777619u;
        }
        return std::mt19937(h ^ root_);
    }

private:
    u32 root_;
};

/**
 * A seed set before the engine had a RandomSource to put it in. The SDK sets it
 * beside the colour space — pre-init on purpose, so shaders and spawns both see
 * the run's configuration — and {@link EstellaContext} adopts it on creation.
 */
void setPendingRandomSeed(u32 seed);
/** The pending seed, or nothing when the run was never given one. */
bool takePendingRandomSeed(u32& out);

}  // namespace esengine
