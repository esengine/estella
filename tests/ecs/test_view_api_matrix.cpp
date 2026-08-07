/**
 * @file  test_view_api_matrix.cpp — every (arity × entry point × callback shape)
 *        combination of the view API, instantiated.
 *
 * Registry::each/eachLive are variadic, so a member missing from one View
 * specialization is not a compile error until something instantiates that exact
 * combination. Nothing in the engine iterates multiple components through a
 * callback — every hot path uses range-for — so `eachLive<A, B>` type-checked as
 * valid for as long as no caller existed. The instantiations below ARE the guard;
 * the CHECKs then pin what each combination does.
 */
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>

#include <esengine/ESEngine.hpp>
#include <algorithm>
#include <tuple>
#include <vector>

using esengine::Entity;
using esengine::usize;
using esengine::ecs::Registry;

namespace test {

struct A { int v = 0; };
struct B { int v = 0; };
struct C { int v = 0; };

/** Entities carrying every one of Cs, in the order the view walks them. */
template<typename... Cs>
std::vector<Entity> walk(Registry& registry) {
    std::vector<Entity> seen;
    registry.each<Cs...>([&](Entity e, Cs&...) { seen.push_back(e); });
    return seen;
}

/**
 * Instantiates the full grid at one arity: both entry points (Registry, View),
 * both iteration modes (each, eachLive) and all three callback shapes the
 * is_invocable_v ladder claims to accept, plus the shape API a view must offer at
 * every arity for generic code to compile against it.
 */
template<typename... Cs>
usize instantiateGrid(Registry& registry) {
    usize calls = 0;

    registry.each<Cs...>([&](Entity, Cs&...) { ++calls; });
    registry.each<Cs...>([&](Cs&...) { ++calls; });
    registry.each<Cs...>([&](Entity) { ++calls; });
    registry.eachLive<Cs...>([&](Entity, Cs&...) { ++calls; });
    registry.eachLive<Cs...>([&](Cs&...) { ++calls; });
    registry.eachLive<Cs...>([&](Entity) { ++calls; });

    auto view = registry.view<Cs...>();
    view.each([&](Entity, Cs&...) { ++calls; });
    view.each([&](Cs&...) { ++calls; });
    view.each([&](Entity) { ++calls; });
    view.eachLive([&](Entity, Cs&...) { ++calls; });
    view.eachLive([&](Cs&...) { ++calls; });
    view.eachLive([&](Entity) { ++calls; });

    (void)view.empty();
    (void)view.sizeHint();
    for (Entity e : view) {
        std::tuple<Cs&...> all = view.getAll(e);
        (void)all;
        ++calls;
    }
    return calls;
}

}  // namespace test

TEST_CASE("every arity offers the same iteration API") {
    Registry registry;
    Entity abc = registry.create();
    registry.emplace<test::A>(abc);
    registry.emplace<test::B>(abc);
    registry.emplace<test::C>(abc);

    // 13 grid entries, one entity each: 12 callbacks + 1 range-for step.
    CHECK_EQ(test::instantiateGrid<test::A>(registry), 13u);
    CHECK_EQ((test::instantiateGrid<test::A, test::B>(registry)), 13u);
    CHECK_EQ((test::instantiateGrid<test::A, test::B, test::C>(registry)), 13u);
}

TEST_CASE("eachLive visits exactly what each visits, in the same order") {
    Registry registry;
    std::vector<Entity> both;
    for (int i = 0; i < 8; ++i) {
        Entity e = registry.create();
        registry.emplace<test::A>(e, test::A{i});
        // Only every other entity gets B, so the view has to filter.
        if (i % 2 == 0) {
            registry.emplace<test::B>(e, test::B{i});
            both.push_back(e);
        }
    }

    std::vector<Entity> snapshot = test::walk<test::A, test::B>(registry);
    std::vector<Entity> live;
    registry.eachLive<test::A, test::B>([&](Entity e, test::A&, test::B&) { live.push_back(e); });

    CHECK_EQ(snapshot, both);
    CHECK_EQ(live, snapshot);
}

TEST_CASE("eachLive hands out references into the live pools") {
    Registry registry;
    Entity e = registry.create();
    registry.emplace<test::A>(e, test::A{1});
    registry.emplace<test::B>(e, test::B{2});

    registry.eachLive<test::A, test::B>([](test::A& a, test::B& b) {
        a.v += 10;
        b.v += 10;
    });

    CHECK_EQ(registry.get<test::A>(e).v, 11);
    CHECK_EQ(registry.get<test::B>(e).v, 12);
}

TEST_CASE("a view over a component nothing has visits nothing") {
    Registry registry;
    Entity e = registry.create();
    registry.emplace<test::A>(e);

    usize calls = 0;
    registry.eachLive<test::A, test::C>([&](Entity, test::A&, test::C&) { ++calls; });
    registry.each<test::A, test::C>([&](Entity, test::A&, test::C&) { ++calls; });

    CHECK_EQ(calls, 0u);
    CHECK(registry.view<test::A, test::C>().empty());
}

TEST_CASE("the smallest pool drives iteration whichever argument it is") {
    Registry registry;
    Entity shared = registry.create();
    registry.emplace<test::A>(shared);
    registry.emplace<test::B>(shared);
    for (int i = 0; i < 32; ++i) registry.emplace<test::A>(registry.create());

    std::vector<Entity> ab, ba;
    registry.eachLive<test::A, test::B>([&](Entity e, test::A&, test::B&) { ab.push_back(e); });
    registry.eachLive<test::B, test::A>([&](Entity e, test::B&, test::A&) { ba.push_back(e); });

    CHECK_EQ(ab, std::vector<Entity>{shared});
    CHECK_EQ(ba, ab);
}

TEST_CASE("each tolerates a callback that removes the iterated component") {
    Registry registry;
    std::vector<Entity> created;
    for (int i = 0; i < 6; ++i) {
        Entity e = registry.create();
        registry.emplace<test::A>(e, test::A{i});
        registry.emplace<test::B>(e, test::B{i});
        created.push_back(e);
    }

    std::vector<Entity> seen;
    registry.each<test::A, test::B>([&](Entity e, test::A&, test::B&) {
        seen.push_back(e);
        registry.remove<test::A>(e);
    });

    CHECK_EQ(seen, created);
    CHECK(registry.view<test::A, test::B>().empty());
}

TEST_CASE("a single-component view answers the multi-component shape questions") {
    Registry registry;
    Entity e = registry.create();
    registry.emplace<test::A>(e, test::A{7});

    auto view = registry.view<test::A>();
    CHECK_EQ(view.size(), 1u);
    CHECK_EQ(view.sizeHint(), view.size());
    CHECK_EQ(std::get<0>(view.getAll(e)).v, 7);
}
