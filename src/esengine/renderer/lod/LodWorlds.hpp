// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "LodViewState.hpp"
#include "../../ecs/RegistrySystems.hpp"

#include <vector>

namespace esengine::lod {

/** Decisions and previews belong to the registry whose meshes the camera collected. */
class LodWorlds {
public:
    void beginFrame(f64 seconds) {
        seconds_ = seconds;
        worlds_.forEach([seconds](Store& store) { store.beginFrame(seconds); });
    }

    LodViewState& collect(ecs::Registry& registry) {
        auto store = forRegistry(registry);
        last_ = store;
        return *store;
    }

    Shared<const LodViewState> find(const ecs::Registry* registry = nullptr) const {
        return registry ? worlds_.find(*registry) : last_.lock();
    }

    void preview(ecs::Registry* registry, u32 view, Entity entity, u8 level) {
        if (registry && !registry->valid(entity)) return;
        if (auto store = registry ? forRegistry(*registry) : last_.lock()) {
            store->preview(view, entity, level);
            return;
        }

        // An older host can request a preview before submitting its first registry.
        std::erase_if(pending_, [=](const Hold& h) { return h.view == view && h.entity == entity; });
        if (level != kNoPreview) pending_.push_back({view, entity, level});
    }

    usize previewCount() const {
        usize count = pending_.size();
        worlds_.forEach([&count](const Store& store) { count += store.previewCount(); });
        return count;
    }

private:
    struct Store : LodViewState, ecs::RegistrySystem {
        explicit Store(ecs::Registry& registry, f64 seconds)
            : reset(registry.onClear([this] { clear(); })) { beginFrame(seconds); }
        void onEntityDestroyed(Entity entity) override { forget(entity); }
        Connection reset;
    };
    struct Hold { u32 view; Entity entity; u8 level; };

    Shared<Store> forRegistry(ecs::Registry& registry) {
        auto store = worlds_.forRegistry(registry, [&] { return makeShared<Store>(registry, seconds_); });
        if (last_.expired()) {
            for (const auto& h : pending_) {
                if (registry.valid(h.entity)) store->preview(h.view, h.entity, h.level);
            }
            pending_.clear();
            last_ = store;
        }
        return store;
    }

    ecs::RegistrySystems<Store> worlds_;
    Weak<Store> last_;
    std::vector<Hold> pending_;
    f64 seconds_ = 0.0;
};

}  // namespace esengine::lod
