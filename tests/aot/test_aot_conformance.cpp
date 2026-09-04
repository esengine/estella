// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    test_aot_conformance.cpp
 * @brief   The compiled module against the INTERPRETER's answer, frame for frame.
 *
 * @details `test_aot_host` asks whether the emitted C moves a Registry the way
 *          the same loop written in C++ moves it. That is a real question, and
 *          it is a question between two C-family readings of one struct: the
 *          oracle is a twin written beside the harness, so a lowering that
 *          misread the AUTHOR would agree with a twin that misread it the same
 *          way.
 *
 *          This asks the other one. The oracle here is the interpreter -- the
 *          closures the App actually runs -- recorded by
 *          sdk/tests/aot-conformance.test.ts over the same seed world and
 *          checked in as `trace.h`. Same source, same seeds, same delta; the
 *          only difference is which road executes it.
 *
 *          Compared after EVERY frame rather than at the end, so a divergence
 *          names the frame it began on. `bounces` is in the comparison on
 *          purpose: it moves only on a frame a branch is taken, so a road that
 *          took the other arm is loud rather than merely off by a little.
 *
 *          Width 8 and LINKED, not loaded: the loading road is `test_aot_host`'s
 *          module case, and what is asked here is what the code computes.
 */
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <span>
#include <vector>

#include "esengine/aot/AotHost.hpp"
#include "esengine/core/Types.hpp"

#include "generated/conformance/estella_offsets.h"
#include "generated/conformance/handshake.h"
#include "generated/conformance/trace.h"

extern "C" {
/** What the artifact says it was built for, and which build it is. */
extern const std::uint64_t es_abi_hash;
std::uint32_t es_module_contract_lo(void);
std::uint32_t es_module_contract_hi(void);
/** The manifest the artifact carries: what its systems need filled in. */
extern const EsSystemDecl es_systems[];
extern const std::uint32_t es_system_count;
}

using namespace esengine;

namespace {

/** `defineComponent('ConfMover', ...)` lands in ScriptStorage, so the ABI lays
 *  it out: declaration order, f64 each, because a JS record has no narrower. */
struct MoverRow {
    double x;
    double speed;
    double bounces;
};
static_assert(offsetof(MoverRow, x) == ES_OFF_ConfMover_x, "ConfMover.x moved");
static_assert(offsetof(MoverRow, speed) == ES_OFF_ConfMover_speed, "ConfMover.speed moved");
static_assert(offsetof(MoverRow, bounces) == ES_OFF_ConfMover_bounces, "ConfMover.bounces moved");

/** The resource, host-side. Only `delta` is reached here. */
struct TimeRow {
    double delta;
};
static_assert(offsetof(TimeRow, delta) == ES_OFF_Time_delta, "Time.delta moved");

/**
 * The world the trace was recorded over, held the way ScriptStorage holds one:
 * rows at a stride, a sparse table of slot+1 by entity index, and the dense side
 * a query narrows itself by.
 */
struct World {
    std::vector<MoverRow> movers;
    std::vector<std::uint32_t> sparse;
    std::vector<std::uint32_t> owners;
    TimeRow time{ES_CONF_DELTA};

    aot::RowSpan span() {
        return aot::RowSpan{
            sparse.data(),
            static_cast<std::uint32_t>(sparse.size()),
            reinterpret_cast<unsigned char*>(movers.data()),
            static_cast<std::uint32_t>(sizeof(MoverRow)),
            Entity::Layout::INDEX_MASK,
            owners.data(),
            static_cast<std::uint32_t>(owners.size()),
        };
    }
};

/** The seed rows are the header's, not a second list: the numbers the
 *  interpreter started from are the numbers this starts from. */
World seedWorld() {
    World w;
    for (std::uint32_t i = 0; i < ES_CONF_ENTITIES; ++i) {
        // Version 0, so a raw id and its index are the same number here.
        const std::uint32_t e = i + 1u;
        w.movers.push_back(MoverRow{ES_CONF_SEED[i][0], ES_CONF_SEED[i][1], ES_CONF_SEED[i][2]});
        if (e >= w.sparse.size()) w.sparse.resize(e + 1u, 0u);
        w.sparse[e] = static_cast<std::uint32_t>(w.movers.size());   // slot + 1
        w.owners.push_back(e);
    }
    return w;
}

/** Handed over as memory, so nothing here calls back into the language that owns
 *  the rows -- which is the whole reason a script pool can be compiled at all. */
aot::ComponentLookup componentsOf(World& w) {
    return [&w](const char* name) -> aot::ComponentAt {
        return std::strcmp(name, "ConfMover") == 0 ? aot::fromRows(w.span()) : aot::ComponentAt{};
    };
}

aot::ResourceLookup resourcesOf(World& w) {
    return [&w](const char* name) -> void* {
        return std::strcmp(name, "Time") == 0 ? &w.time : nullptr;
    };
}

/** The dense side, so a query narrows to its column instead of being offered
 *  every entity this host knows. */
aot::CandidateLookup candidatesOf(World& w) {
    return [&w](const char* name) -> aot::CandidatesOf {
        if (std::strcmp(name, "ConfMover") != 0) return {};
        return [&w]() -> aot::Candidates {
            return std::span<const std::uint32_t>(w.owners.data(), w.owners.size());
        };
    };
}

const EsSystemDecl* declOf(const char* name) {
    for (std::uint32_t i = 0; i < es_system_count; ++i) {
        if (std::strcmp(es_systems[i].name, name) == 0) return &es_systems[i];
    }
    return nullptr;
}

}  // namespace

TEST_CASE("the host and the artifact agree on the handshake") {
    CHECK(es_abi_hash == aot::abiHash(ES_CONF_EXPECTED_CONTRACT_HASH));
    const std::uint64_t said =
        (static_cast<std::uint64_t>(es_module_contract_hi()) << 32) | es_module_contract_lo();
    CHECK(said == ES_CONF_EXPECTED_MODULE_CONTRACT);
}

TEST_CASE("the module answers the interpreter's world after every frame") {
    World w = seedWorld();

    // Bound by NAME rather than by table position: the order they run in is the
    // schedule's, and the artifact is free to declare them in any other.
    const EsSystemDecl* driftDecl = declOf("ConfDrift");
    const EsSystemDecl* clampDecl = declOf("ConfClamp");
    REQUIRE(driftDecl != nullptr);
    REQUIRE(clampDecl != nullptr);
    const aot::BoundSystem drift =
        aot::bind(*driftDecl, componentsOf(w), resourcesOf(w), candidatesOf(w));
    const aot::BoundSystem clamp =
        aot::bind(*clampDecl, componentsOf(w), resourcesOf(w), candidatesOf(w));
    // An unbound system is not run at all, and a differential against a world
    // nothing touched reads as a disagreement about arithmetic.
    REQUIRE(drift.fn != nullptr);
    REQUIRE(clamp.fn != nullptr);

    const std::vector<std::uint32_t> every = w.owners;
    aot::CallArena arena;
    const aot::ResourceLookup resources = resourcesOf(w);

    for (std::uint32_t f = 0; f < ES_CONF_FRAMES; ++f) {
        // The order the trace was recorded in: drift moves, then clamp reflects
        // whatever left the interval.
        CHECK(aot::runBound(drift, every, resources, arena).empty());
        CHECK(aot::runBound(clamp, every, resources, arena).empty());

        for (std::uint32_t i = 0; i < ES_CONF_ENTITIES; ++i) {
            const MoverRow& got = w.movers[i];
            const double* want = ES_CONF_EXPECT[f][i];
            INFO("frame ", f, ", entity ", i);
            // Exact: both roads do the same operations in the same order on
            // binary64, which is what -ffp-contract=off is here to keep true.
            CHECK(got.x == want[0]);
            CHECK(got.speed == want[1]);
            CHECK(got.bounces == want[2]);
        }
    }
}

TEST_CASE("the fixture has somewhere to diverge") {
    // A trace that never moves, or never branches, agrees on every road: these
    // are the properties that make the comparison above worth running.
    bool moved = false;
    bool bounced = false;
    for (std::uint32_t i = 0; i < ES_CONF_ENTITIES; ++i) {
        if (ES_CONF_EXPECT[ES_CONF_FRAMES - 1u][i][0] != ES_CONF_SEED[i][0]) moved = true;
        if (ES_CONF_EXPECT[ES_CONF_FRAMES - 1u][i][2] != 0.0) bounced = true;
    }
    CHECK(moved);
    CHECK(bounced);
}
