// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "TilemapSystem.hpp"
#include "../ecs/RegistrySystems.hpp"

namespace esengine::tilemap {

/** Registry-owned layer stores for worlds sharing one engine and render device. */
class TilemapWorlds {
public:
    Shared<TilemapSystem> select(ecs::Registry& registry) {
        auto system = worlds_.forRegistry(registry, [this] {
            return pending_ ? std::move(pending_) : makeShared<Store>();
        });
        last_ = system;
        return system;
    }

    Shared<TilemapSystem> forRender(ecs::Registry& registry) {
        if (auto system = worlds_.find(registry)) return system;
        return pending_ ? select(registry) : nullptr;
    }

    // Older hosts can paint before creating the first registry or starting the renderer.
    Shared<TilemapSystem> legacy() {
        if (auto system = last_.lock()) return system;
        if (!pending_) pending_ = makeShared<Store>();
        return pending_;
    }

private:
    struct Store : TilemapSystem, ecs::RegistrySystem {
        void onEntityDestroyed(Entity entity) override { destroyLayer(entity); }
        void onRegistryCleared() override { clearLayers(); }
    };

    ecs::RegistrySystems<Store> worlds_;
    Weak<TilemapSystem> last_;
    Shared<Store> pending_;
};

}  // namespace esengine::tilemap
