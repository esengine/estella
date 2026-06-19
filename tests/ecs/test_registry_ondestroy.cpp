// Native harness for RC12 B1: Registry::onDestroy via RAII Connection (fixes A12).
//
// Verifies the destroy callback fires, and — the point of the RC — that a
// subscriber and the Registry can tear down in EITHER order without a dangling
// callback. The old code registered a bare `[this]` callback with no removal on
// the subscriber's destruction, so a destroy() after the subscriber was gone
// called into freed memory (A12); and a subscriber outliving the Registry had no
// way to no-op. Both directions are exercised here, under AddressSanitizer:
//
//   clang++ -std=c++20 -fsanitize=address -I src -I third_party/glm \
//     tests/ecs/test_registry_ondestroy.cpp src/esengine/core/Log.cpp \
//     -o /tmp/test_od && /tmp/test_od

#include "esengine/ecs/Registry.hpp"

#include <cstdio>
#include <set>

using esengine::Entity;
using esengine::Connection;
using esengine::u32;
using esengine::ecs::Registry;

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

// Mirrors ParticleSystem/SpineSystem: holds a Connection, mutates its own state
// from the callback (so a stale `this` call is a real use-after-free).
struct FakeSystem {
    std::set<u32> live;
    Connection conn;
    void attach(Registry& r) {
        conn = r.onDestroy([this](Entity e) { live.erase(e.index()); });
    }
};

int main() {
    // 1. Basic: the callback fires on destroy.
    {
        Registry r;
        FakeSystem sys;
        sys.attach(r);
        Entity e = r.create();
        sys.live.insert(e.index());
        r.destroy(e);
        CHECK(sys.live.count(e.index()) == 0, "onDestroy callback fires");
    }

    // 2. System-first teardown (A12 forward): subscriber destroyed before the
    //    Registry. A later destroy() must NOT call the freed subscriber.
    {
        Registry r;
        Entity e = r.create();
        {
            FakeSystem sys;
            sys.attach(r);
            sys.live.insert(e.index());
        }  // sys destroyed here -> Connection disconnects
        r.destroy(e);  // old bug: calls sys's lambda on freed `this` -> UAF
        CHECK(true, "destroy after subscriber gone is safe (ASAN-checked)");
    }

    // 3. Registry-first teardown (A12 reverse): Registry destroyed before the
    //    subscriber. The subscriber's Connection destructor must no-op on the
    //    dead signal (weak alive_ check).
    {
        FakeSystem sys;
        {
            Registry r;
            sys.attach(r);
            (void)r.create();
        }  // r destroyed here -> signal dies
        CHECK(true, "Connection outlives Registry safely");
    }  // sys.conn destructor here -> must not touch the dead signal (ASAN-checked)

    // 4. Re-entrant destroy from a callback (A7 + Signal re-entrancy) still safe.
    {
        Registry r;
        Entity e = r.create();
        int calls = 0;
        Connection conn = r.onDestroy([&](Entity ent) {
            if (calls++ == 0) r.destroy(ent);  // re-entrant destroy of same entity
        });
        r.destroy(e);
        CHECK(r.entityCount() == 0, "re-entrant destroy via signal: no underflow");
    }

    if (g_failures == 0) {
        std::printf("\nALL RC12 B1 TESTS PASSED\n");
        return 0;
    }
    std::printf("\n%d FAILURE(S)\n", g_failures);
    return 1;
}
