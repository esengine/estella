// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    LodViewState.hpp
 * @brief   The level each view last drew an object at — what hysteresis remembers.
 */
#pragma once

#include "../../core/Types.hpp"

#include <iterator>
#include <unordered_map>

namespace esengine::lod {

/**
 * @brief Levels remembered per (view, entity) pair.
 *
 * @details Keyed by the view because a level is an answer to "how big does it look
 *          from HERE": a minimap and a main camera looking at one object in one
 *          frame must be able to disagree. Kept on the entity it would be one
 *          answer, and whichever camera drew last would decide for all of them.
 */
class LodViewState {
public:
    /** @brief How many frames an untouched pair is kept before it is dropped. */
    static constexpr u64 kKeepFrames = 120;

    /** @brief Opens a frame and, now and then, drops what no view still asks about
     *         — an entity that died leaves a pair nothing will ever touch again. */
    void beginFrame() {
        ++frame_;
        if (frame_ % kKeepFrames != 0) return;
        for (auto it = entries_.begin(); it != entries_.end();) {
            it = (frame_ - it->second.stamp > kKeepFrames) ? entries_.erase(it) : std::next(it);
        }
    }

    /** @brief The level @p view last drew @p entity at; level 0 for a pair it has
     *         never seen, which is the unbiased answer a first sighting wants. */
    u8 lastLevel(u32 view, Entity entity) const {
        const auto it = entries_.find(key(view, entity));
        return it == entries_.end() ? 0 : it->second.level;
    }

    void remember(u32 view, Entity entity, u8 level) {
        auto& entry = entries_[key(view, entity)];
        entry.level = level;
        entry.stamp = frame_;
    }

    void clear() { entries_.clear(); }

    usize size() const { return entries_.size(); }

private:
    struct Entry {
        u64 stamp = 0;
        u8 level = 0;
    };

    static u64 key(u32 view, Entity entity) {
        return (static_cast<u64>(view) << 32) | static_cast<u64>(entity.raw);
    }

    std::unordered_map<u64, Entry> entries_;
    u64 frame_ = 0;
};

}  // namespace esengine::lod
