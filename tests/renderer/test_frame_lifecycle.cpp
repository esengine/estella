// How many times a frame is declared over, which is once. `GfxDevice::endFrame`
// serves a booked capture, so a second close fails the next frame's — and the
// static gate asks WHO closes a frame, never how many times.

#include "MockGfxDevice.hpp"
#include "esengine/renderer/frame/RenderFrame.hpp"
#include "esengine/renderer/frame/RenderContext.hpp"
#include "esengine/resource/ResourceManager.hpp"
#include "esengine/ecs/Registry.hpp"

#include <cstdio>

using namespace esengine;

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

namespace {

constexpr u32 kW = 64;
constexpr u32 kH = 64;

/** A frame with everything in it that runs between the two ends: two cameras,
 *  and the screen overlay after them. What the closing count must survive. */
void drawBusyFrame(RenderFrame& frame, ecs::Registry& registry) {
    const glm::mat4 vp(1.0f);
    frame.beginFrame();

    frame.begin(vp);
    frame.end();

    frame.begin(vp);
    frame.end();

    frame.beginScreenOverlay(vp, 0, 0, kW, kH);
    frame.submitScreenOverlay(registry);
    frame.endScreenOverlay(0);

    frame.endFrame();
}

}  // namespace

int main() {
    MockGfxDevice device;
    RenderContext context(device);
    resource::ResourceManager resources;
    ecs::Registry registry;

    // No init(): that builds the post-process pipeline, whose shaders a mock
    // device cannot create. What is counted here is the frame's two ends, and
    // those do not go through it.
    RenderFrame frame(device, context, resources);

    drawBusyFrame(frame, registry);
    CHECK(device.endFrameCalls == 1,
          "one frame closes the device once, through two cameras and the overlay");

    // Frame two, from a device that is still counting: a close that leaks into
    // the NEXT frame's opening is the shape this exists to catch, and a
    // single-frame count cannot see it.
    drawBusyFrame(frame, registry);
    CHECK(device.endFrameCalls == 2,
          "the second frame adds exactly one more, so opening a frame closes nothing");

    // ...and a frame nobody drew into. beginFrame/endFrame with nothing between
    // them is still one close, not zero and not two.
    frame.beginFrame();
    frame.endFrame();
    CHECK(device.endFrameCalls == 3, "an empty frame closes once too");

    // No shutdown() either: nothing was initialised.

    std::printf(g_failures ? "\n%d check(s) failed\n" : "\nall checks passed\n", g_failures);
    return g_failures == 0 ? 0 : 1;
}
