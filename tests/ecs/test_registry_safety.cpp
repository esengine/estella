// Native harness for Registry/SparseSet release-safety (Audit A6 + A7).
//
// Header-only against Registry.hpp (no esengine link), runs on any C++20 toolchain.
// IMPORTANT: compiled WITHOUT -DES_DEBUG, so ES_ASSERT expands to ((void)0) —
// exactly the release config where these bugs bite. Under the old code:
//   A6: get<T> on a non-member entity indexed components_[INVALID_INDEX] (OOB read).
//   A7: a re-entrant destroy(entity) from an onDestroy callback ran teardown twice,
//       underflowing entity_count_ and double-recycling the index.
//
//   clang++ -std=c++20 -I src tests/ecs/test_registry_safety.cpp \
//     src/esengine/core/Log.cpp -o /tmp/test_reg && /tmp/test_reg

#include "esengine/ecs/Registry.hpp"

#include <cstdio>

using esengine::Entity;
using esengine::u32;
using esengine::ecs::Registry;

namespace {
struct Pos { float x = 1.0f; float y = 2.0f; };
struct Vel { float dx = 0.0f; };
}

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

// Counts ES_VERIFY failures so tests can assert "the guard fired and the
// recovery is the real value" rather than just "it didn't crash".
static int g_verifyHits = 0;
static void countingVerifyHook(const char*, const char*, int) { ++g_verifyHits; }

int main() {
    // --- get<T> has a contract; absence goes through the checked API ---
    // A miss aborts, so absence is asked with has/tryGet and created with
    // getOrEmplace — the three doors, each exercised below.
    {
        Registry r;
        Entity e = r.create();
        r.emplace<Pos>(e, Pos{10.0f, 20.0f});

        CHECK(r.get<Pos>(e).x == 10.0f, "get returns the real component when present");
        CHECK(r.tryGet<Pos>(e) == &r.get<Pos>(e), "tryGet points at the same component");

        // Pool exists, but this entity is not a member.
        Entity other = r.create();
        CHECK(!r.has<Pos>(other), "has<Pos> is false for a non-member");
        CHECK(r.tryGet<Pos>(other) == nullptr, "tryGet<Pos> on a non-member is null");

        // Pool does not exist at all.
        CHECK(!r.has<Vel>(e), "has<Vel> is false with no Vel pool");
        CHECK(r.tryGet<Vel>(e) == nullptr, "tryGet<Vel> with no Vel pool is null");

        // getOrEmplace is the third door: create it rather than assume or check.
        Vel& v = r.getOrEmplace<Vel>(e, Vel{3.0f});
        CHECK(v.dx == 3.0f && r.has<Vel>(e), "getOrEmplace creates the missing component");
        CHECK(&r.getOrEmplace<Vel>(e) == &v, "getOrEmplace returns the existing one on the next call");
    }

    // --- A7: re-entrant destroy(entity) from onDestroy must not double-teardown ---
    {
        Registry r;
        Entity e = r.create();
        int calls = 0;
        // Hold the Connection: onDestroy now returns an RAII handle (RC12); a
        // discarded return would disconnect immediately and the callback would
        // never fire, making the re-entrancy below untested.
        esengine::Connection conn = r.onDestroy([&](Entity ent) {
            if (calls++ == 0) r.destroy(ent);  // re-entrant destroy of the SAME entity
        });
        CHECK(r.entityCount() == 1u, "one live entity before destroy");

        r.destroy(e);
        CHECK(r.entityCount() == 0u, "entity_count is 0 after re-entrant destroy (no underflow)");

        // Weak assertion (kept for documentation): create()'s `if (entityValid_[index])`
        // guard masks the double-recycle — the duplicate idx is skipped on the second
        // pop — so this passes even against the old code. The real, testable harm of
        // double-recycle is the entity_count underflow asserted above.
        Entity a = r.create();
        Entity b = r.create();
        CHECK(a.index() != b.index(), "indices not aliased after re-entrant destroy");
        CHECK(r.valid(a) && r.valid(b), "both recreated entities are valid");
    }

    // --- onDestroy: the RAII Connection auto-unregisters on scope exit ---
    // A system that held a raw callback id and forgot to remove it left a
    // dangling `this` in the registry (the ParticleSystem / SpineSystem bug).
    // The Connection makes that impossible: the callback is gone once the
    // returned Connection is destroyed. ASAN here would catch a disconnect
    // that reached into freed memory.
    {
        Registry r;
        int hits = 0;
        {
            auto conn = r.onDestroy([&](Entity) { ++hits; });
            Entity e = r.create();
            r.destroy(e);
            CHECK(hits == 1, "scoped onDestroy fires while the Connection is alive");
        }
        // Connection destroyed -> callback unregistered.
        Entity e2 = r.create();
        r.destroy(e2);
        CHECK(hits == 1, "callback no longer fires once the Connection is destroyed");
    }

    // emplace on an invalid entity would write component_masks_[sentinel] out of
    // bounds and has no component to return: fatal, not a fallback. valid() is
    // how a caller asks beforehand; the abort itself is not exercised here.
    {
        Registry r;
        CHECK(!r.valid(Entity{}), "the invalid sentinel does not pass valid()");
        Entity e = r.create();
        r.destroy(e);
        CHECK(!r.valid(e), "a destroyed entity does not pass valid()");
    }

    // --- ES_VERIFY: restore() with an over-range (deserialized) index is refused ---
    // This is the scene-loading path: a corrupt/huge index must not silently
    // alias an existing slot via Entity::make's 20-bit mask.
    {
        esengine::detail::verifyHook() = countingVerifyHook;
        Registry r;
        Entity a = r.create();  // real entity at index 0

        g_verifyHits = 0;
        Entity bad = r.restore(Entity::INDEX_MASK + 1);  // beyond the 20-bit range
        CHECK(g_verifyHits == 1, "restore(over-range) fires the verify hook");
        CHECK(!bad.isValid(), "restore(over-range) returns INVALID_ENTITY (no silent alias)");
        CHECK(r.valid(a), "the pre-existing entity is untouched after a bad restore");

        // next_index_ must not be corrupted by the rejected restore: fresh
        // allocation still works and does not alias the survivor.
        Entity c = r.create();
        CHECK(r.valid(c) && c.index() != a.index(), "create() still works after a rejected restore");

        esengine::detail::verifyHook() = nullptr;
    }

    // --- ES_VERIFY: duplicate emplace degrades to the existing component ---
    // A second emplace on the same entity would push a duplicate dense slot and
    // overwrite the sparse mapping (corruption). The guard degrades to get().
    {
        esengine::detail::verifyHook() = countingVerifyHook;
        Registry r;
        Entity e = r.create();
        r.emplace<Pos>(e, Pos{3.0f, 4.0f});

        g_verifyHits = 0;
        Pos& dup = r.emplace<Pos>(e, Pos{100.0f, 200.0f});  // duplicate
        CHECK(g_verifyHits == 1, "duplicate emplace fires the verify hook");
        CHECK(dup.x == 3.0f && dup.y == 4.0f, "duplicate emplace returns the existing component (no corruption)");
        CHECK(r.get<Pos>(e).x == 3.0f, "entity still maps to the original component");

        esengine::detail::verifyHook() = nullptr;
    }

    // --- PackedId / Entity 22+10 packing is correct and round-trips ---
    {
        CHECK(Entity::INDEX_BITS == 22u && Entity::GEN_BITS == 10u, "Entity split is 22+10");
        CHECK(Entity::INDEX_MASK == 0x3FFFFFu, "index mask is 2^22-1");
        CHECK(Entity::GEN_MASK == 0x3FFu, "generation mask is 2^10-1");

        // Round-trip across the corners, including the max generation that would
        // overflow a signed-32 shift on the JS side (here it's unsigned C++).
        const u32 idxs[] = {0u, 1u, 1234u, Entity::INDEX_MASK};
        const u32 gens[] = {1u, 2u, 512u, Entity::GEN_MASK};
        bool roundtrip_ok = true;
        for (u32 idx : idxs) {
            for (u32 gen : gens) {
                Entity e = Entity::make(idx, gen);
                if (e.index() != idx || e.generation() != gen) roundtrip_ok = false;
                if (Entity::fromRaw(e.id()) != e) roundtrip_ok = false;
            }
        }
        CHECK(roundtrip_ok, "Entity::make/index/generation/fromRaw round-trip for all corners");

        // PackedId is the single source the split is derived from.
        using L = esengine::PackedId<22, 10>;
        CHECK(L::pack(7u, 3u) == Entity::make(7u, 3u).raw, "PackedId::pack matches Entity::make");
        CHECK(L::indexOf(L::pack(99u, 5u)) == 99u, "PackedId index round-trips");
        CHECK(L::generationOf(L::pack(99u, 5u)) == 5u, "PackedId generation round-trips");
    }

    if (g_failures == 0) {
        std::printf("\nALL ECS SAFETY TESTS PASSED\n");
        return 0;
    }
    std::printf("\n%d FAILURE(S)\n", g_failures);
    return 1;
}
