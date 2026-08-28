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

    // --- the scene target: owned and pooled here, filled somewhere else ---
    {
        MockGfxDevice d;
        rg::RenderGraph graph(d);

        graph.begin(256, 128);
        const auto sceneId = graph.createExternalTarget({});
        // Drawable BEFORE execute, which is the whole point: a frame reaches the
        // host as several calls and the geometry lands between them.
        CHECK(sceneId != rg::kNoResource, "an external target is handed out at declaration");
        CHECK(graph.framebufferOf(sceneId) != FramebufferHandle::Default,
              "and names a real framebuffer to draw into");
        CHECK(d.createFramebufferCalls == 1, "allocated once, at that moment");

        const auto out = graph.importTarget(FramebufferHandle{9}, 256, 128);
        const auto a = graph.createTarget({});
        const auto b = graph.createTarget({});
        graph.addPass(fullscreen("effect", {sceneId}, a));
        graph.addPass(fullscreen("grade", {a}, b));
        graph.addPass(fullscreen("blit", {b}, out));
        graph.execute();

        // Recycled at its last read like any other transient: nothing after
        // "effect" reads the scene, so "grade" is handed that same physical
        // target back — two allocations for a three-link chain, not three.
        CHECK(d.createFramebufferCalls == 2, "the scene target goes back to the pool and is reused");
        CHECK(graph.pooledTargetCount() == 2, "the pool owns it, not the pipeline");
    }

    // --- a target can name its pixels instead of a fraction of the frame ---
    {
        MockGfxDevice d;
        rg::RenderGraph graph(d);
        u32 atlasW = 0, atlasH = 0;

        graph.begin(800, 600);
        const auto out = graph.importTarget(FramebufferHandle{9}, 800, 600);
        rg::TargetDesc atlas;
        atlas.width = 2048;
        atlas.height = 2048;
        atlas.depthStencil = true;
        const auto maps = graph.createTarget(atlas);
        rg::PassDesc shadow = fullscreen("shadow", {}, maps);
        shadow.execute = [&](const rg::PassContext& ctx) { atlasW = ctx.width; atlasH = ctx.height; };
        graph.addPass(std::move(shadow));
        graph.addPass(fullscreen("scene", {maps}, out));
        graph.execute();

        CHECK(atlasW == 2048 && atlasH == 2048,
              "an absolute size is the target's own, not a fraction of the frame");

        // The point of asking in pixels: the same atlas at a different window
        // size is the same resource, so the pool hands back the one it has.
        graph.begin(1920, 1080);
        const auto out2 = graph.importTarget(FramebufferHandle{9}, 1920, 1080);
        const auto maps2 = graph.createTarget(atlas);
        graph.addPass(fullscreen("shadow", {}, maps2));
        graph.addPass(fullscreen("scene", {maps2}, out2));
        graph.execute();

        CHECK(d.createFramebufferCalls == 1,
              "and it survives a resize the fraction-sized targets do not");
    }

    // --- a resource named but not bound still orders the two passes ---
    //
    // The scene reaches the atlas through its materials, not a sampler the graph
    // wired: as a read it would claim a unit; as nothing, its producer is culled.
    {
        MockGfxDevice d;
        rg::RenderGraph graph(d);
        std::vector<std::string> ran;

        graph.begin(256, 128);
        const auto out = graph.importTarget(FramebufferHandle{9}, 256, 128);
        rg::TargetDesc atlas;
        atlas.width = 2048;
        atlas.height = 2048;
        atlas.depthStencil = true;
        const auto maps = graph.createTarget(atlas);
        graph.addPass(fullscreen("shadow-atlas", {}, maps, &ran));
        rg::PassDesc scene = fullscreen("scene", {}, out, &ran);
        scene.dependencies.push_back(maps);
        graph.addPass(std::move(scene));
        graph.execute();

        CHECK(ran.size() == 2 && ran[0] == "shadow-atlas" && ran[1] == "scene",
              "a pass reached only through a dependency survives culling, and runs first");
        CHECK(d.bindLog.empty(), "and costs no texture unit, because nothing declared a read");
        CHECK(graph.pooledTargetCount() == 1, "the atlas is a pooled target like any other");

        // Lifetime has to count it too: an atlas whose last reader is not counted
        // would either be recycled while the scene still samples it, or held to
        // the end of the frame and paid for twice on the next camera.
        graph.begin(256, 128);
        const auto out2 = graph.importTarget(FramebufferHandle{9}, 256, 128);
        const auto maps2 = graph.createTarget(atlas);
        graph.addPass(fullscreen("shadow-atlas", {}, maps2));
        rg::PassDesc scene2 = fullscreen("scene", {}, out2);
        scene2.dependencies.push_back(maps2);
        graph.addPass(std::move(scene2));
        const auto after = graph.createTarget(atlas);
        graph.addPass(fullscreen("second-camera-atlas", {}, after));
        rg::PassDesc scene3 = fullscreen("scene-2", {}, out2);
        scene3.dependencies.push_back(after);
        graph.addPass(std::move(scene3));
        graph.execute();

        CHECK(d.createFramebufferCalls == 1,
              "the atlas goes back after the pass that names it, so the next one reuses it");
    }

    // --- the pool gives back what nothing asks for any more ---
    {
        MockGfxDevice d;
        rg::RenderGraph graph(d);

        // A frame with a blur chain: the scene, plus the half-size target it runs on.
        graph.begin(256, 256);
        const auto scene = graph.importTexture(TextureHandle{7}, 256, 256);
        const auto out = graph.importTarget(FramebufferHandle{9}, 256, 256);
        rg::TargetDesc half;
        half.scale = 0.5f;
        const auto small = graph.createTarget(half);
        graph.addPass(fullscreen("blur", {scene}, small));
        graph.addPass(fullscreen("composite", {small, scene}, out));
        graph.execute();

        CHECK(graph.pooledTargetCount() == 1, "the chain's target is pooled");
        CHECK(graph.pooledTargetBytes() == 128ull * 128ull * 4ull,
              "and a budget can read what it costs in bytes");

        // The effect is turned off. Nothing asks for a 128x128 target again.
        for (int frame = 0; frame < 121; ++frame) {
            graph.begin(256, 256);
            const auto sc = graph.importTexture(TextureHandle{7}, 256, 256);
            const auto o = graph.importTarget(FramebufferHandle{9}, 256, 256);
            graph.addPass(fullscreen("blit", {sc}, o));
            graph.execute();
        }

        CHECK(graph.pooledTargetCount() == 0,
              "a target nothing has asked for in 120 graphs goes back");
        CHECK(graph.pooledTargetBytes() == 0, "and stops being counted against the budget");
    }

    // --- ...but not one that is still being used ---
    {
        MockGfxDevice d;
        rg::RenderGraph graph(d);

        for (int frame = 0; frame < 200; ++frame) {
            graph.begin(256, 256);
            const auto scene = graph.importTexture(TextureHandle{7}, 256, 256);
            const auto out = graph.importTarget(FramebufferHandle{9}, 256, 256);
            const auto mid = graph.createTarget({});
            graph.addPass(fullscreen("blur", {scene}, mid));
            graph.addPass(fullscreen("blit", {mid}, out));
            graph.execute();
        }

        // The count alone would not catch a wrong eviction: evicted and
        // reallocated leaves a pool of one too. What it cost to get there is
        // the half that bites.
        CHECK(graph.pooledTargetCount() == 1, "a target asked for every graph is kept");
        CHECK(d.createFramebufferCalls == 1, "and never reallocated");
    }

    // --- a frame's chains share one pool, and something can hold across them ---
    {
        MockGfxDevice d;
        rg::TargetPool pool(d);
        rg::RenderGraph graph(d, pool);

        // What the shadow atlas is: borrowed before any chain runs and still
        // its own after two have. Deliberately the SHAPE A CHAIN WANTS — a
        // 2048² one no chain asks for could not be taken either way.
        rg::TargetShape held_shape;
        held_shape.width = 256;
        held_shape.height = 256;
        const rg::TargetHandle held = pool.acquire(held_shape);
        const FramebufferHandle heldFbo = pool.framebufferOf(held);
        CHECK(held != rg::kNoTarget && heldFbo != FramebufferHandle::Default,
              "a frame can borrow a target before any chain begins");

        FramebufferHandle chainFbo = FramebufferHandle::Default;
        for (int camera = 0; camera < 2; ++camera) {
            graph.begin(256, 256);
            const auto scene = graph.createExternalTarget({});
            chainFbo = graph.framebufferOf(scene);
            const auto out = graph.importTarget(FramebufferHandle{9}, 256, 256);
            graph.addPass(fullscreen("blit", {scene}, out));
            graph.execute();
        }

        CHECK(chainFbo != heldFbo,
              "a chain is never handed the target the frame is still holding");
        CHECK(pool.framebufferOf(held) == heldFbo,
              "which is still the frame's after two chains ran over the same pool");
        CHECK(pool.count() == 2, "the held one and the chains' own, not one per chain");

        // Given back at the end of the frame, it is a candidate again — which is
        // the whole difference from a framebuffer the frame keeps forever.
        pool.release(held);
        for (int tick = 0; tick < rg::TargetPool::kIdleTicksBeforeEvict; ++tick) pool.age();
        CHECK(pool.count() == 0, "and once given back it ages out like anything else");
    }

    // --- a handle outliving its target names nothing, not the next thing ---
    {
        MockGfxDevice d;
        rg::TargetPool pool(d);

        rg::TargetShape shape;
        shape.width = 128;
        shape.height = 128;
        const rg::TargetHandle held = pool.acquire(shape);
        CHECK(pool.holds(held), "a fresh handle names its target");

        // What a window resize does: reclaim everything, then hand the slot to
        // the next borrower. Without a generation the stale handle would name
        // the newcomer, and the frame would draw its shadows into a post target.
        pool.clear();
        CHECK(!pool.holds(held), "a handle whose target was dropped names nothing");
        CHECK(pool.framebufferOf(held) == FramebufferHandle::Default,
              "and answers with no framebuffer rather than someone else's");

        const rg::TargetHandle next = pool.acquire(shape);
        CHECK(next != held, "the refilled slot is a different handle");
        CHECK(!pool.holds(held) && pool.holds(next),
              "so the newcomer is reachable and the ghost still is not");
    }

    std::printf(g_failures == 0 ? "\nALL PASS\n" : "\n%d FAILURE(S)\n", g_failures);
    return g_failures == 0 ? 0 : 1;
}
