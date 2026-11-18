#include "MockGfxDevice.hpp"
#include "esengine/renderer/frame/RenderFrame.hpp"
#include "esengine/renderer/frame/RenderContext.hpp"
#include "esengine/resource/ResourceManager.hpp"
#include "esengine/ecs/Registry.hpp"

#include <cstdio>
#include <unordered_set>
#include <vector>

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

void drawSegmentedFrame(RenderFrame& frame, ecs::Registry& registry) {
    const glm::mat4 vp(1.0f);
    frame.beginFrame();
    frame.beginScreenOverlay(vp, 0, 0, kW, kH);
    frame.keepScreenOverlay(registry, true);
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
    resources.init(device);
    RenderFrame frame(device, context, resources);
    frame.init(kW, kH);
    frame.setRetainedTextCollected(true);

    std::unordered_set<u32> domain;
    std::vector<u32> rootByIndex;
    frame.setScreenDomain(&domain);

    const std::vector<u32> none;
    frame.setScreenRoots(&none, &rootByIndex);
    drawSegmentedFrame(frame, registry);
    const int unsegmented = device.createVertexLayoutCalls;
    const std::vector<u32> first{registry.create().id()};
    frame.setScreenRoots(&first, &rootByIndex);
    drawSegmentedFrame(frame, registry);
    CHECK(device.createVertexLayoutCalls > unsegmented, "a screen with a root is drawn in a segment with a pool of its own");
    const int layoutsMade = device.createVertexLayoutCalls;
    const int layoutsDropped = device.deleteVertexLayoutCalls;
    const int buffersMade = device.createBufferCalls;

    for (int scene = 0; scene < 8; ++scene) {
        const std::vector<u32> next{registry.create().id()};
        frame.setScreenRoots(&next, &rootByIndex);
        drawSegmentedFrame(frame, registry);
    }
    CHECK(device.createVertexLayoutCalls == layoutsMade && device.deleteVertexLayoutCalls == layoutsDropped,
          "a root that replaces another takes over its segment's pool: no layout is made or dropped");
    CHECK(device.createBufferCalls == buffersMade, "nor any buffer");

    const std::vector<u32> two{registry.create().id(), registry.create().id()};
    frame.setScreenRoots(&two, &rootByIndex);
    drawSegmentedFrame(frame, registry);
    CHECK(device.createVertexLayoutCalls > layoutsMade, "a second root at once still gets a pool of its own");
    const int droppedBefore = device.deleteVertexLayoutCalls;
    const std::vector<u32> one{two.front()};
    frame.setScreenRoots(&one, &rootByIndex);
    drawSegmentedFrame(frame, registry);
    CHECK(device.deleteVertexLayoutCalls > droppedBefore, "and a root that goes with none to take over lets its pool go");

    frame.setScreenRoots(nullptr, nullptr);
    frame.setScreenDomain(nullptr);
    frame.shutdown();
    resources.shutdown();

    std::printf(g_failures ? "\n%d check(s) failed\n" : "\nall checks passed\n", g_failures);
    return g_failures == 0 ? 0 : 1;
}
