/**
 * @file    test_reflection_store.cpp
 * @brief   Which column a point reflects, and which probes are refused outright.
 *
 * Header-only, so it runs without a device. A pixel gate says a surface came out
 * the wrong colour; this says whether the lookup took the wrong box, whether a
 * probe past the addressable columns was clamped into someone else's, or whether
 * two bakes were allowed into one frame.
 */

#include "esengine/renderer/store/ReflectionStore.hpp"

#include <cstdio>

using namespace esengine;

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

static void testEmpty() {
    ReflectionStore store;
    CHECK(store.empty(), "a store with no probe is empty");
    CHECK(store.slotAt({0.0f, 0.0f, 0.0f}) == 0, "and answers column 0 — the environment");
    CHECK(store.environment() == 0, "and names no bake");
}

static void testInsideAndOutside() {
    ReflectionStore store;
    CHECK(store.add({-100.0f, -100.0f, -100.0f}, {100.0f, 100.0f, 100.0f}, 1, 7),
          "a box with a column and a bake is taken");
    CHECK(store.count() == 1 && store.environment() == 7, "and is the frame's one bake");
    CHECK(store.slotAt({0.0f, 0.0f, 0.0f}) == 1, "a point inside it reflects its column");
    CHECK(store.slotAt({0.0f, 0.0f, 200.0f}) == 0, "a point outside reflects the environment");
    CHECK(store.slotAt({100.0f, 0.0f, 0.0f}) == 1, "the face of the box is inside it");
}

static void testSmallestWins() {
    ReflectionStore store;
    store.add({-500.0f, -500.0f, -500.0f}, {500.0f, 500.0f, 500.0f}, 1, 7);
    store.add({-50.0f, -50.0f, -50.0f}, {50.0f, 50.0f, 50.0f}, 2, 7);
    CHECK(store.slotAt({0.0f, 0.0f, 0.0f}) == 2,
          "where two boxes overlap the smaller one answers");
    CHECK(store.slotAt({200.0f, 0.0f, 0.0f}) == 1, "and the larger still answers outside it");

    // Declared the other way round: the answer is a fact about the boxes, not
    // about which entity the registry walked first.
    ReflectionStore reversed;
    reversed.add({-50.0f, -50.0f, -50.0f}, {50.0f, 50.0f, 50.0f}, 2, 7);
    reversed.add({-500.0f, -500.0f, -500.0f}, {500.0f, 500.0f, 500.0f}, 1, 7);
    CHECK(reversed.slotAt({0.0f, 0.0f, 0.0f}) == 2, "whichever order they arrive in");
}

static void testRefusals() {
    ReflectionStore store;
    CHECK(!store.add({-1.0f, -1.0f, -1.0f}, {1.0f, 1.0f, 1.0f}, 0, 7),
          "column 0 is the environment's, so a probe claiming it is refused");
    CHECK(!store.add({-1.0f, -1.0f, -1.0f}, {1.0f, 1.0f, 1.0f}, MAX_REFLECTION_PROBES, 7),
          "a column past the last addressable one is refused, not clamped");
    CHECK(!store.add({-1.0f, -1.0f, -1.0f}, {1.0f, 1.0f, 1.0f}, 1, 0),
          "a probe with nothing baked yet is refused");
    CHECK(!store.add({1.0f, 1.0f, 1.0f}, {-1.0f, -1.0f, -1.0f}, 1, 7),
          "a box with no inside is refused");
    CHECK(store.empty(), "so none of them is in the store");
}

static void testOneBakePerFrame() {
    ReflectionStore store;
    CHECK(store.add({-10.0f, -10.0f, -10.0f}, {10.0f, 10.0f, 10.0f}, 1, 7), "the first bake wins");
    // One texture is bound for the frame, so a probe naming another bake would
    // read its column out of the wrong atlas.
    CHECK(!store.add({-10.0f, -10.0f, -10.0f}, {10.0f, 10.0f, 10.0f}, 2, 8),
          "a probe naming a different bake is refused");
    CHECK(store.count() == 1 && store.environment() == 7, "and the frame keeps the first");
}

static void testClearing() {
    ReflectionStore store;
    store.add({-10.0f, -10.0f, -10.0f}, {10.0f, 10.0f, 10.0f}, 1, 7);
    store.clear();
    CHECK(store.empty() && store.environment() == 0 && store.slotAt({0.0f, 0.0f, 0.0f}) == 0,
          "clearing leaves the next frame nothing of this one's");
}

int main() {
    testEmpty();
    testInsideAndOutside();
    testSmallestWins();
    testRefusals();
    testOneBakePerFrame();
    testClearing();
    std::printf(g_failures == 0 ? "\nall reflection claims hold\n" : "\n%d failure(s)\n",
                g_failures);
    return g_failures == 0 ? 0 : 1;
}
