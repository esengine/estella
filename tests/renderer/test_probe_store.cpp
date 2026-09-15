// What a probe volume answers at a point, without a device. A pixel gate says a
// draw came out wrong; only this says whether the read left the box, took the
// wrong volume, or accepted a grid too short to fill it.

#include "esengine/renderer/store/ProbeStore.hpp"

#include <cmath>
#include <cstdio>

using namespace esengine;

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

static bool near(f32 a, f32 b, f32 eps = 1e-4f) { return std::fabs(a - b) < eps; }

/** A grid whose FIRST coefficient runs from `a` to `b` along one axis. */
static ProbeVolume ramp(const glm::ivec3& resolution, const glm::vec3& a, const glm::vec3& b) {
    ProbeVolume v;
    v.resolution = resolution;
    const u32 probes = resolution.x * resolution.y * resolution.z;
    v.irradiance.assign(static_cast<usize>(probes) * 9, glm::vec3(0.0f));
    for (u32 i = 0; i < probes; ++i) {
        const f32 t = probes > 1 ? static_cast<f32>(i) / static_cast<f32>(probes - 1) : 0.0f;
        v.irradiance[static_cast<usize>(i) * 9] = a + (b - a) * t;
    }
    return v;
}

/** A point inside a one-probe volume reads that probe, and a point outside reads
 *  nothing at all — which is not the same as reading a probe that happens to be
 *  black, and is the distinction a pixel cannot draw. */
static void testInsideAndOutside() {
    ProbeVolume v = ramp({1, 1, 1}, {2.0f, 0.0f, 0.0f}, {2.0f, 0.0f, 0.0f});
    ProbeStore store;
    store.add({-10.0f, -10.0f, -10.0f}, {10.0f, 10.0f, 10.0f}, &v);

    ProbeConstants out{};
    CHECK(store.sample({0.0f, 0.0f, 0.0f}, out), "a point in the box is held by it");
    CHECK(near(out.irradiance[0].x, 2.0f), "one probe is a constant field");
    CHECK(near(out.irradiance[0].w, 1.0f), "the flag says a volume answered");

    ProbeConstants outside{};
    CHECK(!store.sample({11.0f, 0.0f, 0.0f}, outside), "a point past the box is held by nothing");
    CHECK(near(outside.irradiance[0].w, 0.0f), "and nothing was written into the block");
}

/** The corners carry the ends, so a read at either end is exactly that probe and
 *  a read between them is a mixture — never the nearer of the two. */
static void testTrilinearOnEachAxis() {
    const glm::vec3 lo{1.0f, 0.0f, 0.0f};
    const glm::vec3 hi{0.0f, 0.0f, 1.0f};
    const struct { glm::ivec3 res; int axis; } cases[] = {
        {{2, 1, 1}, 0}, {{1, 2, 1}, 1}, {{1, 1, 2}, 2},
    };
    for (const auto& c : cases) {
        ProbeVolume v = ramp(c.res, lo, hi);
        ProbeStore store;
        store.add({-100.0f, -100.0f, -100.0f}, {100.0f, 100.0f, 100.0f}, &v);

        glm::vec3 at{0.0f};
        ProbeConstants out{};
        at[c.axis] = -100.0f;
        CHECK(store.sample(at, out) && near(out.irradiance[0].x, 1.0f)
              && near(out.irradiance[0].z, 0.0f), "the low corner reads the first probe");
        at[c.axis] = 100.0f;
        CHECK(store.sample(at, out) && near(out.irradiance[0].x, 0.0f)
              && near(out.irradiance[0].z, 1.0f), "the high corner reads the last probe");
        at[c.axis] = 0.0f;
        CHECK(store.sample(at, out) && near(out.irradiance[0].x, 0.5f)
              && near(out.irradiance[0].z, 0.5f), "halfway reads half of each");
    }
}

/** A room baked inside a hall was baked to say something the hall's spacing could
 *  not, so where both hold a point the smaller one answers. */
static void testSmallestVolumeWins() {
    ProbeVolume hall = ramp({1, 1, 1}, {1.0f, 0.0f, 0.0f}, {1.0f, 0.0f, 0.0f});
    ProbeVolume room = ramp({1, 1, 1}, {0.0f, 0.0f, 1.0f}, {0.0f, 0.0f, 1.0f});
    ProbeStore store;
    store.add({-100.0f, -100.0f, -100.0f}, {100.0f, 100.0f, 100.0f}, &hall);
    store.add({-10.0f, -10.0f, -10.0f}, {10.0f, 10.0f, 10.0f}, &room);

    ProbeConstants out{};
    CHECK(store.sample({0.0f, 0.0f, 0.0f}, out) && near(out.irradiance[0].z, 1.0f),
          "inside both, the smaller volume answers");
    CHECK(store.sample({50.0f, 0.0f, 0.0f}, out) && near(out.irradiance[0].x, 1.0f),
          "outside the smaller one, the larger still does");

    // Order must not decide it: the same two added the other way round agree.
    ProbeStore reversed;
    reversed.add({-10.0f, -10.0f, -10.0f}, {10.0f, 10.0f, 10.0f}, &room);
    reversed.add({-100.0f, -100.0f, -100.0f}, {100.0f, 100.0f, 100.0f}, &hall);
    CHECK(reversed.sample({0.0f, 0.0f, 0.0f}, out) && near(out.irradiance[0].z, 1.0f),
          "and the order they were collected in does not change that");
}

/** A grid that cannot be read is refused whole. Half a volume would light part of
 *  a room and read past its own coefficients for the rest. */
static void testMalformedGridsRefused() {
    ProbeStore store;
    ProbeVolume shortOfCoefficients;
    shortOfCoefficients.resolution = {2, 2, 2};
    shortOfCoefficients.irradiance.assign(9, glm::vec3(0.0f));  // one probe's worth of eight
    store.add({-1.0f, -1.0f, -1.0f}, {1.0f, 1.0f, 1.0f}, &shortOfCoefficients);
    CHECK(store.empty(), "a grid short of coefficients is not taken");

    ProbeVolume fine = ramp({1, 1, 1}, {1.0f, 1.0f, 1.0f}, {1.0f, 1.0f, 1.0f});
    store.add({1.0f, -1.0f, -1.0f}, {-1.0f, 1.0f, 1.0f}, &fine);
    CHECK(store.empty(), "a box with no inside is not taken either");
    store.add({-1.0f, -1.0f, -1.0f}, {1.0f, 1.0f, 1.0f}, nullptr);
    CHECK(store.empty(), "and neither is a volume with no grid");

    store.add({-1.0f, -1.0f, -1.0f}, {1.0f, 1.0f, 1.0f}, &fine);
    CHECK(store.count() == 1, "the one that can be read is");
}

int main() {
    testInsideAndOutside();
    testTrilinearOnEachAxis();
    testSmallestVolumeWins();
    testMalformedGridsRefused();
    std::printf(g_failures ? "\n%d failure(s)\n" : "\nall probe store claims hold\n",
                g_failures);
    return g_failures ? 1 : 0;
}
