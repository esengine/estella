// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "TrailSystem.hpp"

namespace esengine::trail {

void TrailSystem::update(ecs::Registry& registry, f32 dt) {
    if (!destroyConn_.isConnected()) {
        destroyConn_ = registry.onDestroy([this](Entity entity) {
            states_.erase(entity);
        });
    }

    time_ += dt;

    auto view = registry.view<ecs::Transform, ecs::TrailRenderer>();
    for (auto entity : view) {
        const auto& trail = view.get<ecs::TrailRenderer>(entity);
        // Frozen (disabled) trails keep their history so re-enabling resumes the
        // streak instead of restarting it.
        if (!trail.enabled) continue;

        auto& transform = view.get<ecs::Transform>(entity);
        transform.ensureDecomposed();
        glm::vec2 pos(transform.worldPosition.x, transform.worldPosition.y);

        auto& state = states_[entity];

        // Record a new anchor when the head has moved far enough (or the trail is
        // empty). The live head between anchors is added by the plugin from the
        // current transform, so a stationary emitter never accretes points.
        if (trail.emitting) {
            bool record = state.points.empty();
            if (!record) {
                glm::vec2 d = pos - state.points.back().position;
                f32 md = trail.minVertexDistance;
                record = glm::dot(d, d) >= md * md;
            }
            if (record) {
                state.points.push_back({pos, time_});
            }
        }

        // Age out points older than `time` from the tail (front = oldest).
        f32 cutoff = time_ - trail.time;
        while (!state.points.empty() && state.points.front().birth_time < cutoff) {
            state.points.pop_front();
        }

        if (state.points.empty()) {
            states_.erase(entity);
        }
    }
}

void TrailSystem::clear(Entity entity) {
    states_.erase(entity);
}

const TrailState* TrailSystem::getState(Entity entity) const {
    auto it = states_.find(entity);
    return it != states_.end() ? &it->second : nullptr;
}

}  // namespace esengine::trail
