// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "RegistrySystems.hpp"

namespace esengine::ecs {

/** Registry-owned stores with compatibility for authors that supplied only an entity.
 *  A collect can adopt writes made before the first registry was known. Reading an
 *  existing store leaves the author's selection alone. */
template<class Store>
class RegistryStoreSelection {
public:
    Shared<Store> select(Registry& registry) {
        auto store = worlds_.forRegistry(registry, [this] {
            return pending_ ? std::move(pending_) : makeShared<Store>();
        });
        last_ = store;
        return store;
    }

    Shared<Store> find(const Registry& registry) const { return worlds_.find(registry); }

    Shared<Store> forRender(Registry& registry) {
        if (auto store = find(registry)) return store;
        return pending_ ? select(registry) : nullptr;
    }

    Shared<Store> legacy() {
        if (auto store = last_.lock()) return store;
        if (!pending_) pending_ = makeShared<Store>();
        return pending_;
    }

private:
    RegistrySystems<Store> worlds_;
    Weak<Store> last_;
    Shared<Store> pending_;
};

}  // namespace esengine::ecs
