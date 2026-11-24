// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "SpringBoneSystem.hpp"
#include "../ecs/RegistrySystems.hpp"

namespace esengine::springbone {

class SpringBoneWorlds : public ecs::RegistrySystems<SpringBoneSystem> {
public:
    u32 snapshot(const ecs::Registry& registry, Entity root) {
        auto system = find(registry);
        lastSnapshot_ = system;
        return system ? system->captureSnapshot(root) : 0;
    }

    // The original count/data entry points address the last snapshot on this engine.
    Shared<const SpringBoneSystem> lastSnapshot() const { return lastSnapshot_.lock(); }

private:
    Weak<SpringBoneSystem> lastSnapshot_;
};

}  // namespace esengine::springbone
