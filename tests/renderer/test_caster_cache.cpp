#include "MockGfxDevice.hpp"
#include "esengine/renderer/frame/RenderFrame.hpp"
#include "esengine/renderer/frame/RenderContext.hpp"
#include "esengine/renderer/frame/PostProcessPipeline.hpp"
#include "esengine/renderer/plugins/MeshPlugin.hpp"
#include "esengine/renderer/store/MaterialStore.hpp"
#include "esengine/resource/ResourceManager.hpp"
#include "esengine/ecs/Registry.hpp"
#include "esengine/ecs/components/Transform.hpp"
#include "esengine/ecs/components/MeshRenderer.hpp"
#include "esengine/ecs/components/Light.hpp"
#include "esengine/core/FrameProfiler.hpp"

#include <glm/gtc/matrix_transform.hpp>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <memory>
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

struct Vertex { f32 x, y, z, nx, ny, nz; };

resource::MeshHandle makeBox(resource::ResourceManager& resources) {
    const Vertex verts[8] = {
        {-1, -1, -1, 0, 1, 0}, {1, -1, -1, 0, 1, 0}, {1, 1, -1, 0, 1, 0}, {-1, 1, -1, 0, 1, 0},
        {-1, -1, 1, 0, 1, 0},  {1, -1, 1, 0, 1, 0},  {1, 1, 1, 0, 1, 0},  {-1, 1, 1, 0, 1, 0},
    };
    const u32 indices[36] = {0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1,
                             3, 2, 6, 3, 6, 7, 0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2};
    const GfxVertexAttribute channels[2] = {
        {0, 3, GfxDataType::Float, false, 0, 0},
        {2, 3, GfxDataType::Float, false, 12, 0},
    };
    return resources.createMesh(ConstSpan<u8>(reinterpret_cast<const u8*>(verts), sizeof(verts)), ConstSpan<u32>(indices, 36),
                                ConstSpan<GfxVertexAttribute>(channels, 2), sizeof(Vertex), glm::vec3(-1.0f), glm::vec3(1.0f),
                                MeshRecovery::HostOnly);
}

Entity spawnMesh(ecs::Registry& registry, resource::MeshHandle mesh, const glm::vec3& at, const glm::vec3& scale) {
    const Entity e = registry.create();
    ecs::Transform t;
    t.position = t.worldPosition = at;
    t.scale = t.worldScale = scale;
    registry.emplace<ecs::Transform>(e, t);
    ecs::MeshRenderer r;
    r.mesh = mesh;
    r.opaque = true;
    r.lit = true;
    r.castShadows = true;
    registry.emplace<ecs::MeshRenderer>(e, r);
    return e;
}

void moveTo(ecs::Registry& registry, Entity e, const glm::vec3& at) {
    auto& t = registry.patch<ecs::Transform>(e);
    t.position = t.worldPosition = at;
}

void place(ecs::Registry& registry, Entity e, const std::vector<glm::vec3>& spots) {
    auto& set = registry.patch<ecs::MeshInstances>(e);
    set.transforms.assign(spots.size() * 16, 0.0f);
    glm::vec3 lo = spots.front(), hi = spots.front();
    for (usize i = 0; i < spots.size(); ++i) {
        f32* r = set.transforms.data() + i * 16;
        r[0] = r[5] = r[10] = 1.0f;
        r[3] = spots[i].x;
        r[7] = spots[i].y;
        r[11] = spots[i].z;
        r[12] = r[13] = r[14] = r[15] = 1.0f;
        lo = glm::min(lo, spots[i]);
        hi = glm::max(hi, spots[i]);
    }
    set.originMin = lo;
    set.originMax = hi;
    set.maxScale = 1.0f;
}

glm::mat4 cameraAt(const glm::vec3& eye) {
    const glm::mat4 proj = glm::perspective(glm::radians(60.0f), 1.0f, 0.5f, 200.0f);
    return proj * glm::lookAt(eye, eye + glm::vec3(0.0f, -0.6f, -1.0f), glm::vec3(0.0f, 1.0f, 0.0f));
}

f64 counter(const char* name) {
    const std::string json = FrameProfiler::get().lastCountersJson();
    const std::string key = std::string("\"") + name + "\":";
    const usize at = json.find(key);
    return at == std::string::npos ? -1.0 : std::atof(json.c_str() + at + key.size());
}

void drawFrame(RenderFrame& frame, ecs::Registry& registry, const glm::mat4& vp) {
    frame.beginFrame();
    frame.begin(vp);
    frame.collectAll(registry, true);
    frame.end();
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
    frame.addPlugin(std::make_unique<MeshPlugin>());
    frame.init(kW, kH);
    FrameProfiler::get().setEnabled(true);

    const resource::ShaderHandle rainShader(0x7a11u);
    MaterialUniformLayout rain;
    rain.blockSize = 16;
    MaterialParamSlot shelter;
    shelter.name = "u_shelterRange";
    shelter.defaults[0] = 40.0f;
    rain.params.push_back(shelter);
    MaterialTextureSlot cover;
    cover.name = "u_rainCover";
    rain.textures.push_back(cover);
    context.materials().registerLayout(rainShader, rain);
    PostProcessPipeline* post = frame.postProcess();
    const bool coverOn = post != nullptr && [&] {
        post->addPass("rain", rainShader);
        post->setPassUniformFloat("rain", "u_shelterRange", 40.0f);
        return post->isEngaged() && post->coverWanted();
    }();

    const resource::MeshHandle box = makeBox(resources);
    spawnMesh(registry, box, glm::vec3(0.0f, -1.0f, -20.0f), glm::vec3(30.0f, 0.5f, 30.0f));
    const Entity still = spawnMesh(registry, box, glm::vec3(-4.0f, 1.0f, -20.0f), glm::vec3(1.0f));
    const Entity crate = spawnMesh(registry, box, glm::vec3(4.0f, 1.0f, -20.0f), glm::vec3(1.0f));
    const Entity plants = spawnMesh(registry, box, glm::vec3(0.0f, 0.0f, -18.0f), glm::vec3(0.3f));
    registry.emplace<ecs::MeshInstances>(plants);
    place(registry, plants, {{-2.0f, 0.0f, 0.0f}, {0.0f, 0.0f, 0.0f}, {2.0f, 0.0f, 0.0f}});

    const Entity sun = registry.create();
    ecs::Transform aim;
    aim.rotation = aim.worldRotation = glm::angleAxis(glm::radians(-60.0f), glm::vec3(1.0f, 0.0f, 0.0f));
    registry.emplace<ecs::Transform>(sun, aim);
    ecs::Light light;
    light.type = static_cast<i32>(ecs::LightType::Directional);
    light.meshShadows = true;
    registry.emplace<ecs::Light>(sun, light);

    const glm::mat4 vp = cameraAt(glm::vec3(0.0f, 8.0f, 0.0f));
    for (int i = 0; i < 4; ++i) drawFrame(frame, registry, vp);
    const auto settled = frame.casterCacheStats();
    const int shadowDraws = device.drawElementsInstancedCalls;
    CHECK(settled.shadowHeldBuilds >= 1, "the casters are collected into the held lists at least once");
    CHECK(shadowDraws > 0, "and something is drawn from them");

    const int texturesBefore = device.updateTextureCalls;
    for (int i = 0; i < 6; ++i) drawFrame(frame, registry, vp);
    const auto still6 = frame.casterCacheStats();
    CHECK(still6.shadowHeldBuilds == settled.shadowHeldBuilds, "a still scene rebuilds no held casters");
    CHECK(device.updateTextureCalls == texturesBefore, "and uploads no instance record it already holds");
    if (coverOn) {
        CHECK(still6.coverBuilds == settled.coverBuilds, "nor the rain cover's");
        CHECK(still6.coverDraws == settled.coverDraws && still6.coverKept >= settled.coverKept + 6,
              "and the rain cover map drawn before stands: it is not drawn again");
    }

    for (int i = 0; i < 8; ++i) {
        moveTo(registry, crate, glm::vec3(4.0f - 0.1f * static_cast<f32>(i), 1.0f, -20.0f));
        drawFrame(frame, registry, vp);
    }
    const auto bobbing = frame.casterCacheStats();
    const auto beforeBob = bobbing;
    for (int i = 0; i < 8; ++i) {
        moveTo(registry, crate, glm::vec3(3.0f + 0.1f * static_cast<f32>(i), 1.0f, -20.0f));
        drawFrame(frame, registry, vp);
    }
    const auto bobbed = frame.casterCacheStats();
    CHECK(bobbed.shadowHeldBuilds == beforeBob.shadowHeldBuilds,
          "a caster that moves every frame is collected on its own: the held casters are not rebuilt for it");
    CHECK(bobbed.shadowMoverCollects >= beforeBob.shadowMoverCollects + 8, "and it is collected every frame it moves");
    if (coverOn) {
        CHECK(bobbed.coverBuilds == beforeBob.coverBuilds, "the rain cover holds its casters through it too");
        CHECK(bobbed.coverMoverCollects >= beforeBob.coverMoverCollects + 8, "and collects the mover every frame");
    }

    moveTo(registry, still, glm::vec3(-5.0f, 1.0f, -20.0f));
    drawFrame(frame, registry, vp);
    const auto nudged = frame.casterCacheStats();
    CHECK(nudged.shadowHeldBuilds == bobbed.shadowHeldBuilds + 1, "a held caster moved once rebuilds the held casters");
    if (coverOn) {
        CHECK(nudged.coverBuilds == bobbed.coverBuilds + 1, "and the rain cover's");
        CHECK(nudged.coverDraws == bobbed.coverDraws + 1, "and the rain cover map is drawn again");
    }

    drawFrame(frame, registry, vp);
    const auto calm = frame.casterCacheStats();
    CHECK(calm.shadowHeldBuilds == nudged.shadowHeldBuilds, "and only once");

    registry.patch<ecs::MeshRenderer>(still).castShadows = false;
    drawFrame(frame, registry, vp);
    const auto unlit = frame.casterCacheStats();
    CHECK(unlit.shadowHeldBuilds == calm.shadowHeldBuilds + 1, "a held caster that stops casting rebuilds them");

    place(registry, plants, {{-2.0f, 0.0f, 1.0f}, {0.0f, 0.0f, 1.0f}, {2.0f, 0.0f, 1.0f}});
    drawFrame(frame, registry, vp);
    const auto replanted = frame.casterCacheStats();
    CHECK(replanted.shadowHeldBuilds == unlit.shadowHeldBuilds + 1, "placements written again rebuild them");
    registry.setChangeAudit(true);
    drawFrame(frame, registry, vp);
    CHECK(counter("render.mesh.proxy.stale") == 0.0, "a placement set kept between walks is what its placements derive now");
    CHECK(counter("render.shadow.heldStale") == 0.0, "the held casters are what a fresh collect gathers");
    registry.setChangeAudit(false);
    drawFrame(frame, registry, vp);
    const auto audited = frame.casterCacheStats();

    drawFrame(frame, registry, cameraAt(glm::vec3(0.0f, 8.0f, -1.0f)));
    const auto looked = frame.casterCacheStats();
    CHECK(looked.shadowHeldBuilds == audited.shadowHeldBuilds + 1, "a camera that moves rebuilds them");
    if (coverOn) CHECK(looked.coverBuilds == audited.coverBuilds + 1, "and the rain cover's, past a texel of its grid");

    CHECK(coverOn, "the rain cover was asked for, so its checks ran");
    FrameProfiler::get().setEnabled(false);
    frame.shutdown();
    resources.shutdown();
    std::printf(g_failures ? "\n%d check(s) failed\n" : "\nall checks passed\n", g_failures);
    return g_failures == 0 ? 0 : 1;
}
