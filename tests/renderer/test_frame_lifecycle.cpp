// How many times a frame is declared over, which is once. `GfxDevice::endFrame`
// serves a booked capture, so a second close fails the next frame's — and the
// static gate asks WHO closes a frame, never how many times.

#include "MockGfxDevice.hpp"
#include "esengine/renderer/frame/RenderFrame.hpp"
#include "esengine/renderer/frame/RenderContext.hpp"
#include "esengine/renderer/draw/TextVertexFormat.hpp"
#include "esengine/resource/ResourceManager.hpp"
#include "esengine/ecs/Registry.hpp"
#include "esengine/ecs/TransformSystem.hpp"
#include "esengine/ecs/components/LODGroup.hpp"
#include "esengine/ecs/components/LODMember.hpp"
#include "esengine/ecs/components/MeshRenderer.hpp"
#include "esengine/renderer/plugins/MeshPlugin.hpp"

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

Entity addLodGroup(ecs::Registry& registry, f32 radius) {
    const Entity root = registry.create();
    registry.emplace<ecs::Transform>(root);
    auto& group = registry.emplace<ecs::LODGroup>(root);
    group.lod1Size = 0.5f;
    group.lod2Size = group.lod3Size = group.cullSize = 0;
    for (int level = 0; level < 2; ++level) {
        const Entity e = registry.create();
        registry.emplace<ecs::Transform>(e);
        auto& member = registry.emplace<ecs::LODMember>(e);
        member.group = root.raw;
        member.boundsRadius = radius;
        member.level = level;
        auto& mesh = registry.emplace<ecs::MeshRenderer>(e);
        mesh.vertices = {{{-0.2f, -0.2f}}, {{0.2f, -0.2f}}, {{0.0f, 0.2f}}};
        mesh.indices = {0, 1, 2};
        mesh.localMin = glm::vec2(-0.2f);
        mesh.localMax = glm::vec2(0.2f);
    }
    ecs::TransformSystem{}.ensureComposed(registry);
    return root;
}

void testWorldLod(RenderFrame& frame) {
    ecs::Registry a, b;
    const Entity group = addLodGroup(a, 0.8f);
    CHECK(addLodGroup(b, 0.2f) == group, "two registries issue the same LOD group ID");
    u8 level = 0, unbiased = 0, levels = 0;
    f32 size = 0.0f;
    auto inspect = [&](const ecs::Registry* registry) {
        return frame.lodInspect(0, group, level, unbiased, levels, size, registry);
    };

    frame.setLodPreview(0, group, 1);
    frame.beginFrame();
    frame.begin(glm::mat4(1.0f));
    frame.collectAll(a);
    frame.collectAll(b);
    CHECK(inspect(&a) && level == 0 && size > 0.5f, "first world's group records its own projected size");
    CHECK(inspect(&b) && level == 1 && size < 0.5f, "second world's group selects its coarse member in the same frame");
    CHECK(inspect(nullptr) && level == 1, "a legacy inspection reads the last collected world");
    frame.setLodPreview(0, group, 0, &b);
    CHECK(frame.lodPreviewCount() == 2, "a pre-collect legacy hold and a scoped peer hold have separate owners");
    frame.end();
    frame.endFrame();

    frame.setLodPreview(0, group, lod::kNoPreview, &a);
    frame.setLodPreview(0, group, lod::kNoPreview, &b);
    a.get<ecs::LODGroup>(group).lod1Size = 0.9f;
    frame.beginFrame();
    frame.begin(glm::mat4(1.0f));
    frame.collectAll(a);
    frame.collectAll(b);
    u8 from = 0;
    f32 progress = 1.0f;
    CHECK(frame.lodFading(0, group, from, progress, &a) && from == 0 && progress == 0.0f,
          "changing the first world's threshold starts its fade on this frame");
    CHECK(!frame.lodFading(0, group, from, progress, &b), "the other world retains its settled level");
    frame.setLodPreview(0, group, 0, &a);
    frame.setLodPreview(0, group, 1, &b);
    a.destroy(group);
    CHECK(!inspect(&a) && inspect(&b) && frame.lodPreviewCount() == 1,
          "despawning the first group releases just its measurements and preview");
    b.clear();
    CHECK(addLodGroup(b, 0.8f) == group, "bulk reset can reissue the very same handle");
    CHECK(!inspect(&b) && frame.lodPreviewCount() == 0, "a reissued handle starts without the removed group's state");
    frame.collectAll(b);
    CHECK(inspect(&b) && level == 0 && size > 0.5f, "the reissued group is measured in its first collect");
    frame.end();
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

    // Last, because it loses the device, and initialised only here, because a text batch needs the frame's programs and staging. A lost
    // device refuses every frame until its content is back, and the host still submits text into them. What one refused frame staged
    // is gone by the next: a staging that kept growing reached gigabytes on a large scene and aborted the module.
    resources.init(device);
    frame.addPlugin(makeUnique<MeshPlugin>());
    frame.init(kW, kH);
    testWorldLod(frame);
    device.notifyDeviceLost(GfxDeviceLostReason::ContextLost, "gone");
    f32 glyphs[TEXT_VERTEX_FLOATS * 4] = {};
    const u16 quad[6] = {0, 1, 2, 0, 2, 3};
    const glm::mat4 identity(1.0f);
    u32 afterFirst = 0;
    for (int i = 0; i < 3; ++i) {
        frame.beginFrame();
        frame.begin(identity);
        frame.submitTextBatch(glyphs, 4, quad, 6, 0, &identity[0][0], Entity{}, 0, 0.0f, TextGlyphMode::Color, 0);
        if (i == 0) afterFirst = frame.stagedVertexBytes(LayoutId::Batch);
        frame.end();
        frame.endFrame();
    }
    CHECK(!frame.inFrame(), "a lost device's frame is refused");
    CHECK(afterFirst > 0 && frame.stagedVertexBytes(LayoutId::Batch) == afterFirst,
          "a refused frame starts empty, so what the host submits into it does not pile up");
    resources.shutdown();

    std::printf(g_failures ? "\n%d check(s) failed\n" : "\nall checks passed\n", g_failures);
    return g_failures == 0 ? 0 : 1;
}
