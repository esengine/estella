// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    TrailSystem.hpp
 * @brief   Per-App motion-trail simulation: records each TrailRenderer entity's world
 *          position over time into a point history that TrailPlugin renders as a ribbon.
 * @details Runtime state lives HERE (keyed by entity), not on the component — same
 *          split as ParticleSystem, so the component stays pure config and scene
 *          serialization never sees the transient history. The render plugin reads
 *          this history; it never writes it (RC5).
 */
#pragma once

#include "../core/Types.hpp"
#include "../math/Math.hpp"
#include "../ecs/Registry.hpp"
#include "../ecs/components/Transform.hpp"
#include "../ecs/components/TrailRenderer.hpp"

#include <deque>
#include <unordered_map>

namespace esengine::trail {

/** @brief One recorded trail sample: a world position stamped with the sim clock. */
struct TrailPoint {
    glm::vec2 position{0.0f, 0.0f};
    f32 birth_time = 0.0f;  ///< Value of TrailSystem::now() when recorded.
};

/** @brief Per-entity point history. Front = oldest (tail), back = newest (near head). */
struct TrailState {
    std::deque<TrailPoint> points;
};

class TrailSystem {
public:
    TrailSystem() = default;

    /** Advance the sim: record new points for moving emitters, age out old ones. */
    void update(ecs::Registry& registry, f32 dt);

    /** Drop an entity's recorded history (the streak vanishes instantly). */
    void clear(Entity entity);

    /** The monotonic sim clock (seconds), the reference for every point's age. */
    f32 now() const { return time_; }

    const TrailState* getState(Entity entity) const;

private:
    f32 time_ = 0.0f;  ///< Accumulated dt; the single time reference for point ages.
    std::unordered_map<Entity, TrailState> states_;
    // RAII: auto-unregisters from the registry's onDestroy when this system is torn
    // down, so a dead system never leaves a dangling `this` behind.
    Connection destroyConn_;
};

}  // namespace esengine::trail
