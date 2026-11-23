// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    LodViewState.hpp
 * @brief   What a view knows about an object's level: what it chose, why, and
 *          whether something is being held up for inspection instead.
 */
#pragma once

#include "../../core/Types.hpp"

#include <iterator>
#include <unordered_map>

namespace esengine::lod {

/** @brief How long two levels dissolve into each other after a view changes level, in seconds. */
inline constexpr f32 kFadeSeconds = 0.35f;

/** @brief A preview slot holding no level, so the view's own choice is drawn. */
inline constexpr u8 kNoPreview = 0xFEu;

/**
 * @brief Levels remembered per (view, entity) pair.
 *
 * @details Keyed by the view because a level is an answer to "how big does it look
 *          from HERE": a minimap and a main camera looking at one object in one
 *          frame must be able to disagree. Kept on the entity it would be one
 *          answer, and whichever camera drew last would decide for all of them.
 *
 *          The entry carries the whole DECISION, not just its outcome: the size
 *          measured, and what that size asks for with no memory behind it. An
 *          editor explaining a level then reads facts recorded where the choice
 *          was made rather than running the selector a second time.
 */
class LodViewState {
public:
    /** @brief How many frames an untouched pair is kept before it is dropped. */
    static constexpr u64 kKeepFrames = 120;

    /** @brief Opens a frame and, now and then, drops what no view still asks about
     *         — an entity that died leaves a pair nothing will ever touch again. */
    void beginFrame(f64 seconds = 0.0) {
        ++frame_;
        now_ = seconds;
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

    /** @brief The level @p view drew @p entity at within the last @p frames frames, or false when it has not drawn it
     *         that lately (it is off that view's screen, or new). What a view culled reads as @ref kCulled. */
    bool recent(u32 view, Entity entity, u64 frames, u8& outLevel) const {
        const auto it = entries_.find(key(view, entity));
        if (it == entries_.end() || frame_ - it->second.stamp > frames) return false;
        outLevel = it->second.level;
        return true;
    }

    /**
     * @brief Record a decision: what was chosen, what the bare thresholds asked
     *        for, how many stand-ins were reachable, and the size all of it read.
     *
     * @details `chosen` and `unbiased` differing IS hysteresis holding a level,
     *          which is the one explanation a creator cannot reconstruct from the
     *          component: the numbers on screen would say the other level.
     */
    void remember(u32 view, Entity entity, u8 chosen, u8 unbiased, u8 levels, f32 size) {
        const auto found = entries_.find(key(view, entity));
        // A change of level this view saw happen starts a fade from the old one; a first sighting, or one after the view has not
        // looked for a while, starts at its level.
        const bool seen = found != entries_.end() && frame_ - found->second.stamp <= 2;
        auto& entry = entries_[key(view, entity)];
        if (!seen) { entry.from = chosen; entry.fadeStart = now_; }
        else if (chosen != entry.level) { entry.from = entry.level; entry.fadeStart = now_; }
        entry.level = chosen;
        entry.unbiased = unbiased;
        entry.levels = levels;
        entry.size = size;
        entry.stamp = frame_;
    }

    /** @brief The whole recorded decision, or false when this view has not
     *         measured this entity — which is not the same as measuring it at 0. */
    bool inspect(u32 view, Entity entity, u8& outLevel, u8& outUnbiased, u8& outLevels,
                 f32& outSize) const {
        const auto it = entries_.find(key(view, entity));
        if (it == entries_.end()) return false;
        outLevel = it->second.level;
        outUnbiased = it->second.unbiased;
        outLevels = it->second.levels;
        outSize = it->second.size;
        return true;
    }

    /**
     * @brief Hold @p level up for inspection in this view, or @ref kNoPreview to
     *        stop.
     *
     * @details Deliberately NOT on the component. Written to the entity it would
     *          reach a shipped game, a second camera and the shadow pass, none of
     *          which anybody asked to change.
     */
    void preview(u32 view, Entity entity, u8 level) {
        if (level == kNoPreview) previews_.erase(key(view, entity));
        else previews_[key(view, entity)] = level;
    }

    /** @brief The level this view was told to show, or @ref kNoPreview. */
    u8 previewOf(u32 view, Entity entity) const {
        const auto it = previews_.find(key(view, entity));
        return it == previews_.end() ? kNoPreview : it->second;
    }

    /**
     * @brief What to DRAW: the preview if one names a level this group reaches,
     *        otherwise @p chosen.
     *
     * @details A preview past the last stand-in is ignored rather than clamped: a
     *          clamp would answer LOD1 to a request for LOD3 and look like the
     *          selector had spoken, and the level asked for does not exist.
     */
    u8 drawn(u32 view, Entity entity, u8 chosen, u8 levels) const {
        const u8 held = previewOf(view, entity);
        return held != kNoPreview && held <= levels ? held : chosen;
    }

    /**
     * @brief How much of @p level this view draws of @p entity now: 1 for the level it is at, and during the @p seconds after a change
     *        both the level it came from (falling to 0) and the one it went to (rising to 1), so the two dissolve into each other
     *        rather than one replacing the other in a frame. A preview, a cull and a view that has not measured the entity do not fade.
     */
    f32 weight(u32 view, Entity entity, u8 level, f32 seconds) const {
        const auto it = entries_.find(key(view, entity));
        if (it == entries_.end()) return level == 0 ? 1.0f : 0.0f;
        const Entry& e = it->second;
        const u8 held = previewOf(view, entity);
        if (held != kNoPreview && held <= e.levels) return level == held ? 1.0f : 0.0f;
        const f32 t = seconds > 0.0f ? static_cast<f32>((now_ - e.fadeStart) / seconds) : 1.0f;
        if (e.from == e.level || e.level == kCulled || e.from == kCulled || !(t < 1.0f)) return level == e.level ? 1.0f : 0.0f;
        const f32 rise = t < 0.0f ? 0.0f : t;
        if (level == e.level) return rise;
        if (level == e.from) return 1.0f - rise;
        return 0.0f;
    }

    /** @brief The fade a view is in for an entity: the level it is leaving and how far the new one has come (0..1), or false when
     *         none is running (it is settled, culled, held by a preview, or never measured). */
    bool fading(u32 view, Entity entity, f32 seconds, u8& outFrom, f32& outProgress) const {
        const auto it = entries_.find(key(view, entity));
        if (it == entries_.end() || previewOf(view, entity) != kNoPreview) return false;
        const Entry& e = it->second;
        const f32 rising = weight(view, entity, e.level, seconds);
        if (e.from == e.level || !(rising < 1.0f)) return false;
        outFrom = e.from;
        outProgress = rising;
        return true;
    }

    void clear() { entries_.clear(); previews_.clear(); }

    usize size() const { return entries_.size(); }

    /** @brief How many (view, entity) pairs are currently held up for inspection. */
    usize previewCount() const { return previews_.size(); }

private:
    struct Entry {
        u64 stamp = 0;
        f32 size = 0.0f;
        u8 level = 0;
        u8 unbiased = 0;
        u8 levels = 0;
        /** The level a fade is from, equal to `level` when none is running, and when it began. */
        u8 from = 0;
        f64 fadeStart = 0.0;
    };

    static u64 key(u32 view, Entity entity) {
        return (static_cast<u64>(view) << 32) | static_cast<u64>(entity.raw);
    }

    std::unordered_map<u64, Entry> entries_;
    std::unordered_map<u64, u8> previews_;
    u64 frame_ = 0;
    f64 now_ = 0.0;
};

}  // namespace esengine::lod
