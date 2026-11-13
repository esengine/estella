// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ReflectionStore.hpp
 * @brief   Which baked reflection a point stands in — the specular half of the
 *          question ProbeStore answers for irradiance.
 *
 * @details The frame's ReflectionProbe components as boxes plus the column each
 *          one owns in the scene's atlas. Filled during collection and read
 *          during it; nothing here outlives the frame that gathered it.
 *
 *          ONE atlas per frame, and the environment is column 0 of it. That is
 *          what keeps a reflection a per-instance number instead of a per-draw
 *          texture bind — a bind is what stopped a hundred objects in a room
 *          from merging into one draw.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../../core/Revision.hpp"
#include "./LightConstants.hpp"

#include <glm/glm.hpp>
#include <vector>

namespace esengine {

/** @brief The frame's reflection probes, and the lookup that picks one. */
class ReflectionStore {
public:
    /** @brief One probe: the world box it answers inside, and its atlas column. */
    struct Probe {
        glm::vec3 min{0.0f};
        glm::vec3 max{0.0f};
        u32 slot = 0;
    };

    void clear() {
        probes_.clear();
        environment_ = 0;
    }

    /**
     * @brief Takes a probe, or refuses one nothing can read.
     *
     * @details A probe past the last addressable column is DROPPED rather than
     *          clamped into another probe's: clamping would light a room with the
     *          reflection of whichever room happened to be baked at that number.
     */
    bool add(const glm::vec3& min, const glm::vec3& max, u32 slot, u32 environment) {
        if (environment == 0 || slot == 0 || slot >= MAX_REFLECTION_PROBES) return false;
        if (max.x <= min.x || max.y <= min.y || max.z <= min.z) return false;
        // One bake for the frame: the first taken decides it, and a probe naming
        // another is from a bake this scene is no longer showing.
        if (environment_ == 0) environment_ = environment;
        else if (environment_ != environment) return false;
        probes_.push_back({min, max, slot});
        return true;
    }

    bool empty() const { return probes_.empty(); }
    u32 count() const { return static_cast<u32>(probes_.size()); }

    /**
     * @brief What the frame's reflection probes say, as a number that changes whenever it does (see core/Revision.hpp): asked after the
     *        collect, it moves only when this frame's set differs from the one it last answered for.
     */
    u64 revision() const {
        u64 h = 0xcbf29ce484222325ull;
        const auto mix = [&h](const void* data, usize bytes) {
            const auto* p = static_cast<const u8*>(data);
            for (usize i = 0; i < bytes; ++i) { h ^= p[i]; h *= 0x100000001b3ull; }
        };
        mix(&environment_, sizeof(environment_));
        for (const Probe& p : probes_) {
            mix(&p.min, sizeof(p.min));
            mix(&p.max, sizeof(p.max));
            mix(&p.slot, sizeof(p.slot));
        }
        if (revision_ == 0 || h != revision_hash_) {
            revision_hash_ = h;
            revision_ = nextRevision();
        }
        return revision_;
    }


    /** @brief The baked environment every probe of this frame reads, or 0. */
    u32 environment() const { return environment_; }

    /**
     * @brief The column a point at @p p reflects, or 0 for the environment.
     *
     * @details Where two probes overlap the SMALLER wins, the rule ProbeStore
     *          takes: a cupboard inside a hall was baked to say what the hall's
     *          probe could not.
     */
    u32 slotAt(const glm::vec3& p) const {
        const Probe* best = nullptr;
        f32 bestSize = 0.0f;
        for (const Probe& v : probes_) {
            if (p.x < v.min.x || p.x > v.max.x || p.y < v.min.y || p.y > v.max.y
                || p.z < v.min.z || p.z > v.max.z) continue;
            const glm::vec3 e = v.max - v.min;
            const f32 size = e.x * e.y * e.z;
            if (!best || size < bestSize) { best = &v; bestSize = size; }
        }
        return best ? best->slot : 0u;
    }

    /**
     * @brief The column a whole object reflects, by its world box rather than its origin (ProbeStore::sampleBox's rule):
     *        its centre's, else the smallest probe the box overlaps. An imported level's walls keep their origin at the
     *        world's centre, outside the room they stand in.
     */
    u32 slotForBox(const glm::vec3& centre, const glm::vec3& half) const {
        if (const u32 at = slotAt(centre); at != 0) return at;
        const Probe* best = nullptr;
        f32 bestSize = 0.0f;
        for (const Probe& v : probes_) {
            const glm::vec3 vc = (v.min + v.max) * 0.5f;
            const glm::vec3 vh = (v.max - v.min) * 0.5f;
            const glm::vec3 gap = glm::abs(centre - vc) - (half + vh);
            if (gap.x > 0.0f || gap.y > 0.0f || gap.z > 0.0f) continue;
            const f32 size = vh.x * vh.y * vh.z;
            if (!best || size < bestSize) { best = &v; bestSize = size; }
        }
        return best ? best->slot : 0u;
    }

    /** @brief The probes themselves, for the frame block that carries their boxes. */
    const std::vector<Probe>& probes() const { return probes_; }

private:
    std::vector<Probe> probes_;
    u32 environment_ = 0;
    mutable u64 revision_ = 0;
    mutable u64 revision_hash_ = 0;
};

}  // namespace esengine
