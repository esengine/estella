// Change stamps on the ECS: every component carries the tick of its last write, a reader asks what changed since it last
// looked, and the audit finds a write that left no stamp. Header-only against Registry.hpp, like test_registry_safety.

#include "esengine/ecs/Registry.hpp"

#include <cstdio>
#include <string>

using esengine::Entity;
using esengine::u32;
using esengine::ecs::Registry;
using esengine::ecs::tickAfter;

namespace {
struct Pos { float x = 1.0f; float y = 2.0f; };
struct Rank { int value = 0; };
struct Named { std::string name; };  // neither trivially copyable nor comparable: the audit cannot check it
struct Listed {                      // not trivially copyable, but says what equal is: checked by value
    std::vector<int> values;
    bool operator==(const Listed&) const = default;
};
}

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

int main() {
    // --- A write is seen once, by the reader that looked before it ---
    {
        Registry r;
        const u32 start = r.beginChangeRead();
        const Entity a = r.create();
        r.emplace<Pos>(a);
        CHECK(r.changedSince<Pos>(a, start), "an added component reads as changed since a look before it");
        CHECK(r.anyChangedSince<Pos>(start), "and the pool says something changed");

        const u32 seen = r.beginChangeRead();
        CHECK(!r.changedSince<Pos>(a, seen), "a look after the add sees nothing new");
        CHECK(!r.anyChangedSince<Pos>(seen), "nor does the pool");

        r.get<Pos>(a).x = 5.0f;
        CHECK(!r.changedSince<Pos>(a, seen), "get<T>() announces nothing");

        r.patch<Pos>(a).x = 6.0f;
        CHECK(r.changedSince<Pos>(a, seen), "patch<T>() stamps the write");
        CHECK(r.anyChangedSince<Pos>(seen), "and lifts the pool's last change");

        const u32 again = r.beginChangeRead();
        r.get<Pos>(a).y = 3.0f;
        r.markChanged<Pos>(a);
        CHECK(r.changedSince<Pos>(a, again), "markChanged<T>() says a write made through a held reference");

        const u32 before = r.beginChangeRead();
        r.remove<Pos>(a);
        CHECK(r.anyChangedSince<Pos>(before), "a remove reads as a change of the pool");
        CHECK(!r.changedSince<Pos>(a, before), "while the entity has no stamp left to ask");

        const u32 later = r.beginChangeRead();
        r.emplaceOrReplace<Pos>(a);
        r.emplaceOrReplace<Pos>(a);
        CHECK(r.changedSince<Pos>(a, later), "a replace stamps");
    }

    // --- A stamp moves with its component ---
    {
        Registry r;
        const Entity a = r.create(), b = r.create(), c = r.create();
        r.emplace<Rank>(a, Rank{3});
        r.emplace<Rank>(b, Rank{1});
        r.emplace<Rank>(c, Rank{2});
        const u32 seen = r.beginChangeRead();
        r.patch<Rank>(c);  // only c is written after the look

        r.remove<Rank>(a);  // swap-and-pop puts c where a was
        CHECK(r.changedSince<Rank>(c, seen), "a swap-and-pop keeps the moved component's stamp with it");
        CHECK(!r.changedSince<Rank>(b, seen), "and leaves the others' alone");

        r.emplace<Rank>(a, Rank{0});
        const u32 sorted = r.beginChangeRead();
        r.patch<Rank>(b);
        r.sort<Rank>([](const Rank& x, const Rank& y) { return x.value < y.value; });
        CHECK(r.changedSince<Rank>(b, sorted) && !r.changedSince<Rank>(c, sorted) && !r.changedSince<Rank>(a, sorted),
              "sort carries every stamp to where its component went");
        CHECK(r.get<Rank>(a).value == 0 && r.get<Rank>(b).value == 1 && r.get<Rank>(c).value == 2, "and sorts");
    }

    // --- The tick wraps without an old stamp reading as new ---
    {
        CHECK(tickAfter(1u, 0xFFFFFFF0u), "a stamp after a wrap is later than one before it");
        CHECK(!tickAfter(0xFFFFFFF0u, 1u), "and not the other way round");
    }

    // --- The audit finds writes that left no stamp, and only those ---
    {
        Registry r;
        const Entity a = r.create(), b = r.create();
        r.emplace<Pos>(a);
        r.emplace<Pos>(b);
        r.emplace<Named>(a);
        r.emplace<Listed>(b);
        r.setChangeAudit(true);

        CHECK(r.auditChanges() == 0, "nothing written, nothing found");

        r.get<Pos>(a).x = 9.0f;
        CHECK(r.auditChanges() == 1, "a write through get<T>() with no stamp is found");

        r.patch<Pos>(a).x = 10.0f;
        r.get<Pos>(b).x = 11.0f;
        r.markChanged<Pos>(b);
        CHECK(r.auditChanges() == 0, "writes through patch or followed by markChanged are not");

        r.get<Named>(a).name = "changed";
        CHECK(r.auditChanges() == 0, "a component neither trivially copyable nor comparable is not checked (and is named as such)");

        r.get<Listed>(b).values.push_back(1);
        CHECK(r.auditChanges() == 1, "one that says what equal is is checked by value");
        r.patch<Listed>(b).values.push_back(2);
        CHECK(r.auditChanges() == 0, "and a stamped write of it is not reported");

        r.remove<Pos>(b);
        const Entity c = r.create();
        r.emplace<Pos>(c);
        CHECK(r.auditChanges() == 0, "adds and removes are not unstamped writes");

        r.get<Pos>(c).y = 4.0f;
        r.get<Pos>(a).y = 4.0f;
        CHECK(r.auditChanges() == 2 && r.changeAuditTotal() == 4, "every unstamped write is counted");

        r.setChangeAudit(false);
        r.get<Pos>(a).x = 1.0f;
        CHECK(r.auditChanges() == 0, "and nothing is checked while it is off");
    }

    // --- The audit names a type as the code spells it ---
    {
        const std::string_view name = esengine::ecs::componentTypeName<Pos>();
        CHECK(name == "Pos", "componentTypeName drops the namespace");
    }

    std::printf(g_failures ? "\n%d FAILURE(S)\n" : "\nall passed\n", g_failures);
    return g_failures ? 1 : 0;
}
