// Which direction each picture of an impostor atlas is taken from, and which a view is shown, held against their claims without a
// device. The SDK's bake places its cameras by the same rule; sdk/tests/impostor.test.ts holds it to the same numbers.

#include "esengine/renderer/draw/ImpostorFrames.hpp"

#include <cmath>
#include <cstdio>

using namespace esengine;

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

static bool near(const glm::vec3& a, const glm::vec3& b, f32 eps = 1e-4f) { return glm::length(a - b) < eps; }

static void testFolding() {
    CHECK(near(impostor::decode(glm::vec2(0.5f)), glm::vec3(0.0f, 1.0f, 0.0f)), "the centre of the square is straight above");
    CHECK(near(impostor::decode(glm::vec2(0.0f, 0.0f)), glm::vec3(-1.0f, 0.0f, 0.0f)), "a corner is on the horizon (-x)");
    CHECK(near(impostor::decode(glm::vec2(1.0f, 0.0f)), glm::vec3(0.0f, 0.0f, 1.0f)), "the next corner is on the horizon (+z)");
    bool round = true;
    for (f32 a = 0.0f; a < 6.28f; a += 0.37f) {
        for (f32 e = 0.0f; e < 1.5f; e += 0.29f) {
            const glm::vec3 d(std::cos(a) * std::cos(e), std::sin(e), std::sin(a) * std::cos(e));
            round = round && near(impostor::decode(impostor::encode(d)), glm::normalize(d), 1e-3f);
        }
    }
    CHECK(round, "every direction of the upper hemisphere folds and unfolds to itself");
    CHECK(near(impostor::decode(impostor::encode(glm::vec3(1.0f, -0.5f, 0.0f))), glm::vec3(1.0f, 0.0f, 0.0f)),
          "below the horizon is taken as on it");
}

static void testFrames() {
    const u32 n = 8;
    CHECK(near(impostor::frameDirection(0, 0, n), glm::vec3(-1.0f, 0.0f, 0.0f)), "frame (0, 0) is taken from the horizon");
    bool own = true;
    for (u32 i = 0; i < n; ++i) for (u32 j = 0; j < n; ++j) {
        const glm::uvec2 f = impostor::nearestFrame(impostor::frameDirection(i, j, n), n);
        own = own && f.x == i && f.y == j;
    }
    CHECK(own, "a view from a frame's own direction is shown that frame");
    // The numbers the TypeScript bake is held to.
    const glm::vec3 d = impostor::frameDirection(2, 5, n);
    std::printf("      frame (2, 5) of 8: %.6f %.6f %.6f\n", d.x, d.y, d.z);
    CHECK(near(d, glm::normalize(glm::vec3(0.0f, 0.571429f, -0.428571f))),
          "frame (2, 5) of 8 is where the SDK's bake puts its camera");
}

static void testUp() {
    const glm::vec3 side = glm::normalize(glm::vec3(1.0f, 0.3f, 0.2f));
    const glm::vec3 up = impostor::pictureUp(side);
    CHECK(std::abs(glm::dot(up, side)) < 1e-5f && up.y > 0.0f, "a picture's up is across the view and toward the sky");
    CHECK(near(impostor::pictureUp(glm::vec3(0.0f, 1.0f, 0.0f)), glm::vec3(0.0f, 0.0f, -1.0f)), "straight overhead, -z is up");
}

int main() {
    testFolding();
    testFrames();
    testUp();
    std::printf(g_failures ? "\n%d FAILED\n" : "\nall passed\n", g_failures);
    return g_failures ? 1 : 0;
}
