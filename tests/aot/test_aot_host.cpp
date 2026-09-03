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
#include <span>
#include <string>
#include <vector>

#include "esengine/aot/AotHost.hpp"
#include "esengine/aot/AotComponents.generated.hpp"
#include "esengine/aot/AotModule.hpp"
#include "esengine/aot/AotDispatcher.hpp"
#include "esengine/aot/AotCommands.hpp"
#include "esengine/aot/EngineDigest.generated.h"
#include "esengine/ecs/Registry.hpp"
#include "esengine/ecs/components/Transform.hpp"

extern "C" {
#include "generated/estella_offsets.h"
#include "generated/move_system_hash.h"
/** The compiled system. One symbol, and it calls nothing. */
void es_sys_MoveSystem(es_addr_t ctx);
extern const std::uint64_t es_abi_hash;
std::uint32_t es_module_contract_lo();
std::uint32_t es_module_contract_hi();
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
    std::vector<std::uint32_t> moverOwners;  // slot -> entity, the pool's dense side
    /** Entities carrying Transform and no Mover: the world around the matched
     *  set, which is what a host that offers every entity pays for. */
    std::vector<std::uint32_t> bystanders;
    TimeRow time{1.0 / 30.0};

    aot::RowSpan moverSpan() {
        return aot::RowSpan{
            moverSparse.data(),
            static_cast<std::uint32_t>(moverSparse.size()),
            reinterpret_cast<unsigned char*>(movers.data()),
            static_cast<std::uint32_t>(sizeof(MoverRow)),
            Entity::Layout::INDEX_MASK,
            moverOwners.data(),
            static_cast<std::uint32_t>(moverOwners.size()),
        };
    }

    /** Movers first, then the rest: what a host with nothing to narrow by has
     *  to hand over, and what narrowing exists to stop it handing over. */
    std::vector<std::uint32_t> everyEntity() const {
        std::vector<std::uint32_t> all = entities;
        all.insert(all.end(), bystanders.begin(), bystanders.end());
        return all;
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
        w.moverOwners.push_back(e.id());
    }
    return w;
}

/** Entities with a Transform and no Mover, so no query here can match them. */
void addBystanders(World& w, int count) {
    for (int i = 0; i < count; ++i) {
        Entity e = w.registry.create();
        w.registry.emplace<ecs::Transform>(e);
        w.bystanders.push_back(e.id());
    }
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

/**
 * Who holds each column - the lookup that lets a query narrow itself.
 *
 * `Transform` goes through the GENERATED table, so this exercises the thing a
 * real host uses rather than a second answer written here; `Mover` stands in for
 * a script pool's dense side, which is the half a sparse table cannot give.
 */
aot::CandidateLookup candidatesOf(World& w) {
    return [&w](const char* name) -> aot::CandidatesOf {
        if (std::strcmp(name, "Transform") == 0) {
            return aot::engineComponentCandidates(w.registry, name);
        }
        if (std::strcmp(name, "Mover") == 0) {
            return [&w]() -> aot::Candidates {
                return std::span<const std::uint32_t>(w.moverOwners.data(), w.moverOwners.size());
            };
        }
        return {};
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

// Which BUILD the artifact is, for a loader holding the sidecar beside it: two
// builds agree on the handshake above while declaring different mut flags. Two
// functions, because a module sharing the engine's memory has no data section.
TEST_CASE("the artifact says which build it is") {
    const std::uint64_t said =
        (static_cast<std::uint64_t>(es_module_contract_hi()) << 32) | es_module_contract_lo();
    CHECK(said == ES_EXPECTED_MODULE_CONTRACT);
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
    const std::uint64_t expected = aot::abiHash(ES_EXPECTED_CONTRACT_HASH);
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
    CHECK(mod.open(ES_AOT_MODULE_PATH, aot::abiHash(ES_EXPECTED_CONTRACT_HASH ^ 1ULL), &why) == false);
    CHECK(mod.isOpen() == false);
    CHECK(why.find("engine") != std::string::npos);

    CHECK(mod.open("no-such-module-anywhere", 0, &why) == false);
    CHECK(why.find("load") != std::string::npos);
}
#endif

#ifdef ES_AOT_MODULE_PATH
TEST_CASE("the dispatcher binds once and runs by index") {
    World w = makeWorld();
    World linked = makeWorld();
    aot::Dispatcher dispatcher;
    std::string why;

    REQUIRE_MESSAGE(dispatcher.install(ES_AOT_MODULE_PATH, aot::abiHash(ES_EXPECTED_CONTRACT_HASH),
                                       componentsOf(w), resourcesOf(w), &why), why);
    REQUIRE(dispatcher.count() == 1u);

    // The index is resolved once, here, because the scheduler asks for the same
    // system every frame and a strcmp there is per system per frame.
    const std::size_t at = dispatcher.indexOf("MoveSystem");
    REQUIRE(at != aot::Dispatcher::npos);
    CHECK(dispatcher.boundAt(at));
    CHECK(std::strcmp(dispatcher.nameAt(at), "MoveSystem") == 0);
    CHECK(dispatcher.indexOf("NotASystem") == aot::Dispatcher::npos);

    // Three frames, so a binding that only survives the first one shows up.
    aot::CallArena arena;
    for (int frame = 0; frame < 3; ++frame) {
        dispatcher.run(at, w.entities, resourcesOf(w));
        aot::runBound(aot::bind(*declOf("MoveSystem"), componentsOf(linked), resourcesOf(linked)),
                      linked.entities, resourcesOf(linked), arena);
    }
    for (std::size_t i = 0; i < w.entities.size(); ++i) {
        const auto* want = linked.registry.tryGet<ecs::Transform>(Entity::fromRaw(linked.entities[i]));
        const auto* got = w.registry.tryGet<ecs::Transform>(Entity::fromRaw(w.entities[i]));
        REQUIRE((want != nullptr) == (got != nullptr));
        if (want == nullptr) continue;
        CHECK(want->position.x == got->position.x);
        CHECK(want->position.y == got->position.y);
    }
}

TEST_CASE("a system this host cannot name is left unbound, not refused") {
    World w = makeWorld();
    aot::Dispatcher dispatcher;
    std::string why;

    // A host with no `Mover` — the shape of a project whose script pool has not
    // been handed over yet. The module still installs: the fallback is PER
    // SYSTEM, so one it cannot run must not cost the others their module.
    const aot::ComponentLookup partial = [&w](const char* name) -> aot::ComponentAt {
        if (std::strcmp(name, "Transform") == 0) {
            return [&w](std::uint32_t e) -> void* {
                return w.registry.tryGet<ecs::Transform>(Entity::fromRaw(e));
            };
        }
        return nullptr;
    };

    REQUIRE(dispatcher.install(ES_AOT_MODULE_PATH, aot::abiHash(ES_EXPECTED_CONTRACT_HASH),
                               partial, resourcesOf(w), &why));
    const std::size_t at = dispatcher.indexOf("MoveSystem");
    REQUIRE(at != aot::Dispatcher::npos);
    CHECK(dispatcher.boundAt(at) == false);

    // And running it moves nothing, rather than reading a row it never packed.
    const World fresh = makeWorld();
    CHECK(dispatcher.run(at, w.entities, resourcesOf(w)).empty());
    for (std::size_t i = 0; i < w.entities.size(); ++i) {
        const auto* got = w.registry.tryGet<ecs::Transform>(Entity::fromRaw(w.entities[i]));
        const auto* start = fresh.registry.tryGet<ecs::Transform>(Entity::fromRaw(fresh.entities[i]));
        if (got == nullptr || start == nullptr) continue;
        CHECK(got->position.x == start->position.x);
    }
}
#endif

TEST_CASE("the digest a host carries is the one a native module bakes") {
    // One number, or a host refuses every module built for it — which reads as
    // "AOT does not work here" rather than as a constant that drifted.
    CHECK(ES_ENGINE_ABI_DIGEST_64 == ES_EXPECTED_CONTRACT_HASH);
    CHECK(ES_ENGINE_ABI_DIGEST_32 != ES_ENGINE_ABI_DIGEST_64);
    // And the one the preprocessor picks is this machine's.
    CHECK(ES_ENGINE_ABI_DIGEST == (sizeof(es_addr_t) == 8
                                       ? ES_ENGINE_ABI_DIGEST_64
                                       : ES_ENGINE_ABI_DIGEST_32));
}

#ifdef ES_AOT_MODULE_PATH
TEST_CASE("a pool that moved its rows takes the twin with it") {
    World w = makeWorld();
    World linked = makeWorld();
    aot::Dispatcher dispatcher;
    std::string why;

    // The slot the OWNER overwrites. A resolver holding the span by value reads
    // the rows' first home for as long as it lives.
    aot::RowSpan slot = w.moverSpan();
    const aot::ComponentLookup moving = [&w, &slot](const char* name) -> aot::ComponentAt {
        if (std::strcmp(name, "Transform") == 0) {
            return [&w](std::uint32_t e) -> void* {
                return w.registry.tryGet<ecs::Transform>(Entity::fromRaw(e));
            };
        }
        if (std::strcmp(name, "Mover") == 0) return aot::fromMovingRows(&slot);
        return nullptr;
    };

    REQUIRE_MESSAGE(dispatcher.install(ES_AOT_MODULE_PATH, aot::abiHash(ES_EXPECTED_CONTRACT_HASH),
                                       moving, resourcesOf(w), &why), why);
    const std::size_t at = dispatcher.indexOf("MoveSystem");
    REQUIRE(at != aot::Dispatcher::npos);

    aot::CallArena arena;
    const auto runLinked = [&] {
        aot::runBound(aot::bind(*declOf("MoveSystem"), componentsOf(linked), resourcesOf(linked)),
                      linked.entities, resourcesOf(linked), arena);
    };
    dispatcher.run(at, w.entities, resourcesOf(w));
    runLinked();

    // The new home's CONTENT differs, or a stale resolver reads the same bytes
    // and passes. A live second vector, not a freed buffer: what a stale read
    // returns has to be defined or this proves nothing.
    std::vector<MoverRow> relocated = w.movers;
    for (MoverRow& row : relocated) row.speed *= 3.0;
    for (MoverRow& row : linked.movers) row.speed *= 3.0;
    slot = aot::RowSpan{
        w.moverSparse.data(), static_cast<std::uint32_t>(w.moverSparse.size()),
        reinterpret_cast<unsigned char*>(relocated.data()),
        static_cast<std::uint32_t>(sizeof(MoverRow)), Entity::Layout::INDEX_MASK,
    };

    dispatcher.run(at, w.entities, resourcesOf(w));
    runLinked();

    for (std::size_t i = 0; i < w.entities.size(); ++i) {
        const auto* want = linked.registry.tryGet<ecs::Transform>(Entity::fromRaw(linked.entities[i]));
        const auto* got = w.registry.tryGet<ecs::Transform>(Entity::fromRaw(w.entities[i]));
        REQUIRE((want != nullptr) == (got != nullptr));
        if (want == nullptr) continue;
        CHECK(want->position.x == got->position.x);
        CHECK(want->position.y == got->position.y);
    }
}
#endif

TEST_CASE("the records a call wrote are applied after it, and unknown ones are counted") {
    World w = makeWorld();
    const std::uint32_t victim = w.entities[2];
    const std::uint32_t bystander = w.entities[3];
    REQUIRE(w.registry.valid(Entity::fromRaw(victim)));

    const EsCmd cmds[] = {
        { ES_CMD_DESPAWN, victim, 0u, 0u },
        // A kind this host has not learned. Counted, because a host quietly
        // dropping one looks exactly like a system that did nothing.
        { 0xFFFFFFFFu, bystander, 0u, 0u },
    };
    const std::uint32_t unknown = aot::applyCommands(w.registry, cmds);

    CHECK(unknown == 1u);
    CHECK(w.registry.valid(Entity::fromRaw(victim)) == false);
    CHECK(w.registry.valid(Entity::fromRaw(bystander)));
}

// ---------------------------------------------------------------------------
// Narrowing: which entities a query is paid over.
//
// The completeness check still FILTERS; narrowing only changes the bill. Each
// test asks both halves: identical rows, and no wide list needed to get them.
// ---------------------------------------------------------------------------

TEST_CASE("a narrowed query moves exactly the world the wide one moved") {
    World wide = makeWorld();
    World narrow = makeWorld();
    addBystanders(wide, 200);
    addBystanders(narrow, 200);

    const EsSystemDecl* decl = declOf("MoveSystem");
    REQUIRE(decl != nullptr);
    const aot::BoundSystem plain = aot::bind(*decl, componentsOf(wide), resourcesOf(wide));
    const aot::BoundSystem narrowed = aot::bind(*decl, componentsOf(narrow), resourcesOf(narrow),
                                                candidatesOf(narrow));
    REQUIRE(plain.fn != nullptr);
    REQUIRE(narrowed.fn != nullptr);
    // The premise: only one of them can say where its rows come from.
    CHECK(aot::narrows(plain.queries) == false);
    CHECK(aot::narrows(narrowed.queries));

    aot::CallArena arena;
    for (int frame = 0; frame < 8; ++frame) {
        const std::vector<std::uint32_t> all = wide.everyEntity();
        aot::runBound(plain, all, resourcesOf(wide), arena);
        // EMPTY, not the world: if narrowing were not doing the work, this frame
        // would move nothing and the comparison below would fail loudly.
        aot::runBound(narrowed, {}, resourcesOf(narrow), arena);
    }

    for (std::size_t i = 0; i < wide.entities.size(); ++i) {
        const auto* a = wide.registry.tryGet<ecs::Transform>(Entity::fromRaw(wide.entities[i]));
        const auto* b = narrow.registry.tryGet<ecs::Transform>(Entity::fromRaw(narrow.entities[i]));
        REQUIRE(a != nullptr);
        REQUIRE(b != nullptr);
        CHECK(a->position.x == b->position.x);
        CHECK(a->position.y == b->position.y);
    }
    // And the entities no query names are untouched by either, which is the
    // claim narrowing makes about them.
    for (std::size_t i = 0; i < narrow.bystanders.size(); ++i) {
        const auto* b = narrow.registry.tryGet<ecs::Transform>(Entity::fromRaw(narrow.bystanders[i]));
        REQUIRE(b != nullptr);
        CHECK(b->position.x == 0.0f);
        CHECK(b->position.y == 0.0f);
    }
}

TEST_CASE("the shortest column is the one walked, and both give the same rows") {
    World w = makeWorld();
    addBystanders(w, 500);

    const EsSystemDecl* decl = declOf("MoveSystem");
    REQUIRE(decl != nullptr);
    const aot::BoundSystem bound = aot::bind(*decl, componentsOf(w), resourcesOf(w), candidatesOf(w));
    REQUIRE(bound.fn != nullptr);
    REQUIRE(bound.queries.size() == 1u);

    // Transform is on every entity here; Mover is on 24 of them. The query names
    // both, so an entity missing either cannot match and the shorter column
    // bounds the answer.
    const aot::Candidates chosen = aot::narrowest(bound.queries[0]);
    REQUIRE(chosen.has_value());
    CHECK(chosen->size() == w.entities.size());
    CHECK(chosen->size() < w.everyEntity().size());
}

TEST_CASE("a column that cannot say does not narrow, and the caller widens") {
    World w = makeWorld();
    addBystanders(w, 50);

    const EsSystemDecl* decl = declOf("MoveSystem");
    REQUIRE(decl != nullptr);
    // A lookup that answers for neither: the shape of a host built before the
    // owner table existed, and of a script pool that has not reported one yet.
    const aot::BoundSystem silent = aot::bind(*decl, componentsOf(w), resourcesOf(w),
                                              [](const char*) { return aot::CandidatesOf{}; });
    REQUIRE(silent.fn != nullptr);
    CHECK(aot::narrows(silent.queries) == false);
    CHECK(aot::narrowest(silent.queries[0]).has_value() == false);

    // nullopt must not be read as "nobody": handed the world, it still runs.
    // Summed, not sampled: the fixture spreads directions over signs AND zero,
    // so the first entity's dx is 0 and a sample there proves nothing.
    const auto sum = [&w] {
        double total = 0.0;
        for (std::uint32_t e : w.entities) {
            const auto* t = w.registry.tryGet<ecs::Transform>(Entity::fromRaw(e));
            total += static_cast<double>(t->position.x) + static_cast<double>(t->position.y);
        }
        return total;
    };
    aot::CallArena arena;
    const double before = sum();
    const std::vector<std::uint32_t> all = w.everyEntity();
    aot::runBound(silent, all, resourcesOf(w), arena);
    CHECK(before != sum());
}

TEST_CASE("an empty column is a query that matches nothing, not a query that widens") {
    World w = makeWorld();
    const EsSystemDecl* decl = declOf("MoveSystem");
    REQUIRE(decl != nullptr);

    // The difference this whole distinction exists for. `Mover` says it holds
    // nobody; if that were read as "cannot say", the system would fall back to
    // the world and move entities whose component is gone.
    const aot::BoundSystem bound = aot::bind(
        *decl, componentsOf(w), resourcesOf(w),
        [&w](const char* name) -> aot::CandidatesOf {
            if (std::strcmp(name, "Transform") == 0) {
                return aot::engineComponentCandidates(w.registry, name);
            }
            return []() -> aot::Candidates { return std::span<const std::uint32_t>{}; };
        });
    REQUIRE(bound.fn != nullptr);
    const aot::Candidates chosen = aot::narrowest(bound.queries[0]);
    REQUIRE(chosen.has_value());
    CHECK(chosen->empty());
}

TEST_CASE("a freed slot in a column is a hole, and the hole resolves to no row") {
    World w = makeWorld();
    // What a pool that reuses slots rather than compacting leaves behind. The
    // row stays where it is; only the owner is forgotten.
    w.moverOwners[3] = aot::NO_OWNER;
    w.moverOwners[7] = aot::NO_OWNER;

    aot::RowSpan span = w.moverSpan();
    const aot::CandidatesOf of = aot::fromMovingOwners(&span);
    const aot::Candidates got = of();
    REQUIRE(got.has_value());
    // The count is the high-water mark, holes included - narrowing is about the
    // order of magnitude, and skipping them here would cost a pass to save none.
    CHECK(got->size() == w.entities.size());
    CHECK((*got)[3] == aot::NO_OWNER);
    // And a hole reaches no component, so the completeness check drops the row:
    // NO_OWNER is Entity::INVALID_RAW, which the world never hands out.
    CHECK(w.registry.tryGet<ecs::Transform>(Entity::fromRaw(aot::NO_OWNER)) == nullptr);
    CHECK(aot::rowAt(span, aot::NO_OWNER) == nullptr);
}

TEST_CASE("a column with no owner table cannot say, which is not the same as empty") {
    World w = makeWorld();
    aot::RowSpan span = w.moverSpan();
    span.owners = nullptr;
    span.ownerCount = 0;
    CHECK(aot::fromMovingOwners(&span)().has_value() == false);
    // And a null slot is the same answer, for the pool that does not exist yet.
    CHECK(aot::fromMovingOwners(nullptr)().has_value() == false);
}

TEST_CASE("the generated table answers who has a component, and says so by name") {
    World w = makeWorld();
    addBystanders(w, 10);

    const aot::CandidatesOf of = aot::engineComponentCandidates(w.registry, "Transform");
    REQUIRE(static_cast<bool>(of));
    const aot::Candidates got = of();
    REQUIRE(got.has_value());
    CHECK(got->size() == w.entities.size() + w.bystanders.size());

    // A name this table does not answer for leaves an EMPTY function - the
    // caller must not read that as an empty column, or it narrows to nothing.
    CHECK(static_cast<bool>(aot::engineComponentCandidates(w.registry, "Mover")) == false);

    // Live, not a snapshot: the column is asked again per call because a pool
    // grows between them.
    addBystanders(w, 5);
    CHECK(of()->size() == w.entities.size() + w.bystanders.size());
}

// ---------------------------------------------------------------------------
// Keeping the row table. A cache is worth what its invalidation is worth, so
// every test here moves the world one way and asks whether the rows followed.
// The stamp is the real pair the host sums, so a hole in it is a hole here.
// ---------------------------------------------------------------------------

namespace {

const ecs::Transform* xf(World& w, std::uint32_t e) {
    return w.registry.tryGet<ecs::Transform>(Entity::fromRaw(e));
}

/** An entity holding a Mover row and NO Transform, so no query matches it yet. */
void addMoverOnly(World& w) {
    Entity e = w.registry.create();
    w.entities.push_back(e.id());
    w.movers.push_back(MoverRow{60.0, 1.0, -1.0});
    const std::uint32_t at = e.index();
    if (at >= w.moverSparse.size()) w.moverSparse.resize(at + 1u, 0u);
    w.moverSparse[at] = static_cast<std::uint32_t>(w.movers.size());
    w.moverOwners.push_back(e.id());
}

}  // namespace

TEST_CASE("a table packed against a standing world is not packed again") {
    World w = makeWorld();
    addBystanders(w, 100);
    const aot::BoundSystem bound = aot::bind(*declOf("MoveSystem"), componentsOf(w),
                                             resourcesOf(w), candidatesOf(w));
    REQUIRE(bound.fn != nullptr);

    const aot::WorldStamp world{w.registry.layoutEpoch(), true};
    aot::CallArena arena;
    aot::runBound(bound, {}, resourcesOf(w), arena, world);
    CHECK(arena.rowsPacked() == w.entities.size());
    const float afterFirst = xf(w, w.entities[1])->position.x;

    // Same world, same stamp: the rows stand, and the system still runs over
    // them — a saving, not a skip.
    aot::runBound(bound, {}, resourcesOf(w), arena, world);
    CHECK(arena.rowsPacked() == 0u);
    CHECK(arena.candidatesWalked() == w.entities.size());
    CHECK(xf(w, w.entities[1])->position.x != afterFirst);
}

TEST_CASE("an unknown stamp is never the same world twice") {
    World w = makeWorld();
    const aot::BoundSystem bound = aot::bind(*declOf("MoveSystem"), componentsOf(w),
                                             resourcesOf(w), candidatesOf(w));
    aot::CallArena arena;
    // The default: a host that cannot date its world. Trusting an address
    // because nobody could say it moved is how compiled code reads other bytes.
    for (int i = 0; i < 3; ++i) {
        aot::runBound(bound, {}, resourcesOf(w), arena);
        CHECK(arena.rowsPacked() == w.entities.size());
    }
}

TEST_CASE("a query that falls back keeps no table") {
    World w = makeWorld();
    // No candidate lookup: the list is the caller's, and a caller that cannot
    // say who matches cannot say whether that changed either.
    const aot::BoundSystem wide = aot::bind(*declOf("MoveSystem"), componentsOf(w), resourcesOf(w));
    const aot::WorldStamp world{w.registry.layoutEpoch(), true};
    aot::CallArena arena;
    for (int i = 0; i < 3; ++i) {
        aot::runBound(wide, w.everyEntity(), resourcesOf(w), arena, world);
        CHECK(arena.rowsPacked() == w.entities.size());
    }
}

TEST_CASE("a cached table follows the world, whichever way it moved") {
    World kept = makeWorld();
    World fresh = makeWorld();
    // Scenery first, so Transform is the LONGER column and the query narrows on
    // Mover. Without it Transform is the shorter one, the narrowed column moves
    // when it does, and the subcase below stops testing anything.
    addBystanders(kept, 50);
    addBystanders(fresh, 50);
    addMoverOnly(kept);
    addMoverOnly(fresh);

    const aot::BoundSystem keptBound = aot::bind(*declOf("MoveSystem"), componentsOf(kept),
                                                 resourcesOf(kept), candidatesOf(kept));
    // No candidate lookup and no stamp: the control repacks every frame by
    // construction, so the two agree only if invalidation is right.
    const aot::BoundSystem freshBound = aot::bind(*declOf("MoveSystem"), componentsOf(fresh),
                                                  resourcesOf(fresh));
    aot::CallArena keptArena;
    aot::CallArena freshArena;
    double scriptEpoch = 0.0;

    const auto step = [&] {
        const aot::WorldStamp world{kept.registry.layoutEpoch() + scriptEpoch, true};
        aot::runBound(keptBound, kept.everyEntity(), resourcesOf(kept), keptArena, world);
        aot::runBound(freshBound, fresh.everyEntity(), resourcesOf(fresh), freshArena);
        for (std::size_t i = 0; i < fresh.entities.size(); ++i) {
            const auto* a = xf(kept, kept.entities[i]);
            const auto* b = xf(fresh, fresh.entities[i]);
            REQUIRE((a == nullptr) == (b == nullptr));
            if (a == nullptr) continue;
            REQUIRE(a->position.x == b->position.x);
            REQUIRE(a->position.y == b->position.y);
        }
    };

    step();
    step();

    SUBCASE("an entity joins by gaining the component the query did NOT narrow on") {
        // The trap this exists for. The query narrows on Mover, whose column does
        // not move; Transform's does, and an emplace inside its capacity bumps
        // no version — so only checking EVERY column the query names reports it.
        for (World* w : { &kept, &fresh }) {
            w->registry.emplace<ecs::Transform>(Entity::fromRaw(w->entities.back()));
        }
        step();
        step();
        CHECK(xf(kept, kept.entities.back()) != nullptr);
        CHECK(xf(kept, kept.entities.back())->position.x != 0.0f);
    }

    SUBCASE("an entity leaves, leaving a hole no span can see") {
        // A freed slot keeps the column's pointer AND its length: `next_` never
        // shrinks. Nothing but the script epoch can report this one.
        const std::uint32_t gone = kept.entities[4];
        for (World* w : { &kept, &fresh }) {
            w->moverOwners[4] = aot::NO_OWNER;
            w->moverSparse[Entity::fromRaw(w->entities[4]).index()] = 0u;
        }
        scriptEpoch += 1.0;
        step();
        const float held = xf(kept, gone)->position.x;
        step();
        CHECK(xf(kept, gone)->position.x == held);
    }

    SUBCASE("the same entities, at other addresses") {
        // What the stamp is really for. Sorting permutes the pool IN PLACE, so
        // the column keeps its pointer and its length while every row it named
        // moves; `rebuildSparse` bumps the version and that is the only tell.
        for (World* w : { &kept, &fresh }) {
            w->registry.sort<ecs::Transform>([](const ecs::Transform& a, const ecs::Transform& b) {
                return a.position.x < b.position.x;
            });
        }
        step();
        step();
    }
}
