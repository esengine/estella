// Native CTest harness for the full-screen RenderGraph.
//
// Reuse, culling and target sizing are all invisible in a correct image, so
// what this asserts on is the SEQUENCE of device calls a graph produces.

#include "MockGfxDevice.hpp"
#include "esengine/renderer/graph/RenderGraph.hpp"

#include <cstdio>
#include <string>
#include <vector>

using namespace esengine;

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

namespace {

rg::PassDesc fullscreen(const char* name, std::vector<rg::ResourceId> reads,
                        rg::ResourceId write, std::vector<std::string>* ran = nullptr) {
    rg::PassDesc pass;
    pass.name = name;
    pass.reads = std::move(reads);
    pass.write = write;
    if (ran) {
        const std::string label = name;
        pass.execute = [ran, label](const rg::PassContext&) { ran->push_back(label); };
    }
    return pass;
}

}  // namespace

int main() {
    // --- a linear chain runs on two physical targets ---
    {
        MockGfxDevice d;
        rg::RenderGraph graph(d);
        std::vector<std::string> ran;

        graph.begin(256, 128);
        const auto scene = graph.importTexture(TextureHandle{7}, 256, 128);
        const auto out = graph.importTarget(FramebufferHandle{9}, 256, 128);
        const auto a = graph.createTarget({});
        const auto b = graph.createTarget({});
        graph.addPass(fullscreen("extract", {scene}, a, &ran));
        graph.addPass(fullscreen("blur", {a}, b, &ran));
        graph.addPass(fullscreen("composite", {b, scene}, out, &ran));
        graph.execute();

        CHECK(ran.size() == 3, "every pass the image depends on runs");
        CHECK(graph.pooledTargetCount() == 2, "a linear chain needs two physical targets");
        CHECK(d.createFramebufferCalls == 2, "and allocates exactly those two");
        CHECK(d.passLog.size() == 3, "one render pass opened per graph pass");
        CHECK(d.passLog.back().target == FramebufferHandle{9},
              "the last pass draws into the imported target");
    }

    // --- a third link reuses the first target rather than allocating ---
    {
        MockGfxDevice d;
        rg::RenderGraph graph(d);

        graph.begin(256, 128);
        const auto scene = graph.importTexture(TextureHandle{7}, 256, 128);
        const auto out = graph.importTarget(FramebufferHandle{9}, 256, 128);
        const auto a = graph.createTarget({});
        const auto b = graph.createTarget({});
        const auto c = graph.createTarget({});
        graph.addPass(fullscreen("p0", {scene}, a));
        graph.addPass(fullscreen("p1", {a}, b));
        graph.addPass(fullscreen("p2", {b}, c));
        graph.addPass(fullscreen("p3", {c}, out));
        graph.execute();

        CHECK(graph.pooledTargetCount() == 2, "a longer chain still needs only two");
    }

    // --- a pass nothing reads is not run ---
    {
        MockGfxDevice d;
        rg::RenderGraph graph(d);
        std::vector<std::string> ran;

        graph.begin(64, 64);
        const auto scene = graph.importTexture(TextureHandle{7}, 64, 64);
        const auto out = graph.importTarget(FramebufferHandle{9}, 64, 64);
        const auto orphan = graph.createTarget({});
        graph.addPass(fullscreen("dead", {scene}, orphan, &ran));
        graph.addPass(fullscreen("blit", {scene}, out, &ran));
        graph.execute();

        CHECK(ran.size() == 1 && ran[0] == "blit", "the pass no path reaches is culled");
        CHECK(d.createFramebufferCalls == 0, "and its target is never allocated");
    }

    // --- a pass declares its own size ---
    {
        MockGfxDevice d;
        rg::RenderGraph graph(d);
        u32 blurW = 0, blurH = 0;

        graph.begin(200, 100);
        const auto scene = graph.importTexture(TextureHandle{7}, 200, 100);
        const auto out = graph.importTarget(FramebufferHandle{9}, 200, 100);
        rg::TargetDesc half;
        half.scale = 0.5f;
        const auto small = graph.createTarget(half);
        rg::PassDesc blur = fullscreen("blur", {scene}, small);
        blur.execute = [&](const rg::PassContext& ctx) { blurW = ctx.width; blurH = ctx.height; };
        graph.addPass(std::move(blur));
        graph.addPass(fullscreen("composite", {small, scene}, out));
        graph.execute();

        CHECK(blurW == 100 && blurH == 50, "a half-scale pass runs at half the reference size");
        CHECK(d.viewportLog.size() >= 1 && d.viewportLog[0].w == 100 && d.viewportLog[0].h == 50,
              "the viewport follows the target, not the screen");
    }

    // --- reads bind in declaration order ---
    {
        MockGfxDevice d;
        rg::RenderGraph graph(d);
        TextureHandle first = TextureHandle::Invalid, second = TextureHandle::Invalid;

        graph.begin(64, 64);
        const auto scene = graph.importTexture(TextureHandle{7}, 64, 64);
        const auto out = graph.importTarget(FramebufferHandle{9}, 64, 64);
        const auto blurred = graph.createTarget({});
        graph.addPass(fullscreen("blur", {scene}, blurred));
        rg::PassDesc composite = fullscreen("composite", {blurred, scene}, out);
        composite.execute = [&](const rg::PassContext& ctx) {
            first = ctx.input(0);
            second = ctx.input(1);
        };
        graph.addPass(std::move(composite));
        graph.execute();

        CHECK(second == TextureHandle{7}, "a pass reads the scene because it declared it second");
        CHECK(first != TextureHandle::Invalid && first != second,
              "and the blur result as its first input");
        CHECK(d.bindLog.size() == 3, "each read is bound once, at its declared unit");
        CHECK(d.bindLog[1].first == 0 && d.bindLog[2].first == 1,
              "units follow declaration order");
    }

    // --- the pool outlives the frame ---
    {
        MockGfxDevice d;
        rg::RenderGraph graph(d);

        for (int frame = 0; frame < 3; ++frame) {
            graph.begin(64, 64);
            const auto scene = graph.importTexture(TextureHandle{7}, 64, 64);
            const auto out = graph.importTarget(FramebufferHandle{9}, 64, 64);
            const auto mid = graph.createTarget({});
            graph.addPass(fullscreen("blur", {scene}, mid));
            graph.addPass(fullscreen("blit", {mid}, out));
            graph.execute();
        }

        CHECK(d.createFramebufferCalls == 1, "three frames of the same graph allocate once");
        graph.releasePool();
        CHECK(graph.pooledTargetCount() == 0, "releasePool drops what device loss invalidated");
    }

    // --- nothing runs without a declared output ---
    {
        MockGfxDevice d;
        rg::RenderGraph graph(d);
        std::vector<std::string> ran;

        graph.begin(64, 64);
        const auto scene = graph.importTexture(TextureHandle{7}, 64, 64);
        const auto mid = graph.createTarget({});
        graph.addPass(fullscreen("blur", {scene}, mid, &ran));
        graph.execute();

        // Not a no-op worth being lenient about: with no imported target, the
        // default framebuffer is the screen, and a stray pass would draw on it.
        CHECK(ran.empty(), "a graph with no output runs nothing");
    }

    std::printf(g_failures == 0 ? "\nALL PASS\n" : "\n%d FAILURE(S)\n", g_failures);
    return g_failures == 0 ? 0 : 1;
}
