// The arithmetic behind LODGroup, held against its own claims without a device:
// a projection, a sphere and the level last shown are the whole input. A pixel
// gate can say the wrong level was drawn; only this can say which claim broke.

#include "esengine/renderer/lod/LodSelection.hpp"
#include "esengine/renderer/lod/LodViewState.hpp"

#include <glm/gtc/matrix_transform.hpp>

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

/** A camera at the origin looking down -Z, the convention the engine's own builds. */
static glm::mat4 perspectiveVP(f32 fovDeg, f32 aspect) {
    return glm::perspective(glm::radians(fovDeg), aspect, 1.0f, 100000.0f)
         * glm::lookAt(glm::vec3(0.0f), glm::vec3(0.0f, 0.0f, -1.0f), glm::vec3(0.0f, 1.0f, 0.0f));
}

static glm::mat4 orthographicVP(f32 halfHeight, f32 aspect) {
    return glm::ortho(-halfHeight * aspect, halfHeight * aspect, -halfHeight, halfHeight,
                      1.0f, 100000.0f)
         * glm::lookAt(glm::vec3(0.0f), glm::vec3(0.0f, 0.0f, -1.0f), glm::vec3(0.0f, 1.0f, 0.0f));
}

static f32 sizeAt(const glm::mat4& vp, f32 distance, f32 radius) {
    return lod::screenRelativeSize(vp, glm::vec3(0.0f, 0.0f, -distance), radius);
}

static void testProjection() {
    const glm::mat4 vp = perspectiveVP(60.0f, 1.0f);
    const f32 tanHalf = std::tan(glm::radians(30.0f));

    // The closed form a fraction of the screen HEIGHT has: a sphere of radius R at
    // distance d covers 2R of the 2*d*tan(fov/2) the frame is tall there.
    CHECK(near(sizeAt(vp, 1000.0f, 100.0f), 100.0f / (1000.0f * tanHalf)),
          "perspective size is radius / (distance * tan(fov/2))");
    CHECK(near(sizeAt(vp, 500.0f, 100.0f), 2.0f * sizeAt(vp, 1000.0f, 100.0f)),
          "halving the distance doubles the size");
    CHECK(near(sizeAt(vp, 1000.0f, 200.0f), 2.0f * sizeAt(vp, 1000.0f, 100.0f)),
          "doubling the radius doubles the size");

    // The claim a world distance cannot make: nothing moved, and the answer changed.
    const glm::mat4 narrow = perspectiveVP(30.0f, 1.0f);
    CHECK(near(sizeAt(narrow, 1000.0f, 100.0f),
               sizeAt(vp, 1000.0f, 100.0f) * tanHalf / std::tan(glm::radians(15.0f)), 1e-3f),
          "narrowing the field of view grows the size at a fixed distance");

    // Aspect is horizontal only, so a frame twice as wide frames the same height.
    CHECK(near(sizeAt(perspectiveVP(60.0f, 2.0f), 1000.0f, 100.0f), sizeAt(vp, 1000.0f, 100.0f)),
          "the aspect ratio does not change a fraction of the height");

    const glm::mat4 ortho = orthographicVP(500.0f, 1.0f);
    CHECK(near(sizeAt(ortho, 1000.0f, 100.0f), 200.0f / 1000.0f),
          "orthographic size is the diameter over the visible height");
    CHECK(near(sizeAt(ortho, 5000.0f, 100.0f), sizeAt(ortho, 1000.0f, 100.0f)),
          "orthographic size does not change with distance");

    CHECK(sizeAt(vp, -10.0f, 100.0f) == lod::kSizeAtEye,
          "a centre behind the eye reports the size that picks the nearest level");
}

static void testBoundingSphere() {
    const glm::vec3 min(-100.0f, -50.0f, -25.0f), max(100.0f, 50.0f, 25.0f);
    glm::vec3 centre(0.0f);
    f32 radius = 0.0f;
    lod::boundingSphere(glm::vec3(10.0f, 0.0f, -1000.0f), glm::quat(1.0f, 0.0f, 0.0f, 0.0f),
                        glm::vec3(1.0f), min, max, centre, radius);
    CHECK(near(radius, std::sqrt(100.0f * 100.0f + 50.0f * 50.0f + 25.0f * 25.0f)),
          "the radius is the half-diagonal of the box");
    CHECK(near(centre.x, 10.0f) && near(centre.z, -1000.0f), "the centre is where the box is");

    // A spinning object must not change level for spinning: the sphere is why.
    glm::vec3 turnedCentre(0.0f);
    f32 turnedRadius = 0.0f;
    lod::boundingSphere(glm::vec3(10.0f, 0.0f, -1000.0f),
                        glm::angleAxis(glm::radians(37.0f), glm::vec3(0.3f, 1.0f, 0.2f)),
                        glm::vec3(1.0f), min, max, turnedCentre, turnedRadius);
    CHECK(near(turnedRadius, radius), "turning the object does not change the radius");

    lod::boundingSphere(glm::vec3(0.0f), glm::quat(1.0f, 0.0f, 0.0f, 0.0f), glm::vec3(2.0f),
                        min, max, centre, radius);
    CHECK(near(radius, 2.0f * turnedRadius), "scale multiplies the radius");
}

/** Two stand-ins at 0.5 and 0.25, culled under 0.05, with a tenth of hysteresis. */
static lod::LevelSet twoStandIns(f32 hysteresis = 0.1f) {
    lod::LevelSet set;
    set.takeOver[0] = 0.5f;
    set.takeOver[1] = 0.25f;
    set.count = 2;
    set.cull = 0.05f;
    set.hysteresis = hysteresis;
    return set;
}

static void testSelection() {
    const lod::LevelSet set = twoStandIns();
    CHECK(lod::selectLevel(set, 0.80f, 0) == 0, "a big object takes level 0");
    CHECK(lod::selectLevel(set, 0.30f, 0) == 1, "under the first threshold takes level 1");
    CHECK(lod::selectLevel(set, 0.10f, 0) == 2, "under the second threshold takes level 2");
    CHECK(lod::selectLevel(set, 0.01f, 0) == lod::kCulled, "under the cull size nothing is drawn");

    lod::LevelSet noCull = set;
    noCull.cull = 0.0f;
    CHECK(lod::selectLevel(noCull, 0.0001f, 0) == 2,
          "a group with no cull size is never invisible");
}

static void testHysteresis() {
    const lod::LevelSet set = twoStandIns();

    // The band the boundary is thick by: 0.5 going coarse, 0.55 coming back.
    CHECK(lod::selectLevel(set, 0.49f, 0) == 1, "0.49 hands over to level 1");
    CHECK(lod::selectLevel(set, 0.52f, 1) == 1, "inside the band the coarse level holds");
    CHECK(lod::selectLevel(set, 0.56f, 1) == 0, "past the band the fine level returns");

    lod::LevelSet none = twoStandIns(0.0f);
    CHECK(lod::selectLevel(none, 0.52f, 1) == 0,
          "without hysteresis the same size flips straight back");

    // A camera breathing across the boundary: with the band the level is drawn once
    // and stays, without it the level changes on every frame.
    u8 held = 0, flipped = 0, heldChanges = 0, flippedChanges = 0;
    for (int i = 0; i < 8; ++i) {
        const f32 size = (i % 2 == 0) ? 0.49f : 0.51f;
        const u8 nextHeld = lod::selectLevel(set, size, held);
        const u8 nextFlipped = lod::selectLevel(none, size, flipped);
        if (nextHeld != held) ++heldChanges;
        if (nextFlipped != flipped) ++flippedChanges;
        held = nextHeld;
        flipped = nextFlipped;
    }
    CHECK(heldChanges == 1, "jitter across the boundary changes the level once");
    CHECK(flippedChanges == 8, "with no band the same jitter changes it every frame");

    CHECK(lod::selectLevel(set, 0.052f, lod::kCulled) == lod::kCulled,
          "the cull boundary has the same band");
    CHECK(lod::selectLevel(set, 0.06f, lod::kCulled) == 2, "past it the object comes back");
}

static void testViewOwnership() {
    lod::LodViewState state;
    const Entity object = Entity::make(7, 1);
    const u32 mainCamera = 11, minimap = 12;

    state.beginFrame();
    CHECK(state.lastLevel(mainCamera, object) == 0, "an unseen pair starts unbiased");

    state.remember(mainCamera, object, 0, 0, 2, 0.52f);
    state.remember(minimap, object, 2, 2, 2, 0.52f);
    CHECK(state.lastLevel(mainCamera, object) == 0 && state.lastLevel(minimap, object) == 2,
          "one object is remembered at two levels by two views");

    // The same size, decided under each view's own memory: the near camera holds
    // the fine level inside the band and the far one holds the coarse level.
    const lod::LevelSet set = twoStandIns();
    CHECK(lod::selectLevel(set, 0.52f, state.lastLevel(mainCamera, object)) == 0
       && lod::selectLevel(set, 0.52f, state.lastLevel(minimap, object)) == 1,
          "two views decide the same size differently");

    const usize before = state.size();
    for (u64 i = 0; i < lod::LodViewState::kKeepFrames * 3; ++i) state.beginFrame();
    CHECK(before == 2 && state.size() == 0, "a pair no view asks about again is dropped");
}

static void testDecisionRecorded() {
    lod::LodViewState state;
    const Entity object = Entity::make(9, 1);
    const u32 view = 3;
    u8 level = 9, unbiased = 9, levels = 9;
    f32 size = -1.0f;

    CHECK(!state.inspect(view, object, level, unbiased, levels, size),
          "a pair this view never measured reports nothing, not level 0");

    state.beginFrame();
    state.remember(view, object, 0, 1, 2, 0.149f);
    CHECK(state.inspect(view, object, level, unbiased, levels, size),
          "a measured pair reports");
    CHECK(level == 0 && unbiased == 1 && levels == 2 && size == 0.149f,
          "the whole decision comes back, not just its outcome");
    // The one explanation the component cannot give: the numbers on screen say
    // LOD1 and the frame drew LOD0, and only the recorded pair says why.
    CHECK(level != unbiased, "chosen and unbiased differing is hysteresis holding");
}

static void testPreviewOwnership() {
    lod::LodViewState state;
    const Entity object = Entity::make(4, 1);
    const u32 edit = 1, play = 2;

    state.beginFrame();
    state.remember(edit, object, 0, 0, 2, 0.6f);
    state.remember(play, object, 0, 0, 2, 0.6f);
    CHECK(state.drawn(edit, object, 0, 2) == 0, "with no preview the chosen level is drawn");

    state.preview(edit, object, 2);
    CHECK(state.drawn(edit, object, 0, 2) == 2, "a preview is what that view draws");
    CHECK(state.drawn(play, object, 0, 2) == 0, "and only that view — the pair is the key");

    u8 level = 9, unbiased = 9, levels = 9;
    f32 size = -1.0f;
    state.inspect(edit, object, level, unbiased, levels, size);
    CHECK(level == 0, "the recorded choice is untouched — a preview is not a decision");

    // Leaving a preview must obey the selector again, not resume from what was
    // held up: the choice went on being made and remembered underneath it.
    state.preview(edit, object, lod::kNoPreview);
    CHECK(state.drawn(edit, object, 0, 2) == 0, "back to auto is back to the chosen level");
    CHECK(state.previewCount() == 0, "and the slot is gone, not merely equal to the choice");

    // A group with two stand-ins has no LOD3 to hold up.
    state.preview(edit, object, 3);
    CHECK(state.drawn(edit, object, 0, 2) == 0,
          "a preview past the last stand-in is ignored, not clamped to the last one");
}

int main() {
    testProjection();
    testBoundingSphere();
    testSelection();
    testHysteresis();
    testViewOwnership();
    testDecisionRecorded();
    testPreviewOwnership();
    std::printf(g_failures ? "\n%d failure(s)\n" : "\nall LOD selection claims hold\n",
                g_failures);
    return g_failures ? 1 : 0;
}
