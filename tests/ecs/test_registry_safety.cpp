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

        // Old bug: idx pushed onto recycled_ twice -> two creates alias one index.
        Entity a = r.create();
        Entity b = r.create();
        CHECK(a.index() != b.index(), "indices not aliased after re-entrant destroy (no double-recycle)");
        CHECK(r.valid(a) && r.valid(b), "both recreated entities are valid");
    }

    if (g_failures == 0) {
        std::printf("\nALL ECS SAFETY TESTS PASSED\n");
        return 0;
    }
    std::printf("\n%d FAILURE(S)\n", g_failures);
    return 1;
}
