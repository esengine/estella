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
struct Pos { float x = 1.0f; float y = 2.0f; };   // fallback{} has x=1, y=2
struct Vel { float dx = 0.0f; };
}

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

// Counts ES_VERIFY failures so tests can assert "the guard fired and we
// degraded gracefully" rather than just "it didn't crash".
static int g_verifyHits = 0;
static void countingVerifyHook(const char*, const char*, int) { ++g_verifyHits; }

int main() {
    // --- A6: get<T> on an entity without the component returns fallback (no OOB) ---
    {
        Registry r;
        Entity e = r.create();
        r.emplace<Pos>(e, Pos{10.0f, 20.0f});

        CHECK(r.get<Pos>(e).x == 10.0f, "get returns the real component when present");

        // Pool exists, but this entity is not a member -> SparseSet::get fallback.
        Entity other = r.create();
        Pos& p = r.get<Pos>(other);
        CHECK(p.x == 1.0f && p.y == 2.0f, "get<Pos> on non-member returns fallback defaults (no OOB)");

        // Pool does not exist at all -> Registry::get fallback.
        Vel& v = r.get<Vel>(e);
        CHECK(v.dx == 0.0f, "get<Vel> with no Vel pool returns fallback (no OOB)");
    }

    // --- A6b: writing through a missing-component get must not poison later misses ---
    // Review finding: the static fallback is shared, so a write through one miss used
    // to corrupt the value returned to the next miss. Reset-on-miss must prevent that.
    {
        Registry r;
        Entity owner = r.create();
        r.emplace<Pos>(owner, Pos{5.0f, 5.0f});  // creates the Pos pool
        Entity a = r.create();
        Entity b = r.create();
        r.get<Pos>(a).x = 999.0f;                // write through a's fallback (a has no Pos)
        CHECK(r.get<Pos>(b).x == 1.0f, "SparseSet::get fallback reset between misses (no pollution)");
        CHECK(r.get<Pos>(owner).x == 5.0f, "real component unaffected by fallback writes");
    }

    // --- A7: re-entrant destroy(entity) from onDestroy must not double-teardown ---
    {
        Registry r;
        Entity e = r.create();
        int calls = 0;
        r.onDestroy([&](Entity ent) {
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

    // --- onDestroyScoped: the RAII Connection auto-unregisters on scope exit ---
    // A system that stores the raw callback id but forgets to removeOnDestroy
    // leaves a dangling `this` in the registry (the ParticleSystem / SpineSystem
    // bug). The scoped variant makes that impossible: the callback is gone once
    // the returned Connection is destroyed. ASAN here would catch a disconnect
    // that reached into freed memory.
    {
        Registry r;
        int hits = 0;
        {
            auto conn = r.onDestroyScoped([&](Entity) { ++hits; });
            Entity e = r.create();
            r.destroy(e);
            CHECK(hits == 1, "scoped onDestroy fires while the Connection is alive");
        }
        // Connection destroyed -> callback unregistered.
        Entity e2 = r.create();
        r.destroy(e2);
        CHECK(hits == 1, "callback no longer fires once the Connection is destroyed");
    }

    // --- ES_VERIFY: emplace / emplaceOrReplace on an invalid entity is release-safe ---
    // Without the guard, component_masks_[Entity{}.index() == 0xFFFFF] is an OOB
    // write (ES_ASSERT is stripped here). The guard must fire and return a fallback.
    {
        esengine::detail::verifyHook() = countingVerifyHook;
        Registry r;

        g_verifyHits = 0;
        Pos& p = r.emplace<Pos>(Entity{}, Pos{7.0f, 8.0f});
        CHECK(g_verifyHits == 1, "emplace(invalid) fires the verify hook");
        CHECK(p.x == 1.0f && p.y == 2.0f, "emplace(invalid) returns fallback defaults (no OOB write)");

        g_verifyHits = 0;
        Pos& p2 = r.emplaceOrReplace<Pos>(Entity{}, Pos{9.0f, 9.0f});
        CHECK(g_verifyHits == 1, "emplaceOrReplace(invalid) fires the verify hook");
        CHECK(p2.x == 1.0f, "emplaceOrReplace(invalid) returns fallback (no OOB write)");

        esengine::detail::verifyHook() = nullptr;
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
