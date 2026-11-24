// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "TilemapSystem.hpp"
#include "../ecs/RegistryStoreSelection.hpp"

namespace esengine::tilemap {

/** Registry-owned layer stores for worlds sharing one engine and render device. */
class TilemapWorlds {
public:
    Shared<TilemapSystem> select(ecs::Registry& registry) {
        return worlds_.select(registry);
    }

    Shared<TilemapSystem> forRender(ecs::Registry& registry) {
        return worlds_.forRender(registry);
    }

    // Older hosts can paint before creating the first registry or starting the renderer.
    Shared<TilemapSystem> legacy() {
        return worlds_.legacy();
    }

private:
    struct Store : TilemapSystem, ecs::RegistrySystem {
        void onEntityDestroyed(Entity entity) override { destroyLayer(entity); }
        void onRegistryCleared() override { clearLayers(); }
    };

    ecs::RegistryStoreSelection<Store> worlds_;
};

}  // namespace esengine::tilemap
