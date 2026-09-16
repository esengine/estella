/**
 * @file    test_occlusion_view.cpp
 * @brief   What an occluder hides and — the half that matters — what it must not.
 *
 * A pixel gate says a frame drew too much; only this says whether the coverage,
 * the depth order, the orientation or the near plane is what broke. Every claim
 * runs against BOTH depth conventions the engine's matrices arrive in (the SDK
 * builds GL clip volumes, glm here is compiled zero-to-one), because nothing in
 * OcclusionView may read a depth as anything but "farther than" another.
 */

#include "esengine/renderer/frame/OcclusionView.hpp"

#include <glm/gtc/matrix_transform.hpp>

#include <cmath>
#include <cstdio>

using namespace esengine;

static int g_failures = 0;
static const char* g_convention = "";
#define CHECK(cond, msg)                                                          \
    do {                                                                          \
        if (!(cond)) { std::printf("FAIL: [%s] %s\n", g_convention, msg); ++g_failures; } \
        else { std::printf("ok:   [%s] %s\n", g_convention, msg); }               \
    } while (0)

/** A camera at the origin looking down -Z, which is what every scene here means. */
static glm::mat4 view() {
    return glm::lookAt(glm::vec3(0.0f), glm::vec3(0.0f, 0.0f, -1.0f), glm::vec3(0.0f, 1.0f, 0.0f));
}

/** glm's own projection — zero-to-one here, since that is how it is compiled. */
static glm::mat4 zeroToOneVP() {
    return glm::perspective(glm::radians(60.0f), 1.0f, 1.0f, 10000.0f) * view();
}

/**
 * The projection the SDK ships (sdk/src/math/mat4.ts), cell for cell: near maps
 * to -1. Written out rather than taken from glm because glm is compiled the other
 * way here, and the convention IS what this pair of runs is about.
 */
static glm::mat4 glVP() {
    const f32 f = 1.0f / std::tan(glm::radians(60.0f) * 0.5f);
    const f32 near = 1.0f, far = 10000.0f;
    const f32 nf = near - far;
    glm::mat4 p(0.0f);
    p[0][0] = f;
    p[1][1] = f;
    p[2][2] = (far + near) / nf;
    p[2][3] = -1.0f;
    p[3][2] = (2.0f * far * near) / nf;
    return p * view();
}

static constexpr glm::quat kNoTurn(1.0f, 0.0f, 0.0f, 0.0f);

/** A wall 100 wide and 200 tall, 100 in front of the eye: it fills the screen
 *  vertically and a little over half of it across. */
static void addWall(OcclusionView& v) {
    CHECK(v.addBox({0.0f, 0.0f, -100.0f}, kNoTurn, {30.0f, 60.0f, 5.0f}), "the wall is taken");
}

static void testNothingDeclared(const glm::mat4& vp) {
    OcclusionView v;
    v.begin(vp);
    v.finish();
    CHECK(v.empty(), "a view with no occluder blocks nothing");
    CHECK(!v.hidden({0.0f, 0.0f, -300.0f}, {20.0f, 20.0f, 20.0f}),
          "and hides nothing standing in front of the camera");
}

static void testBehindAndBeside(const glm::mat4& vp) {
    OcclusionView v;
    v.begin(vp);
    addWall(v);
    v.finish();
    CHECK(v.boxes() == 1, "one declared box is one taken box");

    CHECK(v.hidden({0.0f, 0.0f, -300.0f}, {20.0f, 20.0f, 20.0f}),
          "what stands squarely behind the wall is hidden");
    CHECK(!v.hidden({150.0f, 0.0f, -300.0f}, {10.0f, 10.0f, 10.0f}),
          "what stands beside it is drawn");
    // Overlapping the wall's edge: part of it is blocked and part is not, and a
    // cull that answers for the majority is a cull that removes what can be seen.
    CHECK(!v.hidden({100.0f, 0.0f, -300.0f}, {20.0f, 20.0f, 20.0f}),
          "what straddles its edge is drawn");
}

static void testDepthOrder(const glm::mat4& vp) {
    OcclusionView v;
    v.begin(vp);
    addWall(v);
    v.finish();
    // The same footprint as the hidden one, on the near side. Only the depth
    // separates them, which is the whole difference between a cull and a mask.
    CHECK(!v.hidden({0.0f, 0.0f, -60.0f}, {5.0f, 5.0f, 5.0f}),
          "what stands in FRONT of the wall is drawn");
    CHECK(!v.hidden({0.0f, 0.0f, -100.0f}, {30.0f, 60.0f, 5.0f}),
          "the wall does not hide itself");
}

/** Which face of a solid box is the one that blocks: the NEAR one. Everything
 *  past it is either inside the wall or behind it, and neither is seen. */
static void testBlockedAtTheNearFace(const glm::mat4& vp) {
    OcclusionView v;
    v.begin(vp);
    // Thick: forty units of wall between its two faces, which is where the two
    // answers differ and the only place they can be told apart.
    v.addBox({0.0f, 0.0f, -100.0f}, kNoTurn, {30.0f, 60.0f, 20.0f});
    v.finish();
    CHECK(v.hidden({0.0f, 0.0f, -100.0f}, {2.0f, 2.0f, 2.0f}),
          "what stands inside the wall's own thickness is hidden");
    CHECK(!v.hidden({0.0f, 0.0f, -75.0f}, {2.0f, 2.0f, 2.0f}),
          "what stands just in front of its near face is drawn");
}

static void testTooSmallToHide(const glm::mat4& vp) {
    OcclusionView v;
    v.begin(vp);
    // Two units across at a hundred out: less than a texel of the grid, so it
    // covers no texel WHOLE and may claim none.
    v.addBox({0.0f, 0.0f, -100.0f}, kNoTurn, {1.0f, 1.0f, 1.0f});
    v.finish();
    CHECK(!v.hidden({0.0f, 0.0f, -300.0f}, {2.0f, 2.0f, 2.0f}),
          "an occluder finer than the grid hides nothing");
}

/** The world x that lands at @p ndc across, seen from @p depth away. */
static f32 worldX(f32 ndc, f32 depth) {
    return ndc * std::tan(glm::radians(30.0f)) * depth;
}

/**
 * The half-texel every claim here is built on: a texel the occluder covers only
 * PART of stays open. Written against the grid's own grain rather than a round
 * number, because the defect it guards is exactly one texel wide — an object
 * standing just past a wall's edge, inside the texel that edge runs through.
 */
static void testPartlyCoveredTexelStaysOpen(const glm::mat4& vp) {
    const f32 texel = 2.0f / static_cast<f32>(OcclusionView::kSize);
    // A wall filling everything left of a line 60% of the way through one texel.
    // Thin, so the silhouette is the near face and the edge lands where it is put.
    const f32 edge = worldX(0.6f * texel, 99.5f);
    OcclusionView v;
    v.begin(vp);
    CHECK(v.addBox({(edge - 4000.0f) * 0.5f, 0.0f, -100.0f}, kNoTurn,
                   {(edge + 4000.0f) * 0.5f, 4000.0f, 0.5f}),
          "the half-covering wall is taken");
    v.finish();

    // Past the wall's edge but not past the texel it runs through. A raster that
    // claimed the whole texel would make this vanish standing in the open.
    const f32 beyond = worldX(0.8f * texel, 300.0f);
    const f32 sliver = worldX(0.1f * texel, 300.0f);
    CHECK(!v.hidden({beyond, 0.0f, -300.0f}, {sliver, sliver, sliver}),
          "an object just past a wall's edge, inside the same texel, is drawn");
    // Two texels in, where the coverage is whole whichever way the rim is read.
    CHECK(v.hidden({worldX(-2.0f * texel, 300.0f), 0.0f, -300.0f}, {sliver, sliver, sliver}),
          "and the same object well behind the wall is not");
}

static void testTurnedIsNotItsBoundingBox(const glm::mat4& vp) {
    OcclusionView v;
    v.begin(vp);
    // A wall turned 45 degrees: a diamond on screen, reaching 70 out along each
    // axis and only 35 along the diagonal. Its bounding box claims the whole 70
    // square — the corners the wall does not fill.
    const glm::quat turn = glm::angleAxis(glm::radians(45.0f), glm::vec3(0.0f, 0.0f, 1.0f));
    CHECK(v.addBox({0.0f, 0.0f, -200.0f}, turn, {50.0f, 50.0f, 5.0f}), "the turned wall is taken");
    v.finish();
    CHECK(v.hidden({0.0f, 0.0f, -400.0f}, {10.0f, 10.0f, 10.0f}),
          "a turned wall still hides what is behind its middle");
    // Twice the diamond's diagonal reach and well inside its bounding box — the
    // one place the two answers differ, so it is the only place worth asking.
    CHECK(!v.hidden({110.0f, 110.0f, -400.0f}, {10.0f, 10.0f, 10.0f}),
          "but not what is behind a corner its bounding box would have claimed");
}

static void testEyeInsideAndNearPlane(const glm::mat4& vp) {
    OcclusionView v;
    v.begin(vp);
    // A box the camera stands inside would call every ray blocked — including the
    // rays reaching what is in front of the player.
    CHECK(!v.addBox({0.0f, 0.0f, 0.0f}, kNoTurn, {50.0f, 50.0f, 50.0f}),
          "a box the eye is inside is refused");
    CHECK(!v.addBox({0.0f, 0.0f, -100.0f}, kNoTurn, {50.0f, 50.0f, 200.0f}),
          "a box reaching behind the eye is refused");
    v.finish();
    CHECK(v.empty(), "a view left with no taken box blocks nothing");
    CHECK(!v.hidden({0.0f, 0.0f, -300.0f}, {20.0f, 20.0f, 20.0f}),
          "so everything in front of the camera is drawn");
}

static void testOrderDoesNotMatter(const glm::mat4& vp) {
    // Two walls, one nearer and one farther, declared each way round. Combining
    // them keeps the NEAREST, which no iteration order may change.
    const glm::vec3 nearWall(0.0f, 0.0f, -100.0f), farWall(0.0f, 0.0f, -200.0f);
    OcclusionView a, b;
    a.begin(vp);
    a.addBox(nearWall, kNoTurn, {30.0f, 60.0f, 5.0f});
    a.addBox(farWall, kNoTurn, {60.0f, 120.0f, 5.0f});
    a.finish();
    b.begin(vp);
    b.addBox(farWall, kNoTurn, {60.0f, 120.0f, 5.0f});
    b.addBox(nearWall, kNoTurn, {30.0f, 60.0f, 5.0f});
    b.finish();

    const glm::vec3 between(0.0f, 0.0f, -150.0f), behind(0.0f, 0.0f, -300.0f);
    const glm::vec3 half(10.0f);
    CHECK(a.hidden(between, half) == b.hidden(between, half)
          && a.hidden(behind, half) == b.hidden(behind, half),
          "the order the boxes arrive in changes no answer");
    CHECK(a.hidden(between, half), "the nearer wall hides what stands between them");
}

static void testReopening(const glm::mat4& vp) {
    OcclusionView v;
    v.begin(vp);
    addWall(v);
    v.finish();
    CHECK(v.hidden({0.0f, 0.0f, -300.0f}, {20.0f, 20.0f, 20.0f}), "hidden while the wall stands");
    // The next camera of the same frame: the grid is this view's, and a wall left
    // over from the last one would hide what this one can see.
    v.begin(vp);
    v.finish();
    CHECK(v.empty() && !v.hidden({0.0f, 0.0f, -300.0f}, {20.0f, 20.0f, 20.0f}),
          "and drawn again for the next view, which declared none");
}

static void runAll(const char* name, const glm::mat4& vp) {
    g_convention = name;
    testNothingDeclared(vp);
    testBehindAndBeside(vp);
    testDepthOrder(vp);
    testBlockedAtTheNearFace(vp);
    testTooSmallToHide(vp);
    testPartlyCoveredTexelStaysOpen(vp);
    testTurnedIsNotItsBoundingBox(vp);
    testEyeInsideAndNearPlane(vp);
    testOrderDoesNotMatter(vp);
    testReopening(vp);
}

int main() {
    runAll("gl", glVP());
    runAll("zero-to-one", zeroToOneVP());
    std::printf(g_failures == 0 ? "\nall occlusion claims hold\n" : "\n%d failure(s)\n", g_failures);
    return g_failures == 0 ? 0 : 1;
}
