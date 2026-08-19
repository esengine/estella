// Clip-depth convention. Asserts what a frame cannot show: that the GL path is a
// literal pass-through, that the converted one maps the volume exactly, and that
// the viewpoint the shaders read does not move under the conversion.

#include "esengine/renderer/frame/FrameConstants.hpp"
#include "esengine/math/Math.hpp"

#include <cstdio>
#include <cmath>
#include <cstring>

using namespace esengine;

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

/// Clip z of a world point under @p m, after the perspective divide.
static float ndcZ(const glm::mat4& m, const glm::vec3& world) {
    const glm::vec4 clip = m * glm::vec4(world, 1.0f);
    return clip.z / clip.w;
}

static bool near(float a, float b) { return std::fabs(a - b) < 1e-5f; }

/// Same tolerance, taken against the magnitude — for a world-space coordinate,
/// where 1e-5 absolute is below what a float32 can hold at a few hundred units.
static bool nearRel(float a, float b) {
    return std::fabs(a - b) <= 1e-5f * std::fmax(1.0f, std::fmax(std::fabs(a), std::fabs(b)));
}

int main() {
    // The symmetric slab a 2D camera frames: far in both directions, which is what
    // puts content behind the camera plane at a negative clip z.
    const glm::mat4 cam = math::ortho(-100.0f, 100.0f, -100.0f, 100.0f, -1000.0f, 1000.0f);

    // The engine's own convention, stated rather than inherited from GLM's macro.
    CHECK(near(ndcZ(cam, {0, 0, 1000}), -1.0f), "engine ortho: the near edge is -1");
    CHECK(near(ndcZ(cam, {0, 0, 0}), 0.0f), "engine ortho: the middle is 0");
    CHECK(near(ndcZ(cam, {0, 0, -1000}), 1.0f), "engine ortho: the far edge is +1");

    // A device keeping the engine's range gets the matrix untouched. Bit-for-bit,
    // not approximately: this is what makes a WebGL2 build unchanged by the seam.
    const glm::mat4 gl = toClipDepthRange(cam, ClipDepthRange::MinusOneToOne);
    CHECK(std::memcmp(&gl[0][0], &cam[0][0], sizeof(glm::mat4)) == 0,
          "MinusOneToOne returns the projection bit for bit");

    // A device keeping [0,1] gets the same volume expressed in its own range, so
    // the slab's edges land on the edges rather than half of it being discarded.
    const glm::mat4 wgpu = toClipDepthRange(cam, ClipDepthRange::ZeroToOne);
    CHECK(near(ndcZ(wgpu, {0, 0, 1000}), 0.0f), "ZeroToOne: the near edge is 0");
    CHECK(near(ndcZ(wgpu, {0, 0, 0}), 0.5f), "ZeroToOne: the middle is 0.5");
    CHECK(near(ndcZ(wgpu, {0, 0, -1000}), 1.0f), "ZeroToOne: the far edge is +1");

    // The case the gate exists for: content behind an ortho camera plane is inside
    // the slab, so it must survive on a device that discards everything below 0.
    CHECK(ndcZ(cam, {0, 0, 1}) < 0.0f, "behind the camera plane is negative in [-1,1]");
    CHECK(ndcZ(wgpu, {0, 0, 1}) > 0.0f, "and is kept once converted");

    // Nothing outside the slab is let in by the conversion.
    CHECK(ndcZ(wgpu, {0, 0, 1500}) < 0.0f, "ZeroToOne still clips past the near edge");
    CHECK(ndcZ(wgpu, {0, 0, -1500}) > 1.0f, "ZeroToOne still clips past the far edge");

    // Where the eye is comes out of the matrix, and both the frame constants and
    // the CPU read it — so the conversion must not move it. Orthographic: a
    // direction pointing at the viewer.
    const glm::vec4 eyeGl = cameraFromViewProjection(cam);
    const glm::vec4 eyeWgpu = cameraFromViewProjection(wgpu);
    CHECK(near(eyeGl.x, eyeWgpu.x) && near(eyeGl.y, eyeWgpu.y)
          && near(eyeGl.z, eyeWgpu.z) && near(eyeGl.w, eyeWgpu.w),
          "the orthographic viewpoint is invariant under the conversion");

    // And perspective: an eye POINT, which divides down from a different column.
    const glm::mat4 persp = math::perspective(1.0f, 1.6f, 0.1f, 1000.0f)
                          * math::lookAt({0, 0, 300}, {0, 0, 0}, {0, 1, 0});
    const glm::vec4 pGl = cameraFromViewProjection(persp);
    const glm::vec4 pWgpu = cameraFromViewProjection(
        toClipDepthRange(persp, ClipDepthRange::ZeroToOne));
    CHECK(near(pGl.w, 1.0f) && near(pWgpu.w, 1.0f), "a perspective camera reports an eye point");
    // A POINT, so relative: a float32 keeps ~7 digits and the two matrices are
    // inverted independently. The claim is that the EXTRACTION ignores the clip
    // range — any k·row2 + m·row3 only scales the column it reads.
    CHECK(nearRel(pGl.x, pWgpu.x) && nearRel(pGl.y, pWgpu.y) && nearRel(pGl.z, pWgpu.z),
          "the perspective viewpoint is invariant under the conversion");

    std::printf(g_failures ? "\n%d check(s) failed\n" : "\nall checks passed\n", g_failures);
    return g_failures == 0 ? 0 : 1;
}
