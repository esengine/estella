// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AotCommands.hpp
 * @brief   What a host does with the records a compiled system wrote.
 *
 * @details A compiled system calls the engine zero times, so it cannot despawn
 *          an entity — it appends a record and the host acts on it after the
 *          call, which is also the only moment it safely can: a despawn
 *          invalidates the rows the call was reading.
 *
 *          Separate from `AotHost.hpp` because acting means knowing the
 *          Registry, and that header stays free of the engine so a harness can
 *          use it without linking one.
 *
 *          Counts what it could not apply rather than ignoring it. The record
 *          set grows, and a host that quietly dropped a kind it had not learned
 *          would look exactly like one where the system did nothing.
 */
#pragma once

#include <cstdint>
#include <span>

#include "esengine/aot/estella_abi.h"
#include "esengine/ecs/Entity.hpp"
#include "esengine/ecs/Registry.hpp"

namespace esengine::aot {

/**
 * Apply a call's records to this registry; returns how many it did not know.
 *
 * Despawn is the whole v1 set, and the interpreted side applies exactly that —
 * so a nonzero result is this host being older than the module it loaded, not
 * a malformed record.
 */
inline std::uint32_t applyCommands(ecs::Registry& registry, std::span<const EsCmd> cmds) {
    std::uint32_t unknown = 0;
    for (const EsCmd& cmd : cmds) {
        switch (cmd.kind) {
        case ES_CMD_DESPAWN:
            // `a` is the raw entity, as every address-free record carries it.
            registry.destroy(Entity::fromRaw(cmd.a));
            break;
        default:
            ++unknown;
            break;
        }
    }
    return unknown;
}

}  // namespace esengine::aot
