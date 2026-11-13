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

/** The atlas a per-pixel read samples: each grid a block of nine coefficient tiles,
 *  slices stacked down; a coefficient's texel is where the shader will look for it,
 *  and its alpha is the sky the probe sees. A grid two volumes share is one block. */
static void testAtlasLayout() {
    ProbeVolume a = ramp({2, 1, 3}, {1.0f, 0.0f, 0.0f}, {0.0f, 0.0f, 1.0f});
    a.skyVisibility.assign(a.irradiance.size(), 0.25f);
    a.revision = 1;
    ProbeVolume b = ramp({3, 2, 1}, {0.0f, 1.0f, 0.0f}, {0.0f, 1.0f, 0.0f});
    b.revision = 2;
    ProbeStore store;
    store.add({-1.0f, -1.0f, -1.0f}, {1.0f, 1.0f, 1.0f}, &a);
    store.add({5.0f, 5.0f, 5.0f}, {6.0f, 6.0f, 6.0f}, &b);
    store.add({-9.0f, -9.0f, -9.0f}, {-8.0f, -8.0f, -8.0f}, &a);

    CHECK(store.layoutAtlas(2048), "a first layout wants an upload");
    CHECK(store.atlasWidth() == 27, "the widest block is nine tiles of three");
    CHECK(store.atlasHeight() == 3 + 2, "two blocks, the shared grid placed once");
    CHECK(!store.layoutAtlas(2048), "the same grids again want nothing uploaded");
    b.revision = 3;
    CHECK(store.layoutAtlas(2048), "a grid that changed wants the atlas again");

    std::vector<u16> texels;
    store.fillAtlas(texels);
    CHECK(texels.size() == 27u * 5u * 4u, "four halves a texel");
    // a's last probe (x 1, z 2) is its ramp's end, blue; its coefficient 0 is tile 0, row z*resY + y = 2.
    const usize last = (2u * 27u + 1u) * 4u;
    CHECK(texels[last + 2] == packHalf(1.0f) && texels[last + 0] == packHalf(0.0f), "a coefficient sits where the shader reads it");
    CHECK(texels[last + 3] == packHalf(0.25f), "the sky's visibility rides alpha");
    // b sits below a: row 3, its constant green.
    CHECK(texels[(3u * 27u) * 4u + 1] == packHalf(1.0f), "the second block starts under the first");
    CHECK(texels[(3u * 27u) * 4u + 3] == packHalf(0.0f), "a grid without sky occlusion leaves alpha 0");
}

/** Asked per pixel, a volume in the atlas answers where its grid is rather than what
 *  it holds; asked per object, or with no atlas texture, it answers as it always did. */
static void testGridRun() {
    ProbeVolume v = ramp({3, 2, 1}, {1.0f, 0.0f, 0.0f}, {0.0f, 0.0f, 1.0f});
    v.revision = 7;
    ProbeStore store;
    store.add({-4.0f, 0.0f, -1.0f}, {4.0f, 2.0f, 1.0f}, &v);
    store.layoutAtlas(2048);

    ProbeConstants out{};
    CHECK(store.sample({0.0f, 1.0f, 0.0f}, out, true), "a point in the box is held");
    CHECK(near(out.irradiance[0].w, 1.0f), "with no atlas texture the read stays per object");

    store.setAtlasTexture(42);
    CHECK(store.sample({0.0f, 1.0f, 0.0f}, out, true), "and with one");
    CHECK(near(out.irradiance[0].w, 2.0f), "the run is marked as a grid");
    CHECK(near(out.irradiance[1].x, -4.0f) && near(out.irradiance[1].w, 3.0f), "the box's min and resX");
    CHECK(near(out.irradiance[2].x, 2.0f / 8.0f) && near(out.irradiance[2].y, 1.0f / 2.0f), "probes per unit along x and y");
    CHECK(near(out.irradiance[2].z, 0.0f), "a flat axis reads one slice");
    CHECK(near(out.irradiance[3].z, 1.0f / 27.0f) && near(out.irradiance[3].w, 1.0f / 2.0f), "the atlas's inverse size");
    CHECK(near(out.irradiance[4].x, 1.0f), "resZ");

    ProbeConstants object{};
    CHECK(store.sample({0.0f, 1.0f, 0.0f}, object, false) && near(object.irradiance[0].w, 1.0f),
          "a draw that cannot read the atlas still gets its nine");
}

/** An object is held by the volume its box is in, not the one its origin is in: a level's mesh whose origin is the
 *  world's centre still reads the room it draws. The centre wins when it is inside; otherwise the smallest overlap. */
static void testSampleByBox() {
    ProbeVolume room = ramp({1, 1, 1}, {3.0f, 0.0f, 0.0f}, {3.0f, 0.0f, 0.0f});
    ProbeVolume hall = ramp({1, 1, 1}, {7.0f, 0.0f, 0.0f}, {7.0f, 0.0f, 0.0f});
    ProbeStore store;
    store.add({10.0f, 0.0f, 10.0f}, {20.0f, 5.0f, 20.0f}, &room);
    store.add({0.0f, 0.0f, 0.0f}, {40.0f, 10.0f, 40.0f}, &hall);

    ProbeConstants out{};
    CHECK(!store.sample({-5.0f, 0.0f, -5.0f}, out), "the origin is in no volume");
    CHECK(store.sampleBox({15.0f, 2.0f, 15.0f}, {20.0f, 3.0f, 20.0f}, out) && near(out.irradiance[0].x, 3.0f),
          "a box whose centre is in the room reads the room");
    CHECK(store.sampleBox({-2.0f, 2.0f, -2.0f}, {4.0f, 3.0f, 4.0f}, out) && near(out.irradiance[0].x, 7.0f),
          "a box whose centre is outside reads the volume it overlaps");
    CHECK(!store.sampleBox({-50.0f, 0.0f, -50.0f}, {1.0f, 1.0f, 1.0f}, out), "and one touching nothing reads nothing");
}

/** The store is rebuilt every frame: its revision says whether this frame's volumes are the last frame's. */
static void testRevision() {
    ProbeVolume v = ramp({1, 1, 1}, {1.0f, 0.0f, 0.0f}, {1.0f, 0.0f, 0.0f});
    v.revision = ProbeVolume::nextRevision();
    ProbeStore store;
    store.add({-1.0f, -1.0f, -1.0f}, {1.0f, 1.0f, 1.0f}, &v);
    const u64 first = store.revision();
    CHECK(first != 0 && store.revision() == first, "a frame's volumes have a revision, asked as often as one likes");
    store.clear();
    store.add({-1.0f, -1.0f, -1.0f}, {1.0f, 1.0f, 1.0f}, &v);
    CHECK(store.revision() == first, "the same volumes the next frame keep it");
    v.revision = ProbeVolume::nextRevision();
    CHECK(store.revision() != first, "a grid given new coefficients moves it");
    const u64 regrid = store.revision();
    store.clear();
    store.add({-2.0f, -1.0f, -1.0f}, {1.0f, 1.0f, 1.0f}, &v);
    CHECK(store.revision() != regrid, "a volume that moved moves it");
    const u64 moved = store.revision();
    store.clear();
    CHECK(store.revision() != moved, "and so does no volume at all");
}

int main() {
    testRevision();
    testInsideAndOutside();
    testTrilinearOnEachAxis();
    testSmallestVolumeWins();
    testMalformedGridsRefused();
    testAtlasLayout();
    testGridRun();
    testSampleByBox();
    std::printf(g_failures ? "\n%d failure(s)\n" : "\nall probe store claims hold\n",
                g_failures);
    return g_failures ? 1 : 0;
}
