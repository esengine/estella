// What a probe volume answers at a point, without a device. A pixel gate says a
// draw came out wrong; only this says whether the read left the box, took the
// wrong volume, or accepted a grid too short to fill it.

#include "esengine/renderer/store/ProbeStore.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

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

static f32 unpackHalfBits(u16 h) {
    const u32 sign = (h >> 15) & 1u;
    const u32 exponent = (h >> 10) & 31u;
    const u32 mantissa = h & 1023u;
    f32 v;
    if (exponent == 0) v = std::ldexp(static_cast<f32>(mantissa), -24);
    else if (exponent == 31) v = mantissa ? NAN : INFINITY;
    else v = std::ldexp(static_cast<f32>(mantissa | 1024u), static_cast<int>(exponent) - 25);
    return sign ? -v : v;
}

/** One RGBA texel of the atlas, as floats. */
static glm::vec4 atlasTexel(const std::vector<u16>& texels, const ProbeStore& store, i32 x, i32 y, i32 z) {
    const i32 w = static_cast<i32>(store.atlasWidth());
    const i32 h = static_cast<i32>(store.atlasHeight());
    const i32 d = static_cast<i32>(store.atlasDepth());
    x = std::clamp(x, 0, w - 1);
    y = std::clamp(y, 0, h - 1);
    z = std::clamp(z, 0, d - 1);
    const usize at = ((static_cast<usize>(z) * h + y) * w + x) * 4;
    return {unpackHalfBits(texels[at]), unpackHalfBits(texels[at + 1]), unpackHalfBits(texels[at + 2]),
            unpackHalfBits(texels[at + 3])};
}

/** What a linear, clamped 3D sampler returns at normalised @p uvw: the eight texels around it, weighted. */
static glm::vec4 trilinear(const std::vector<u16>& texels, const ProbeStore& store, const glm::vec3& uvw) {
    const glm::vec3 size{static_cast<f32>(store.atlasWidth()), static_cast<f32>(store.atlasHeight()),
                         static_cast<f32>(store.atlasDepth())};
    const glm::vec3 t = uvw * size - 0.5f;
    const glm::vec3 f = glm::floor(t);
    const glm::vec3 w = t - f;
    const glm::ivec3 i{f};
    glm::vec4 sum{0.0f};
    for (int corner = 0; corner < 8; ++corner) {
        const glm::ivec3 o{corner & 1, (corner >> 1) & 1, (corner >> 2) & 1};
        const f32 weight = (o.x ? w.x : 1.0f - w.x) * (o.y ? w.y : 1.0f - w.y) * (o.z ? w.z : 1.0f - w.z);
        sum += atlasTexel(texels, store, i.x + o.x, i.y + o.y, i.z + o.z) * weight;
    }
    return sum;
}

/** The shaders' probeGridIrradiance, line for line, with N picking coefficient @p c alone (its basis weight left out). */
static glm::vec4 shaderRead(const std::vector<u16>& texels, const ProbeStore& store, const ProbeConstants& run,
                            const glm::vec3& P, int c) {
    const glm::vec4 a = run.irradiance[1];
    const glm::vec4 b = run.irradiance[2];
    const glm::vec4 cc = run.irradiance[3];
    const glm::vec4 d = run.irradiance[4];
    const glm::vec3 last{a.w, b.w, cc.w};
    const glm::vec3 g = glm::clamp((P - glm::vec3(a)) * glm::vec3(b), glm::vec3(0.0f), last);
    const glm::vec3 cell = glm::min(glm::floor(g * 0.25f), glm::max(glm::ceil(last * 0.25f) - 1.0f, glm::vec3(0.0f)));
    const glm::ivec3 at{glm::vec3(cc) + cell + 0.5f};
    const glm::vec4 brick = atlasTexel(texels, store, at.x, at.y, at.z);
    const glm::vec3 first = glm::floor(cell / brick.w) * brick.w;
    const glm::vec3 uvw = (glm::vec3(brick) + (g - first * 4.0f) / brick.w + 0.5f) * glm::vec3(d);
    return trilinear(texels, store, uvw + glm::vec3(static_cast<f32>(c) * d.w * d.x, 0.0f, 0.0f));
}

/** A grid whose every coefficient and sky value is a different function of the probe, so a read from the wrong probe,
 *  page or brick shows. */
static ProbeVolume scrambled(const glm::ivec3& resolution, bool sky) {
    ProbeVolume v;
    v.resolution = resolution;
    const u32 probes = resolution.x * resolution.y * resolution.z;
    v.irradiance.resize(static_cast<usize>(probes) * 9);
    if (sky) v.skyVisibility.resize(static_cast<usize>(probes) * 9);
    for (u32 i = 0; i < probes; ++i) {
        for (u32 c = 0; c < 9; ++c) {
            const f32 k = static_cast<f32>(i * 9 + c);
            v.irradiance[i * 9 + c] = {std::fmod(k * 0.37f, 2.0f), std::fmod(k * 0.11f + 0.5f, 1.5f), std::fmod(k * 0.23f, 1.0f)};
            if (sky) v.skyVisibility[i * 9 + c] = std::fmod(k * 0.07f, 1.0f);
        }
    }
    v.revision = ProbeVolume::nextRevision();
    return v;
}

/** The brick atlas a per-pixel read samples: each grid cut into bricks, coefficient c of every brick in page c, the
 *  indirection cells in the last page. A grid two volumes share is placed once, and the layout uploads only on change. */
static void testAtlasLayout() {
    ProbeVolume a = scrambled({2, 1, 3}, true);
    ProbeVolume b = scrambled({9, 2, 1}, false);
    ProbeStore store;
    store.add({-1.0f, -1.0f, -1.0f}, {1.0f, 1.0f, 1.0f}, &a);
    store.add({5.0f, 5.0f, 5.0f}, {6.0f, 6.0f, 6.0f}, &b);
    store.add({-9.0f, -9.0f, -9.0f}, {-8.0f, -8.0f, -8.0f}, &a);

    CHECK(ProbeStore::bricksFor({2, 1, 3}) == glm::ivec3(1, 1, 1), "a grid of two cells a side is one brick");
    CHECK(ProbeStore::bricksFor({9, 2, 1}) == glm::ivec3(2, 1, 1), "eight cells along x are two bricks");
    CHECK(ProbeStore::bricksFor({10, 1, 1}) == glm::ivec3(3, 1, 1), "and nine are three");
    CHECK(store.layoutAtlas(256), "a first layout wants an upload");
    CHECK(store.brickCount() == 3, "three bricks, the shared grid placed once");
    CHECK(store.pageWidth() == 5u && store.atlasWidth() == 50u, "ten pages, each one slot wide");
    CHECK(store.atlasHeight() == 5u && store.atlasDepth() == 15u, "the three slots stacked deep: the fewest texels that hold them");
    CHECK(!store.layoutAtlas(256), "the same grids again want nothing uploaded");
    b.revision = ProbeVolume::nextRevision();
    CHECK(store.layoutAtlas(256), "a grid that changed wants the atlas again");

    std::vector<u16> texels;
    store.fillAtlas(texels);
    CHECK(texels.size() == 50u * 5u * 15u * 4u, "four halves a texel");
    // a's probe (1, 0, 2) is texel (1, 0, 2) of brick 0; coefficient 4 of it sits in page 4.
    const glm::vec4 t = atlasTexel(texels, store, 4 * 5 + 1, 0, 2);
    const glm::vec3 want = a.irradiance[(1 + 2 * 2) * 9 + 4];
    CHECK(near(t.x, want.x, 2e-3f) && near(t.y, want.y, 2e-3f) && near(t.z, want.z, 2e-3f), "a coefficient sits in its page");
    CHECK(near(t.w, a.skyVisibility[(1 + 2 * 2) * 9 + 4], 2e-3f), "the sky's visibility rides alpha");
    // Past a's last probe along x the brick repeats it.
    const glm::vec4 past = atlasTexel(texels, store, 4 * 5 + 4, 0, 2);
    CHECK(near(past.x, want.x, 2e-3f), "texels past the grid's end repeat its last probe");
    // b's second brick (slot 2, ten texels deep) begins at probe 4 and carries probe 8 on its far face.
    const glm::vec4 face = atlasTexel(texels, store, 4, 1, 10);
    const glm::vec3 probe8 = b.irradiance[(8 + 9 * 1) * 9 + 0];
    CHECK(near(face.x, probe8.x, 2e-3f) && near(face.z, probe8.z, 2e-3f), "a brick holds the probes on its far face");
    CHECK(near(atlasTexel(texels, store, 0, 0, 5).w, 0.0f), "a grid without sky occlusion leaves alpha 0");
    // The indirection page: a's one cell, then b's two, stacked down z.
    const glm::vec4 cellA = atlasTexel(texels, store, 9 * 5, 0, 0);
    const glm::vec4 cellB1 = atlasTexel(texels, store, 9 * 5 + 1, 0, 1);
    CHECK(cellA == glm::vec4(0.0f, 0.0f, 0.0f, 1.0f), "a's cell names slot 0, a span of one");
    CHECK(cellB1 == glm::vec4(0.0f, 0.0f, 10.0f, 1.0f), "b's second cell names slot 2");
}

/** The shader's read through indirection and bricks says what the CPU's trilinear read says, everywhere in the box:
 *  across brick faces, at both ends, on flat axes, for grids that do and do not fill their last brick. */
static void testBrickReadMatchesTrilinear() {
    const glm::ivec3 shapes[] = {{1, 1, 1}, {2, 1, 2}, {5, 1, 5}, {7, 3, 10}, {13, 3, 9}, {6, 6, 6}};
    std::vector<ProbeVolume> grids;
    for (const glm::ivec3& r : shapes) grids.push_back(scrambled(r, true));
    ProbeStore store;
    for (usize i = 0; i < grids.size(); ++i) {
        const glm::vec3 lo{static_cast<f32>(i) * 100.0f, 0.0f, 0.0f};
        store.add(lo, lo + glm::vec3(8.0f, 3.0f, 5.0f), &grids[i]);
    }
    store.layoutAtlas(256);
    store.setAtlasTexture(42);
    std::vector<u16> texels;
    store.fillAtlas(texels);

    f32 worst = 0.0f;
    for (usize i = 0; i < grids.size(); ++i) {
        const glm::vec3 lo{static_cast<f32>(i) * 100.0f, 0.0f, 0.0f};
        for (int step = 0; step <= 40; ++step) {
            const f32 t = static_cast<f32>(step) / 40.0f;
            const glm::vec3 P = lo + glm::vec3(8.0f * t, 3.0f * std::fmod(t * 7.0f, 1.0f), 5.0f * std::fmod(t * 3.0f, 1.0f));
            ProbeConstants run{};
            ProbeConstants cpu{};
            store.sample(P, run, true);
            store.sample(P, cpu, false);
            for (int c = 0; c < 9; ++c) {
                const glm::vec4 got = shaderRead(texels, store, run, P, c);
                worst = std::max(worst, glm::length(glm::vec3(got) - glm::vec3(cpu.irradiance[c])));
                const f32 sky = c == 0 ? cpu.reflection.y : cpu.irradiance[c].w;
                worst = std::max(worst, std::fabs(got.w - sky));
            }
        }
    }
    std::printf("      worst brick-read error %.5f\n", worst);
    CHECK(worst < 4e-3f, "the brick read is the trilinear read, to half-float precision");
}

/** Asked per pixel, a volume in the atlas answers where its grid is rather than what it holds; asked per object, or
 *  with no atlas texture, it answers as it always did. */
static void testGridRun() {
    ProbeVolume v = ramp({3, 2, 1}, {1.0f, 0.0f, 0.0f}, {0.0f, 0.0f, 1.0f});
    v.revision = 7;
    ProbeStore store;
    store.add({-4.0f, 0.0f, -1.0f}, {4.0f, 2.0f, 1.0f}, &v);
    store.layoutAtlas(256);

    ProbeConstants out{};
    CHECK(store.sample({0.0f, 1.0f, 0.0f}, out, true), "a point in the box is held");
    CHECK(near(out.irradiance[0].w, 1.0f), "with no atlas texture the read stays per object");

    store.setAtlasTexture(42);
    CHECK(store.sample({0.0f, 1.0f, 0.0f}, out, true), "and with one");
    CHECK(near(out.irradiance[0].w, 2.0f), "the run is marked as a grid");
    CHECK(near(out.irradiance[1].x, -4.0f) && near(out.irradiance[1].w, 2.0f), "the box's min and the last probe along x");
    CHECK(near(out.irradiance[2].x, 2.0f / 8.0f) && near(out.irradiance[2].y, 1.0f / 2.0f), "probes per unit along x and y");
    CHECK(near(out.irradiance[2].z, 0.0f) && near(out.irradiance[3].w, 0.0f), "a flat axis reads one slice");
    CHECK(near(out.irradiance[3].x, 9.0f * 5.0f) && near(out.irradiance[3].z, 0.0f), "the grid's first indirection texel");
    CHECK(near(out.irradiance[4].x, 1.0f / 50.0f) && near(out.irradiance[4].w, 5.0f), "the atlas's inverse width and the page");

    ProbeConstants object{};
    CHECK(store.sample({0.0f, 1.0f, 0.0f}, object, false) && near(object.irradiance[0].w, 1.0f),
          "a draw that cannot read the atlas still gets its nine");
}

/** What a dense grid costs as bricks: the Bistro's 13x3x9 is six bricks of 5^3 texels in ten pages, 7,500 texels
 *  (60 KB of half floats) against the 3,159 its nine tiles took flat. The faces a brick repeats and the bricks its last
 *  probes only partly fill are the price of filtering in hardware and of a grid a sparse bake can leave holes in. */
static void testDenseGridCost() {
    ProbeVolume bistro = scrambled({13, 3, 9}, false);
    ProbeStore store;
    store.add({0.0f, 0.0f, 0.0f}, {12.0f, 2.0f, 8.0f}, &bistro);
    store.layoutAtlas(256);
    const u32 texels = store.atlasWidth() * store.atlasHeight() * store.atlasDepth();
    std::printf("      13x3x9 grid: %u bricks, %ux%ux%u atlas, %u texels\n", store.brickCount(), store.atlasWidth(),
                store.atlasHeight(), store.atlasDepth(), texels);
    CHECK(store.brickCount() == 6u && texels == 7500u, "the Bistro's grid is six bricks in the fewest texels that hold them");
    CHECK(store.atlasBytes() == 7500u * 8u, "and takes 60,000 bytes of GPU memory");
}

/** A field linear in the grid's own coordinates, different per coefficient and channel: a coarse brick holds it
 *  exactly, so any read of a sparse grid that is right is exact, and one that is wrong is not close. */
static glm::vec3 linearField(const glm::vec3& f, int c) {
    return {0.1f * f.x + 0.02f * c, 0.05f * f.y - 0.01f * c + 1.0f, 0.03f * f.z + 0.07f * f.x - 0.5f};
}

/** A 17x9x17 grid (4x2x4 finest-brick cells) as one span-2 brick per 2x2x2 cells, except the first, refined to eight
 *  bricks of span 1. */
/** Measured once and held: a layout change that grows the atlas has to say so here. */
static constexpr unsigned long long SPARSE_ATLAS_BYTES = 110000;

static ProbeVolume sparseGrid(bool sky) {
    ProbeVolume v;
    v.resolution = {17, 9, 17};
    std::vector<glm::ivec4> bricks;
    for (int z = 0; z < 4; z += 2) {
        for (int x = 0; x < 4; x += 2) {
            if (x == 0 && z == 0) {
                for (int dz = 0; dz < 2; ++dz) for (int dy = 0; dy < 2; ++dy) for (int dx = 0; dx < 2; ++dx)
                    bricks.push_back({dx, dy, dz, 1});
            } else {
                bricks.push_back({x, 0, z, 2});
            }
        }
    }
    CHECK(v.setBricks(bricks), "bricks that tile the grid are taken");
    const int side = ProbeVolume::kBrickSide;
    v.irradiance.resize(v.bricks.size() * ProbeVolume::kBrickProbes * 9);
    if (sky) v.skyVisibility.resize(v.irradiance.size());
    for (usize b = 0; b < v.bricks.size(); ++b) {
        const glm::ivec4 k = v.bricks[b];
        for (int t = 0; t < ProbeVolume::kBrickProbes; ++t) {
            const glm::vec3 f{static_cast<f32>(std::min(k.x * 4 + (t % side) * k.w, 16)),
                              static_cast<f32>(std::min(k.y * 4 + ((t / side) % side) * k.w, 8)),
                              static_cast<f32>(std::min(k.z * 4 + (t / (side * side)) * k.w, 16))};
            for (int c = 0; c < 9; ++c) {
                const usize at = (b * ProbeVolume::kBrickProbes + static_cast<usize>(t)) * 9 + static_cast<usize>(c);
                v.irradiance[at] = linearField(f, c);
                if (sky) v.skyVisibility[at] = 0.01f * f.x + 0.02f * f.y + 0.03f * f.z + 0.001f * c;
            }
        }
    }
    v.revision = ProbeVolume::nextRevision();
    return v;
}

/** Bricks that do not tile the grid are refused, and the grid stays dense (and so invalid for these coefficients). */
static void testSparseBricksRefused() {
    ProbeVolume v;
    v.resolution = {17, 9, 17};
    CHECK(v.setBricks({{0, 0, 0, 4}}) && v.sparse(), "one coarse brick may cover the whole grid, reaching past its far side");
    CHECK(!v.setBricks({{0, 0, 0, 4}, {4, 0, 0, 1}}), "a brick past the grid's cells is refused");
    CHECK(!v.setBricks({{1, 0, 0, 2}, {0, 0, 0, 1}}), "a brick not on a multiple of its span is refused");
    CHECK(!v.setBricks({{0, 0, 0, 3}}), "a span that is not a power of two is refused");
    std::vector<glm::ivec4> overlap{{0, 0, 0, 2}, {0, 0, 0, 1}, {2, 0, 0, 2}, {0, 0, 2, 2}, {2, 0, 2, 2}};
    CHECK(!v.setBricks(overlap), "two bricks over one cell are refused");
    std::vector<glm::ivec4> gap{{2, 0, 0, 2}, {0, 0, 2, 2}, {2, 0, 2, 2}};
    CHECK(!v.setBricks(gap), "a cell no brick covers is refused");
    CHECK(!v.sparse(), "and a refused grid is left dense");
}

/** A sparse grid read on the CPU (per object), and through the atlas the way the shaders read it, both give the
 *  field it holds — across a coarse brick, a fine one, and the faces where they meet. */
static void testSparseRead() {
    ProbeVolume grid = sparseGrid(true);
    CHECK(grid.isValid() && grid.probeCount() == 11u * 125u, "eleven bricks of 125 probes");
    ProbeStore store;
    store.add({0.0f, 0.0f, 0.0f}, {16.0f, 8.0f, 16.0f}, &grid);
    store.layoutAtlas(256);
    store.setAtlasTexture(42);
    CHECK(store.brickCount() == 11u, "the atlas holds the grid's own bricks");
    std::printf("      sparse grid: %ux%ux%u atlas, %llu bytes\n", store.atlasWidth(), store.atlasHeight(), store.atlasDepth(),
                static_cast<unsigned long long>(store.atlasBytes()));
    CHECK(store.atlasBytes() == SPARSE_ATLAS_BYTES, "eleven bricks take what eleven slots and the indirection page take");
    // The same 17x9x17 grid dense: thirty-two bricks, every cell at the finest spacing.
    ProbeVolume dense = scrambled({17, 9, 17}, true);
    ProbeStore denseStore;
    denseStore.add({0.0f, 0.0f, 0.0f}, {16.0f, 8.0f, 16.0f}, &dense);
    denseStore.layoutAtlas(256);
    std::printf("      the same grid dense: %u bricks, %llu bytes\n", denseStore.brickCount(),
                static_cast<unsigned long long>(denseStore.atlasBytes()));
    CHECK(denseStore.brickCount() == 32u && store.atlasBytes() * 2 < denseStore.atlasBytes(),
          "and under half what the grid takes dense");
    std::vector<u16> texels;
    store.fillAtlas(texels);

    f32 cpuWorst = 0.0f, gpuWorst = 0.0f;
    for (int i = 0; i <= 64; ++i) {
        const f32 t = static_cast<f32>(i) / 64.0f;
        const glm::vec3 P{16.0f * t, 8.0f * std::fmod(t * 5.0f, 1.0f), 16.0f * std::fmod(t * 3.0f, 1.0f)};
        ProbeConstants cpu{}, run{};
        store.sample(P, cpu, false);
        store.sample(P, run, true);
        for (int c = 0; c < 9; ++c) {
            const glm::vec3 want = linearField(P, c);
            cpuWorst = std::max(cpuWorst, glm::length(glm::vec3(cpu.irradiance[c]) - want));
            const glm::vec4 got = shaderRead(texels, store, run, P, c);
            gpuWorst = std::max(gpuWorst, glm::length(glm::vec3(got) - want));
            const f32 sky = 0.01f * P.x + 0.02f * P.y + 0.03f * P.z + 0.001f * c;
            gpuWorst = std::max(gpuWorst, std::fabs(got.w - sky));
            cpuWorst = std::max(cpuWorst, std::fabs((c == 0 ? cpu.reflection.y : cpu.irradiance[c].w) - sky));
        }
    }
    std::printf("      sparse read: worst CPU error %.6f, worst atlas error %.5f\n", cpuWorst, gpuWorst);
    CHECK(cpuWorst < 1e-4f, "read per object, a sparse grid gives the field it holds");
    CHECK(gpuWorst < 8e-3f, "read through the atlas, it gives the same to half-float precision");
}

/** What the stats read: the draws a frame noted per pixel and per object, cleared with the frame; and an atlas forgotten
 *  (the low quality level releases it) reads per object and is laid out again, as changed, when it is wanted back. */
static void testDrawCountsAndForgottenAtlas() {
    ProbeVolume v = scrambled({5, 5, 5}, false);
    ProbeStore store;
    store.add({0.0f, 0.0f, 0.0f}, {4.0f, 4.0f, 4.0f}, &v);
    CHECK(store.layoutAtlas(256), "a first layout wants an upload");
    store.setAtlasTexture(42);
    store.noteDraw(true);
    store.noteDraw(true);
    store.noteDraw(false);
    CHECK(store.perPixelDraws() == 2u && store.perObjectDraws() == 1u, "each draw is counted where it read");
    CHECK(ProbeStore::kReadsPerLookup == 10u, "a per-pixel lookup is the indirection cell and nine coefficients");

    store.forgetAtlas();
    ProbeConstants out{};
    CHECK(store.sample({2.0f, 2.0f, 2.0f}, out, true) && near(out.irradiance[0].w, 1.0f),
          "with the atlas forgotten, a draw that could read per pixel reads per object");
    CHECK(store.atlasBytes() == 0u && store.atlasTexture() == 0u, "and nothing is held for it");

    store.clear();
    CHECK(store.perPixelDraws() == 0u && store.perObjectDraws() == 0u, "a new frame starts its counts at zero");
    store.add({0.0f, 0.0f, 0.0f}, {4.0f, 4.0f, 4.0f}, &v);
    CHECK(store.layoutAtlas(256), "wanted back, the same grid is laid out again and wants an upload");
    CHECK(store.atlasBytes() > 0u, "and the atlas has a size again");
}

/** A grid the atlas cannot hold keeps the per-object read rather than failing the frame. */
static void testOversizeGridKeepsPerObject() {
    ProbeVolume wide = scrambled({200, 1, 1}, false);
    ProbeVolume fits = scrambled({3, 3, 3}, false);
    ProbeStore store;
    store.add({0.0f, 0.0f, 0.0f}, {10.0f, 1.0f, 1.0f}, &wide);
    store.add({20.0f, 0.0f, 0.0f}, {21.0f, 1.0f, 1.0f}, &fits);
    store.layoutAtlas(256);
    store.setAtlasTexture(42);
    ProbeConstants out{};
    CHECK(store.sample({5.0f, 0.5f, 0.5f}, out, true) && near(out.irradiance[0].w, 1.0f),
          "fifty bricks along x do not fit a page, so that grid is read per object");
    CHECK(store.sample({20.5f, 0.5f, 0.5f}, out, true) && near(out.irradiance[0].w, 2.0f), "while the one that fits is read per pixel");
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
    testBrickReadMatchesTrilinear();
    testGridRun();
    testOversizeGridKeepsPerObject();
    testDenseGridCost();
    testDrawCountsAndForgottenAtlas();
    testSparseBricksRefused();
    testSparseRead();
    testSampleByBox();
    std::printf(g_failures ? "\n%d failure(s)\n" : "\nall probe store claims hold\n",
                g_failures);
    return g_failures ? 1 : 0;
}
