// The rotation a Billboard is drawn with, held against its claims without a device: a view-projection, an eye and where the card stands
// are the whole input. A pixel gate can say a card looked wrong; only this can say which way it was turned.

#include "esengine/renderer/draw/BillboardFacing.hpp"

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

static bool near(const glm::vec3& a, const glm::vec3& b, f32 eps = 1e-3f) { return glm::length(a - b) < eps; }

static glm::mat4 perspectiveFrom(const glm::vec3& eye, const glm::vec3& at) {
    return glm::perspective(glm::radians(60.0f), 1.5f, 1.0f, 10000.0f) * glm::lookAt(eye, at, glm::vec3(0.0f, 1.0f, 0.0f));
}

/** Where the card's own +Z (its face) and +Y end up. */
static glm::vec3 face(const glm::quat& q) { return q * glm::vec3(0.0f, 0.0f, 1.0f); }
static glm::vec3 top(const glm::quat& q) { return q * glm::vec3(0.0f, 1.0f, 0.0f); }

static void testViewPlane() {
    // A camera up and to the side, looking down at the origin.
    const glm::vec3 eye(300.0f, 400.0f, 500.0f);
    const glm::mat4 vp = perspectiveFrom(eye, glm::vec3(0.0f));
    const glm::quat q = billboard::facing(0, vp, glm::vec4(eye, 1.0f), glm::vec3(0.0f));
    const glm::vec3 back = glm::normalize(eye);  // the camera looks at the origin, so its back is toward the eye
    CHECK(near(face(q), back), "view plane: the face points back along the view, toward the camera");
    const glm::mat4 view = glm::lookAt(eye, glm::vec3(0.0f), glm::vec3(0.0f, 1.0f, 0.0f));
    const glm::vec3 cameraUp(view[0][1], view[1][1], view[2][1]);
    CHECK(near(top(q), cameraUp), "view plane: the card's top is the screen's top");
    // Two cards in the same view are parallel, wherever they stand.
    const glm::quat other = billboard::facing(0, vp, glm::vec4(eye, 1.0f), glm::vec3(-200.0f, 0.0f, 80.0f));
    CHECK(near(face(other), face(q)), "view plane: every card in a view faces the same way");
}

static void testUpright() {
    const glm::vec3 eye(300.0f, 400.0f, 500.0f);
    const glm::mat4 vp = perspectiveFrom(eye, glm::vec3(0.0f));
    const glm::vec3 at(100.0f, 0.0f, 0.0f);
    const glm::quat q = billboard::facing(1, vp, glm::vec4(eye, 1.0f), at);
    CHECK(near(top(q), glm::vec3(0.0f, 1.0f, 0.0f)), "upright: the card stays standing");
    const glm::vec3 flat = glm::normalize(glm::vec3(eye.x - at.x, 0.0f, eye.z - at.z));
    CHECK(near(face(q), flat), "upright: it turns about up to face the eye across the ground");
    // Straight overhead the direction across the ground is gone; the card takes the view's and does not spin.
    const glm::vec3 over(100.0f, 800.0f, 0.001f);
    const glm::mat4 down = glm::perspective(glm::radians(60.0f), 1.5f, 1.0f, 10000.0f)
        * glm::lookAt(over, at, glm::vec3(0.0f, 0.0f, -1.0f));
    const glm::quat above = billboard::facing(1, down, glm::vec4(over, 1.0f), at + glm::vec3(0.0f, 0.0f, 0.001f));
    CHECK(near(top(above), glm::vec3(0.0f, 1.0f, 0.0f)) && std::isfinite(above.w), "upright: overhead, still standing and finite");
}

static void testOrthographic() {
    // An orthographic view has no eye position: the direction toward the viewer stands in for it.
    const glm::mat4 vp = glm::ortho(-400.0f, 400.0f, -300.0f, 300.0f, 1.0f, 10000.0f)
        * glm::lookAt(glm::vec3(0.0f, 0.0f, 1000.0f), glm::vec3(0.0f), glm::vec3(0.0f, 1.0f, 0.0f));
    const glm::quat q = billboard::facing(1, vp, glm::vec4(0.0f, 0.0f, 1.0f, 0.0f), glm::vec3(250.0f, 0.0f, 0.0f));
    CHECK(near(face(q), glm::vec3(0.0f, 0.0f, 1.0f)), "orthographic upright: faces the viewer direction, not a point");
    const glm::quat p = billboard::facing(0, vp, glm::vec4(0.0f, 0.0f, 1.0f, 0.0f), glm::vec3(0.0f));
    CHECK(near(face(p), glm::vec3(0.0f, 0.0f, 1.0f)) && near(top(p), glm::vec3(0.0f, 1.0f, 0.0f)),
          "orthographic view plane: a head-on view leaves a quad as it is");
}

int main() {
    testViewPlane();
    testUpright();
    testOrthographic();
    std::printf(g_failures ? "\n%d FAILED\n" : "\nall passed\n", g_failures);
    return g_failures ? 1 : 0;
}
