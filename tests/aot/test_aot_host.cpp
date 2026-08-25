// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    test_aot_host.cpp
 * @brief   Compiled TypeScript, run against a real Registry.
 *
 * @details Everything before this ran the emitted C over an image a JS test had
 *          laid out, which meant the offsets only ever had to agree with the
 *          compiler's own idea of them. Here they have to agree with the C++
 *          structs, and `Transform` is a real `ecs::Transform` out of a real
 *          `ecs::Registry` — the thing the offsets were always claims ABOUT.
 *
 *          What it asks:
 *            1. the generated offsets ARE the struct's, checked against the
 *               address of the field itself rather than against a second table;
 *            2. the compiled system moves the registry the way the same loop
 *               written in C++ moves it, to the bit;
 *            3. the host and the artifact agree on the handshake constant.
 *
 *          `Mover` and `Time` have no C++ struct — they are a ScriptStorage
 *          record and a host resource — so the host lays them out, and the
 *          structs below are that layout. Those static_asserts are the check
 *          that it has not moved under them.
 */
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>

#include <cstddef>
#include <cstdint>
#include <vector>

#include "esengine/aot/AotHost.hpp"
#include "esengine/ecs/Registry.hpp"
#include "esengine/ecs/components/Transform.hpp"

extern "C" {
#include "generated/estella_offsets.h"
#include "generated/move_system_hash.h"
/** The compiled system. One symbol, and it calls nothing. */
void es_sys_MoveSystem(es_addr_t ctx);
extern const std::uint64_t es_abi_hash;
}

using namespace esengine;

namespace {

/** `defineComponent('Mover', …)` lands in ScriptStorage, so the ABI lays it out:
 *  declaration order, f64 each, because a JS record has no narrower number. */
struct MoverRow {
    double speed;
    double directionX;
    double directionY;
};
static_assert(offsetof(MoverRow, speed) == ES_OFF_Mover_speed, "Mover.speed moved");
static_assert(offsetof(MoverRow, directionX) == ES_OFF_Mover_directionX, "Mover.directionX moved");
static_assert(offsetof(MoverRow, directionY) == ES_OFF_Mover_directionY, "Mover.directionY moved");

/** The resource, likewise host-side. Only `delta` is reached here. */
struct TimeRow {
    double delta;
};
static_assert(offsetof(TimeRow, delta) == ES_OFF_Time_delta, "Time.delta moved");

/** Byte distance from a component's base to one of its fields. Taken from the
 *  live object rather than with offsetof, because glm's vectors are not types
 *  offsetof is defined for. */
template <typename C, typename F>
std::size_t fieldOffset(const C& obj, const F& field) {
    return static_cast<std::size_t>(reinterpret_cast<const unsigned char*>(&field)
                                    - reinterpret_cast<const unsigned char*>(&obj));
}

struct World {
    ecs::Registry registry;
    std::vector<std::uint32_t> entities;
    std::vector<MoverRow> movers;   // index-parallel with `entities`
    TimeRow time{1.0 / 30.0};
};

constexpr int ENTITY_COUNT = 24;

/** The same starting world every time, spread over signs and magnitudes. */
World makeWorld() {
    World w;
    for (int i = 1; i <= ENTITY_COUNT; ++i) {
        Entity e = w.registry.create();
        auto& t = w.registry.emplace<ecs::Transform>(e);
        t.position.x = static_cast<float>((i % 7) * 13 - 40);
        t.position.y = static_cast<float>((i % 5) * 9 - 20);
        w.entities.push_back(e.id());
        w.movers.push_back(MoverRow{
            40.0 + (i % 6) * 15.0,
            static_cast<double>((i % 3) - 1),
            ((i % 4) - 2) / 2.0,
        });
    }
    return w;
}

/** What move.ts says, written out in C++. The oracle: if the compiled system
 *  disagrees with this, one of them is wrong about the struct. */
void moveByHand(World& w) {
    for (std::size_t i = 0; i < w.entities.size(); ++i) {
        auto* t = w.registry.tryGet<ecs::Transform>(Entity::fromRaw(w.entities[i]));
        const MoverRow& m = w.movers[i];
        t->position.x = static_cast<float>(static_cast<double>(t->position.x)
                                           + m.directionX * m.speed * w.time.delta);
        t->position.y = static_cast<float>(static_cast<double>(t->position.y)
                                           + m.directionY * m.speed * w.time.delta);
    }
}

/** One frame through the contract. */
void moveByCompiledCode(World& w, aot::CallArena& arena) {
    aot::QuerySpec q;
    q.comps.push_back([&w](std::uint32_t e) -> void* {
        return w.registry.tryGet<ecs::Transform>(Entity::fromRaw(e));
    });
    q.comps.push_back([&w](std::uint32_t e) -> void* {
        for (std::size_t i = 0; i < w.entities.size(); ++i) {
            if (w.entities[i] == e) return &w.movers[i];
        }
        return nullptr;
    });
    void* resources[] = { &w.time };
    aot::QuerySpec queries[] = { q };
    const auto cmds = aot::run(&es_sys_MoveSystem, w.entities, queries, resources, arena);
    CHECK(cmds.empty());   // MoveSystem writes no commands
}

}  // namespace

TEST_CASE("the generated offsets are the C++ struct's, not a second table") {
    ecs::Transform t;
    CHECK(fieldOffset(t, t.position.x) == ES_OFF_Transform_position_x);
    CHECK(fieldOffset(t, t.position.y) == ES_OFF_Transform_position_y);
    // The point of asking: reading position.y at the wrong offset returns a
    // number rather than an error, and every frame after it is quietly wrong.
    CHECK(ES_OFF_Transform_position_y - ES_OFF_Transform_position_x == sizeof(float));
}

TEST_CASE("the host and the artifact agree on the handshake") {
    CHECK(es_abi_hash == aot::abiHash(ES_EXPECTED_CONTRACT_HASH));
}

TEST_CASE("a compiled system moves a real Registry exactly as C++ does") {
    World byHand = makeWorld();
    World byCode = makeWorld();
    aot::CallArena arena;

    for (int frame = 0; frame < 30; ++frame) {
        moveByHand(byHand);
        moveByCompiledCode(byCode, arena);

        for (std::size_t i = 0; i < byHand.entities.size(); ++i) {
            const auto* want = byHand.registry.tryGet<ecs::Transform>(Entity::fromRaw(byHand.entities[i]));
            const auto* got = byCode.registry.tryGet<ecs::Transform>(Entity::fromRaw(byCode.entities[i]));
            REQUIRE(want != nullptr);
            REQUIRE(got != nullptr);
            // Both sides round through float on every store, so this is exact.
            CHECK(got->position.x == want->position.x);
            CHECK(got->position.y == want->position.y);
        }
    }

    // A world nothing moved would pass the comparison above trivially.
    const World fresh = makeWorld();
    const auto* moved = byCode.registry.tryGet<ecs::Transform>(Entity::fromRaw(byCode.entities[1]));
    const auto* start = fresh.registry.tryGet<ecs::Transform>(Entity::fromRaw(fresh.entities[1]));
    CHECK(moved->position.x != start->position.x);
}

TEST_CASE("a row the query cannot complete is not a row") {
    World w = makeWorld();
    aot::CallArena arena;
    // Take Transform away from one entity: it has a Mover, so only the filter
    // keeps it out of the walk.
    w.registry.remove<ecs::Transform>(Entity::fromRaw(w.entities[3]));

    aot::QuerySpec q;
    q.comps.push_back([&w](std::uint32_t e) -> void* {
        return w.registry.tryGet<ecs::Transform>(Entity::fromRaw(e));
    });
    q.comps.push_back([&w](std::uint32_t e) -> void* {
        for (std::size_t i = 0; i < w.entities.size(); ++i) {
            if (w.entities[i] == e) return &w.movers[i];
        }
        return nullptr;
    });
    void* resources[] = { &w.time };
    aot::QuerySpec queries[] = { q };
    aot::run(&es_sys_MoveSystem, w.entities, queries, resources, arena);

    // The incomplete entity is still gone, and the complete ones still moved:
    // a filter that dropped everything would pass a "did not crash" check.
    CHECK(w.registry.tryGet<ecs::Transform>(Entity::fromRaw(w.entities[3])) == nullptr);
    const World fresh = makeWorld();
    int moved = 0;
    for (std::size_t i = 0; i < w.entities.size(); ++i) {
        const auto* got = w.registry.tryGet<ecs::Transform>(Entity::fromRaw(w.entities[i]));
        const auto* start = fresh.registry.tryGet<ecs::Transform>(Entity::fromRaw(fresh.entities[i]));
        if (got != nullptr && got->position.x != start->position.x) ++moved;
    }
    CHECK(moved > 0);
}
