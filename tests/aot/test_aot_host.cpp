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
#include <cstring>
#include <string>
#include <vector>

#include "esengine/aot/AotHost.hpp"
#include "esengine/aot/AotComponents.generated.hpp"
#include "esengine/aot/AotModule.hpp"
#include "esengine/ecs/Registry.hpp"
#include "esengine/ecs/components/Transform.hpp"

extern "C" {
#include "generated/estella_offsets.h"
#include "generated/move_system_hash.h"
/** The compiled system. One symbol, and it calls nothing. */
void es_sys_MoveSystem(es_addr_t ctx);
extern const std::uint64_t es_abi_hash;
/** The manifest: what the artifact says its systems need filled in. */
extern const EsSystemDecl es_systems[];
extern const std::uint32_t es_system_count;
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

/**
 * The world, with `Mover` held the way ScriptStorage holds it: rows at a stride,
 * and a sparse table of slot+1 by entity index. Not a convenience — a script
 * component's map lives in the scripting language, so the only way the compiled
 * code reaches it without a call per entity is for it to arrive as memory.
 */
struct World {
    ecs::Registry registry;
    std::vector<std::uint32_t> entities;
    std::vector<MoverRow> movers;          // the pool's rows
    std::vector<std::uint32_t> moverSparse;  // entity index -> slot + 1
    TimeRow time{1.0 / 30.0};

    aot::RowSpan moverSpan() {
        return aot::RowSpan{
            moverSparse.data(),
            static_cast<std::uint32_t>(moverSparse.size()),
            reinterpret_cast<unsigned char*>(movers.data()),
            static_cast<std::uint32_t>(sizeof(MoverRow)),
            Entity::Layout::INDEX_MASK,
        };
    }
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
        const std::uint32_t at = e.index();
        if (at >= w.moverSparse.size()) w.moverSparse.resize(at + 1u, 0u);
        w.moverSparse[at] = static_cast<std::uint32_t>(w.movers.size());   // slot + 1
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

/**
 * What this host can name. A real one answers from the generated per-component
 * bindings and from ScriptStorage's pools; here `Mover` stands in for a pool,
 * which is the same thing a slot address later becomes.
 */
aot::ComponentLookup componentsOf(World& w) {
    return [&w](const char* name) -> aot::ComponentAt {
        if (std::strcmp(name, "Transform") == 0) {
            return [&w](std::uint32_t e) -> void* {
                return w.registry.tryGet<ecs::Transform>(Entity::fromRaw(e));
            };
        }
        // Handed over as memory, so nothing here calls back into the language
        // that owns the rows.
        if (std::strcmp(name, "Mover") == 0) return aot::fromRows(w.moverSpan());
        return nullptr;
    };
}

aot::ResourceLookup resourcesOf(World& w) {
    return [&w](const char* name) -> void* {
        return std::strcmp(name, "Time") == 0 ? &w.time : nullptr;
    };
}

/** The declaration the artifact carries for `name`, or null. */
const EsSystemDecl* declOf(const char* name) {
    for (std::uint32_t i = 0; i < es_system_count; ++i) {
        if (std::strcmp(es_systems[i].name, name) == 0) return &es_systems[i];
    }
    return nullptr;
}

/** One frame through the contract, driven entirely by the manifest. */
void moveByCompiledCode(World& w, const aot::BoundSystem& bound, aot::CallArena& arena) {
    const auto cmds = aot::runBound(bound, w.entities, resourcesOf(w), arena);
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

TEST_CASE("the artifact says what it needs, and nobody writes that list twice") {
    const EsSystemDecl* decl = declOf("MoveSystem");
    REQUIRE(decl != nullptr);
    REQUIRE(decl->queryCount == 1u);
    REQUIRE(decl->queries[0].count == 2u);
    // Order is the contract: slot 0 of a row is Transform because the query
    // named it first, and swapping these two swaps every load in the system.
    CHECK(std::strcmp(decl->queries[0].comps[0], "Transform") == 0);
    CHECK(std::strcmp(decl->queries[0].comps[1], "Mover") == 0);
    CHECK(decl->queries[0].mut[0] == 1u);   // Mut(Transform)
    CHECK(decl->queries[0].mut[1] == 0u);
    REQUIRE(decl->resourceCount == 1u);
    CHECK(std::strcmp(decl->resources[0], "Time") == 0);
    CHECK(decl->fn == &es_sys_MoveSystem);
}

TEST_CASE("a system naming something this host cannot is simply not bound") {
    World w = makeWorld();
    const EsSystemDecl* decl = declOf("MoveSystem");
    REQUIRE(decl != nullptr);
    // The interpreter fallback, one layer down: a host missing a component does
    // not get a system that reads null, it gets no system.
    const aot::BoundSystem none = aot::bind(
        *decl, [](const char*) { return aot::ComponentAt{}; }, resourcesOf(w));
    CHECK(none.fn == nullptr);

    aot::CallArena arena;
    CHECK(aot::runBound(none, w.entities, resourcesOf(w), arena).empty());
}

TEST_CASE("a compiled system moves a real Registry exactly as C++ does") {
    World byHand = makeWorld();
    World byCode = makeWorld();
    aot::CallArena arena;

    const EsSystemDecl* decl = declOf("MoveSystem");
    REQUIRE(decl != nullptr);
    const aot::BoundSystem bound = aot::bind(*decl, componentsOf(byCode), resourcesOf(byCode));
    REQUIRE(bound.fn != nullptr);

    for (int frame = 0; frame < 30; ++frame) {
        moveByHand(byHand);
        moveByCompiledCode(byCode, bound, arena);

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

TEST_CASE("a component handed over as memory resolves without a call") {
    World w = makeWorld();
    const aot::ComponentAt at = aot::fromRows(w.moverSpan());

    for (std::size_t i = 0; i < w.entities.size(); ++i) {
        CHECK(at(w.entities[i]) == &w.movers[i]);
    }
    // Absent is zero in the table, and past the end is absent too — a host must
    // not read a row for an entity the pool never saw.
    CHECK(at(Entity::Layout::pack(9999u, 0u)) == nullptr);

    // A recycled id has the same INDEX and a different generation, which is why
    // the table is indexed by index and masked here rather than looked up raw.
    const std::uint32_t recycled = Entity::Layout::pack(Entity::fromRaw(w.entities[2]).index(), 3u);
    CHECK(at(recycled) == &w.movers[2]);
}

TEST_CASE("a row the query cannot complete is not a row") {
    World w = makeWorld();
    aot::CallArena arena;
    // Take Transform away from one entity: its Mover row is still there, so only
    // the filter keeps it out of the walk.
    w.registry.remove<ecs::Transform>(Entity::fromRaw(w.entities[3]));

    const aot::BoundSystem bound = aot::bind(*declOf("MoveSystem"), componentsOf(w), resourcesOf(w));
    aot::runBound(bound, w.entities, resourcesOf(w), arena);

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

TEST_CASE("the generated table answers for an engine component, and only for one") {
    World w = makeWorld();

    // The same question this file answers by hand above, asked of the table a
    // native host will use. Two answers to "where is Transform" is the drift
    // the generator exists to prevent.
    const aot::ComponentAt fromTable = aot::engineComponentAt(w.registry, "Transform");
    REQUIRE(static_cast<bool>(fromTable));
    for (std::uint32_t e : w.entities) {
        CHECK(fromTable(e) == w.registry.tryGet<ecs::Transform>(Entity::fromRaw(e)));
    }

    // Absence is the row filter, so it has to be nullptr and not a fresh
    // component: resolving with getOrEmplace would give every entity walked one.
    w.registry.remove<ecs::Transform>(Entity::fromRaw(w.entities[0]));
    CHECK(fromTable(w.entities[0]) == nullptr);
    CHECK(w.registry.has<ecs::Transform>(Entity::fromRaw(w.entities[0])) == false);

    // A project component lives in the script pool; this table must say so
    // rather than hand back something that reads as an engine miss.
    CHECK(aot::isEngineComponent("Transform"));
    CHECK(aot::isEngineComponent("Mover") == false);
    CHECK(static_cast<bool>(aot::engineComponentAt(w.registry, "Mover")) == false);
}

TEST_CASE("a compiled system runs on the generated resolvers, exactly as on hand-written ones") {
    World byHand = makeWorld();
    World byTable = makeWorld();
    aot::CallArena arena;

    const auto tableLookup = [&byTable](const char* name) -> aot::ComponentAt {
        if (aot::isEngineComponent(name)) return aot::engineComponentAt(byTable.registry, name);
        if (std::strcmp(name, "Mover") == 0) return aot::fromRows(byTable.moverSpan());
        return nullptr;
    };

    aot::runBound(aot::bind(*declOf("MoveSystem"), componentsOf(byHand), resourcesOf(byHand)),
                  byHand.entities, resourcesOf(byHand), arena);
    aot::runBound(aot::bind(*declOf("MoveSystem"), tableLookup, resourcesOf(byTable)),
                  byTable.entities, resourcesOf(byTable), arena);

    for (std::size_t i = 0; i < byHand.entities.size(); ++i) {
        const auto* want = byHand.registry.tryGet<ecs::Transform>(Entity::fromRaw(byHand.entities[i]));
        const auto* got = byTable.registry.tryGet<ecs::Transform>(Entity::fromRaw(byTable.entities[i]));
        REQUIRE((want != nullptr) == (got != nullptr));
        if (want == nullptr) continue;
        CHECK(want->position.x == got->position.x);
        CHECK(want->position.y == got->position.y);
    }
}

#ifdef ES_AOT_MODULE_PATH
TEST_CASE("the same system, loaded out of a module rather than linked in") {
    aot::Module mod;
    std::string why;
    const std::uint64_t expected = aot::expectedAbiHash(ES_EXPECTED_CONTRACT_HASH);
    REQUIRE_MESSAGE(mod.open(ES_AOT_MODULE_PATH, expected, &why), why);

    // The declaration table is IN the artifact, so a loading host needs no
    // manifest beside it: the name, the queries and the resources all came out
    // of the thing that is about to run.
    const EsSystemDecl* decl = mod.find("MoveSystem");
    REQUIRE(decl != nullptr);
    CHECK(decl->queryCount == 1u);
    CHECK(decl->resourceCount == 1u);
    CHECK(std::strcmp(decl->resources[0], "Time") == 0);
    CHECK(decl->fn != nullptr);

    // And it moves the world the linked-in copy moves.
    World linked = makeWorld();
    World loaded = makeWorld();
    aot::CallArena arena;
    aot::runBound(aot::bind(*declOf("MoveSystem"), componentsOf(linked), resourcesOf(linked)),
                  linked.entities, resourcesOf(linked), arena);
    aot::runBound(aot::bind(*decl, componentsOf(loaded), resourcesOf(loaded)),
                  loaded.entities, resourcesOf(loaded), arena);

    for (std::size_t i = 0; i < linked.entities.size(); ++i) {
        const auto* want = linked.registry.tryGet<ecs::Transform>(Entity::fromRaw(linked.entities[i]));
        const auto* got = loaded.registry.tryGet<ecs::Transform>(Entity::fromRaw(loaded.entities[i]));
        REQUIRE((want != nullptr) == (got != nullptr));
        if (want == nullptr) continue;
        CHECK(want->position.x == got->position.x);
        CHECK(want->position.y == got->position.y);
    }
}

TEST_CASE("a module built for another engine is refused, and says which half moved") {
    aot::Module mod;
    std::string why;
    // One bit of the contract, which is what a rebuilt engine looks like from
    // here. It must not open at all: a wrong offset is a read of another field.
    CHECK(mod.open(ES_AOT_MODULE_PATH, aot::expectedAbiHash(ES_EXPECTED_CONTRACT_HASH ^ 1ULL), &why) == false);
    CHECK(mod.isOpen() == false);
    CHECK(why.find("engine") != std::string::npos);

    CHECK(mod.open("no-such-module-anywhere", 0, &why) == false);
    CHECK(why.find("load") != std::string::npos);
}
#endif
