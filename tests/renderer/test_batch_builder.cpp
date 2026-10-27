// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Unified submission face: BatchBuilder is the ONLY DrawCommand producer, and every
// stream (Batch quads, shape vertices, particle instances) routes through it. Drives
// pushBatchDraw / appendIndexedDraw / appendQuad against a real TransientBufferPool +
// DrawList over the MockGfxDevice and asserts the per-stream baseVertex math, the
// texture-slot rules, instanced command assembly, sort/merge behavior, clip stamping,
// and execute() dispatch — the invariants the per-plugin hand-rolled paths used to own.
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>

#include "MockGfxDevice.hpp"
#include "esengine/renderer/draw/BatchBuilder.hpp"
#include "esengine/renderer/draw/ImmediateDraw.hpp"
#include "esengine/renderer/draw/DrawList.hpp"
#include "esengine/renderer/store/MaterialStore.hpp"
#include "esengine/renderer/rhi/TransientBufferPool.hpp"
#include "esengine/renderer/frame/RenderFrame.hpp"
#include "esengine/renderer/frame/RenderContext.hpp"
#include "esengine/resource/ResourceManager.hpp"
#include "esengine/renderer/plugins/UIElementPlugin.hpp"
#include "esengine/renderer/plugins/TextPlugin.hpp"
#include "esengine/renderer/plugins/SpritePlugin.hpp"
#include "esengine/renderer/plugins/TilemapRenderPlugin.hpp"
#include "esengine/ecs/components/TilemapLayer.hpp"
#include "esengine/ecs/components/Sprite.hpp"
#include "esengine/ecs/components/BitmapText.hpp"
#include "esengine/ecs/components/UINode.hpp"
#include "esengine/ecs/components/UIVisual.hpp"
#include "esengine/ecs/components/UIMask.hpp"
#include "esengine/ecs/components/Interactable.hpp"
#include "esengine/ui/UISystem.hpp"
#include "esengine/ecs/FlatGeometry.hpp"
#include "esengine/ecs/TransformSystem.hpp"
#include "esengine/ecs/components/Hierarchy.hpp"

#include <functional>
#include <limits>
#include <utility>
#include <vector>

using namespace esengine;

TEST_CASE("presented primitives retain depth state and order until the scene pass") {
    MockGfxDevice device;
    std::vector<PipelineDesc> states;
    std::vector<u32> offsets;
    device.observeDrawElements = [&](const PipelineDesc& state, u32 offset) {
        states.push_back(state);
        offsets.push_back(offset);
    };
    RenderContext context(device);
    resource::ResourceManager resources;
    resources.init(device);
    ImmediateDraw draw(device, context, resources);
    draw.init();
    draw.begin(glm::mat4(1.0f), 800, 600);
    draw.deferBegin();
    const int uploads = device.updateBufferCalls;
    const auto line = [&] { draw.line({0, 0}, {10, 0}, {1, 0, 0, 1}, 2); };
    line();
    draw.setDepthState(false, false);
    line();
    draw.setDepthState(true, false);
    line();
    draw.setDepthState(false, true);
    CHECK(device.drawElementsCalls == 0);
    CHECK(device.updateBufferCalls == uploads);
    draw.deferEnd();
    CHECK(device.drawElementsCalls == 0);
    draw.flushDeferred();
    REQUIRE(states.size() == 3);
    CHECK_FALSE(states[0].depthTest);
    CHECK(states[0].depthWrite);
    CHECK_FALSE(states[1].depthTest);
    CHECK_FALSE(states[1].depthWrite);
    CHECK(states[2].depthTest);
    CHECK_FALSE(states[2].depthWrite);
    CHECK((offsets == std::vector<u32>{0, 6 * sizeof(u32), 12 * sizeof(u32)}));
    draw.flushDeferred();
    CHECK(device.drawElementsCalls == 3);
    draw.begin(glm::mat4(1.0f), 800, 600);
    line();
    draw.end();
    CHECK(device.drawElementsCalls == 4);
    CHECK(offsets.back() == 0);
    draw.shutdown();
    resources.shutdown();
}

namespace {

struct Harness {
    MockGfxDevice device;
    TransientBufferPool pool{device};
    DrawList list;
    ClipState clips;

    Harness() {
        pool.init(64 * 1024, 16 * 1024);
        pool.beginFrame();
    }
    ~Harness() { pool.shutdown(); }
};

struct NineSlicePlugin : UIElementPlugin {
    using BatchPlugin::emitNineSlice;
    using BatchPlugin::emitRadialFill;
};

BatchDrawKey quadKey(u32 textureId, i32 layer = 0) {
    BatchDrawKey key{};
    key.stage = RenderStage::Transparent;
    key.layer = layer;
    key.shaderId = 7;
    key.blend = BlendMode::Normal;
    key.textureId = textureId;
    key.type = RenderType::Sprite;
    return key;
}

// The 48-byte record the Shape stream is laid out for (mirrors ShapePlugin's format).
struct TestShapeVertex {
    f32 px, py, ux, uy;
    f32 cr, cg, cb, ca;
    f32 shapeType, halfW, halfH, cornerRadius;
};
static_assert(sizeof(TestShapeVertex) == 48, "shape record must match the Shape stream stride");

// The per-instance slot the ParticleInstance stream is laid out for (mirrors ParticlePlugin's).
struct TestParticleInstance {
    f32 px, py, pz;
    f32 sx, sy;
    f32 rotation;
    u32 color;
    f32 uvOffsetX, uvOffsetY;
    f32 uvScaleX, uvScaleY;
};
static_assert(sizeof(TestParticleInstance) == 44,
              "instance record must match the ParticleInstance stream stride");

}  // namespace

TEST_CASE("pool reports each stream's vertex stride (single source for baseVertex math)") {
    Harness h;
    CHECK(h.pool.vertexStride(LayoutId::Batch) == sizeof(BatchVertex));
    CHECK(h.pool.vertexStride(LayoutId::Shape) == sizeof(TestShapeVertex));
    CHECK(h.pool.vertexStride(LayoutId::ParticleInstance) == sizeof(TestParticleInstance));
}

TEST_CASE("tilemaps: rotation places cached quads and inverts distant chunk culling") {
    for (auto grid : {tilemap::GridType::Orthogonal, tilemap::GridType::Isometric,
                      tilemap::GridType::StaggeredIsometric, tilemap::GridType::Hexagonal}) {
        for (bool infinite : {false, true}) for (bool lazy : {false, true}) {
            Harness h;
            RenderContext context(h.device);
            resource::ResourceManager resources;
            resources.init(h.device);
            const u8 pixels[16 * 24 * 4] = {};
            const auto texture = resources.createTexture(resource::ResourceContent::Retained,
                16, 24, pixels, TextureFormat::RGBA8);
            ecs::Registry registry;
            const auto entity = registry.create();
            auto& transform = registry.emplace<ecs::Transform>(entity);
            auto& component = registry.emplace<ecs::TilemapLayer>(entity);
            component.tileset = texture; component.tilesetColumns = 1;
            component.cellSize = {16, 24}; component.originOffset = {3, -2};
            tilemap::TilemapSystem system;
            if (infinite) system.initInfiniteLayer(entity, 16, 24);
            else system.initLayer(entity, 96, 16, 16, 24);
            system.setGridType(entity, grid); system.setHexParams(entity, 6, true, false);
            const i32 tx = infinite ? -33 : 64, ty = 2;
            system.setTile(entity, tx, ty, 1);
            f32 lx = 0, ly = 0;
            system.tileToWorld(entity, tx, ty, 0, 0, lx, ly);
            if (grid != tilemap::GridType::Isometric) { lx += 8; ly -= 12; }
            const glm::vec3 localCenter{lx + 3, ly - 2, 0}, origin{20, 30, 0};
            Frustum frustum;
            RenderFrameContext frameContext{context, resources};
            RenderCollectContext collect{registry, frustum, h.clips, h.pool, h.list, frameContext, {}};
            TilemapRenderPlugin plugin; plugin.setTilemapSystem(&system); plugin.init(frameContext);
            const auto revision = system.getLayerData(entity)->edit_revision;
            for (f32 angle : {0.0f, .37f, glm::half_pi<f32>(), glm::pi<f32>(), -glm::half_pi<f32>()}) {
                const auto rotation = glm::angleAxis(angle, glm::vec3{0, 0, 1});
                transform.worldPosition = origin; transform.worldRotation = rotation;
                transform.cachedMatrix_ = glm::translate(glm::mat4{1}, origin) * glm::mat4_cast(rotation);
                transform.decomposed_ = !lazy;
                const auto center = origin + rotation * localCenter;
                const auto projection = glm::ortho(center.x - 4, center.x + 4, center.y - 4, center.y + 4);
                frustum.extractFromMatrix(projection); collect.camera = computeCameraView(projection);
                h.pool.beginFrame(); h.list.clear(); plugin.collect(collect);
                REQUIRE(h.pool.vertexBytesUsed(LayoutId::Batch) == 4 * sizeof(BatchVertex));
                const auto* vertices = reinterpret_cast<const BatchVertex*>(h.pool.vertexData(LayoutId::Batch));
                const glm::vec3 offsets[] = {{-8, -12, 0}, {8, -12, 0}, {8, 12, 0}, {-8, 12, 0}};
                for (u32 i = 0; i < 4; ++i) {
                    const auto expected = origin + rotation * (localCenter + offsets[i]);
                    CHECK(std::abs(vertices[i].position.x - expected.x) < .002f);
                    CHECK(std::abs(vertices[i].position.y - expected.y) < .002f);
                }
                CHECK(system.getLayerData(entity)->edit_revision == revision);
            }
            resources.shutdown();
        }
    }
}

TEST_CASE("appendQuad: Batch command with baseVertex-offset indices and one texture slot") {
    Harness h;
    BatchVertex quad[4] = {
        { {0, 0, 0}, 0xFFFFFFFFu, {0, 0} },
        { {1, 0, 0}, 0xFFFFFFFFu, {1, 0} },
        { {1, 1, 0}, 0xFFFFFFFFu, {1, 1} },
        { {0, 1, 0}, 0xFFFFFFFFu, {0, 1} },
    };
    appendQuad(h.pool, h.list, h.clips, quad, quadKey(42));
    appendQuad(h.pool, h.list, h.clips, quad, quadKey(42));

    REQUIRE(h.list.commandCount() == 2);
    const DrawCommand& first = h.list.command(0);
    const DrawCommand& second = h.list.command(1);
    CHECK(first.layout_id == LayoutId::Batch);
    CHECK(first.index_count == 6);
    CHECK(first.vertex_count == 4);
    CHECK(first.texture_count == 1);
    CHECK(first.texture_ids[0] == 42);
    CHECK(first.instance_count == 0);
    // Second quad's vertices start at record 4, so its indices must be rebased there.
    CHECK(second.vertex_byte_offset == 4 * sizeof(BatchVertex));
    CHECK(second.index_offset == 6);
}

TEST_CASE("empty scissor regions allocate no quad geometry or draw command") {
    for (const auto size : {std::pair{0, 20}, std::pair{20, 0}, std::pair{-1, 20}}) {
        Harness h;
        BatchVertex quad[4] = {};
        auto blocked = quadKey(42); blocked.entity = Entity(91);
        h.clips.setScissor(91, 10, 20, size.first, size.second);
        h.clips.setStencilTestOutside(91, 3);
        appendQuad(h.pool, h.list, h.clips, quad, blocked);
        auto visible = quadKey(42); visible.entity = Entity(92);
        appendQuad(h.pool, h.list, h.clips, quad, visible);
        REQUIRE(h.list.commandCount() == 1);
        CHECK(h.list.command(0).entity == Entity(92));
        CHECK(h.list.command(0).vertex_byte_offset == 0);
        CHECK(h.list.command(0).index_offset == 0);
    }
}

TEST_CASE("empty scissors suppress direct and prebuilt-vertex submissions") {
    Harness h;
    auto blocked = quadKey(42); blocked.entity = Entity(91);
    h.clips.setScissor(91, 0, 0, 0, 0);
    pushBatchDraw(h.list, h.clips, 0, 4, 0, 6, blocked);
    const u32 indices[] = {0, 1, 2, 2, 3, 0};
    pushBatchCommand(h.pool, h.list, h.clips, 0, 4, indices, 6, blocked);
    CHECK(h.list.commandCount() == 0);
    BatchVertex quad[4] = {};
    auto visible = quadKey(42); visible.entity = Entity(92);
    appendQuad(h.pool, h.list, h.clips, quad, visible);
    REQUIRE(h.list.commandCount() == 1);
    CHECK(h.list.command(0).index_offset == 0);
}

TEST_CASE("stencil-only entries and nonempty scissors still draw") {
    Harness h;
    BatchVertex quad[4] = {};
    auto stencil = quadKey(42); stencil.entity = Entity(91);
    h.clips.setStencilMask(91, 1);
    appendQuad(h.pool, h.list, h.clips, quad, stencil);
    auto clipped = quadKey(42); clipped.entity = Entity(92);
    h.clips.setScissor(92, 10, 20, 1, 1);
    appendQuad(h.pool, h.list, h.clips, quad, clipped);
    CHECK(h.list.commandCount() == 2);
}

TEST_CASE("appendIndexedDraw: non-Batch stream uses its own stride for baseVertex") {
    Harness h;
    TestShapeVertex verts[4] = {};
    BatchDrawKey key = quadKey(0);
    key.type = RenderType::Shape;
    key.layoutId = LayoutId::Shape;

    appendIndexedDraw(h.pool, h.list, h.clips, verts, 4, BATCH_QUAD_INDICES, 6, key);
    appendIndexedDraw(h.pool, h.list, h.clips, verts, 4, BATCH_QUAD_INDICES, 6, key);

    REQUIRE(h.list.commandCount() == 2);
    CHECK(h.list.command(0).layout_id == LayoutId::Shape);
    // A textureless draw must not claim a sampler slot: texture_count is what
    // execute() binds, and zero of them is what "declares no sampler" looks like.
    CHECK(h.list.command(0).texture_count == 0);
    CHECK(h.list.command(1).vertex_byte_offset == 4 * sizeof(TestShapeVertex));
    // Indices rebased by the SHAPE stride (4 records), not the Batch stride.
    CHECK(h.list.command(1).index_offset == 6);
    CHECK(h.pool.vertexBytesUsed(LayoutId::Shape) == 8 * sizeof(TestShapeVertex));
    CHECK(h.pool.indicesUsed(LayoutId::Shape) == 12);
}

TEST_CASE("pushBatchDraw: instanced key assembles an instanced command over static indices") {
    Harness h;
    u32 instOffset = h.pool.allocVertices(LayoutId::ParticleInstance, 3 * 40);
    BatchDrawKey key = quadKey(42);  // type tag irrelevant here (stats/capture only)
    key.layoutId = LayoutId::ParticleInstance;
    key.instanceCount = 3;

    pushBatchDraw(h.list, h.clips, instOffset, 0, 0, 6, key);

    REQUIRE(h.list.commandCount() == 1);
    const DrawCommand& cmd = h.list.command(0);
    CHECK(cmd.layout_id == LayoutId::ParticleInstance);
    CHECK(cmd.instance_count == 3);
    CHECK(cmd.index_offset == 0);
    CHECK(cmd.index_count == 6);
    CHECK(cmd.texture_count == 1);
    CHECK(cmd.texture_ids[0] == 42);
}

TEST_CASE("finalize: adjacent same-key Batch draws with different textures merge multi-texture") {
    Harness h;
    BatchVertex quad[4] = {
        { {0, 0, 0}, 0xFFFFFFFFu, {0, 0} },
        { {1, 0, 0}, 0xFFFFFFFFu, {1, 0} },
        { {1, 1, 0}, 0xFFFFFFFFu, {1, 1} },
        { {0, 1, 0}, 0xFFFFFFFFu, {0, 1} },
    };
    appendQuad(h.pool, h.list, h.clips, quad, quadKey(42));
    appendQuad(h.pool, h.list, h.clips, quad, quadKey(43));

    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 1);
    const DrawCommand& merged = h.list.command(0);
    CHECK(merged.index_count == 12);
    CHECK(merged.texture_count == 2);
    CHECK(merged.texture_ids[0] == 42);
    CHECK(merged.texture_ids[1] == 43);
    // The second quad's staged vertices got their sampler slot stamped to 1.
    const auto* verts = reinterpret_cast<const BatchVertex*>(h.pool.vertexData(LayoutId::Batch));
    CHECK(verts[3].texIndex == 0.0f);
    CHECK(verts[4].texIndex == 1.0f);
    CHECK(verts[7].texIndex == 1.0f);
}

TEST_CASE("finalize: sorted Batch index gaps merge in painter order with their texture slots") {
    Harness h;
    BatchVertex quad[4] = {};
    appendQuad(h.pool, h.list, h.clips, quad, quadKey(10, 3));
    appendQuad(h.pool, h.list, h.clips, quad, quadKey(11, 1));
    appendQuad(h.pool, h.list, h.clips, quad, quadKey(12, 2));
    h.list.finalize(h.pool);
    REQUIRE(h.list.mergedDrawCallCount() == 1);
    const auto& cmd = h.list.command(0);
    REQUIRE(cmd.index_count == 18);
    const u32 expected[] = {4,5,6,6,7,4, 8,9,10,10,11,8, 0,1,2,2,3,0};
    const auto* indices = h.pool.indexData(LayoutId::Batch) + cmd.index_offset;
    for (u32 i = 0; i < 18; i++) CHECK(indices[i] == expected[i]);
    REQUIRE(cmd.texture_count == 3);
    CHECK(cmd.texture_ids[0] == 11);
    CHECK(cmd.texture_ids[1] == 12);
    CHECK(cmd.texture_ids[2] == 10);
    const auto* verts = reinterpret_cast<const BatchVertex*>(h.pool.vertexData(LayoutId::Batch));
    CHECK(verts[0].texIndex == 2);
    CHECK(verts[4].texIndex == 0);
    CHECK(verts[8].texIndex == 1);
}

TEST_CASE("camera mask: hidden text and skeletal submissions upload no geometry") {
    MockGfxDevice device;
    RenderContext context(device);
    resource::ResourceManager resources;
    RenderFrame frame(device, context, resources);
    frame.init(64, 64);
    const glm::mat4 transform(1.0f);
    const f32 text[36] = {};
    const f32 skeletal[32] = {};
    const u16 indices[] = {0, 1, 2, 2, 3, 0};
    frame.begin(transform);
    frame.setCullingMask(1u << 6);
    const int uploads = device.updateBufferCalls;
    for (u32 i = 0; i < 1000; ++i) {
        frame.submitTextBatch(text, 4, indices, 6, 1, &transform[0][0], Entity(1), 4, 0, false);
        frame.submitSkeletalBatch(skeletal, 4, indices, 6, 1, 0, &transform[0][0], Entity(2), 4, 0, 0, false);
    }
    frame.flush();
    CHECK(frame.stats().draw_calls == 0);
    CHECK(device.updateBufferCalls == uploads);
    frame.end();
    frame.begin(transform);
    frame.setCullingMask(1u << 6);
    frame.submitTextBatch(text, 4, indices, 6, 1, &transform[0][0], Entity(1), 4, 0, false, 1u << 6);
    frame.submitSkeletalBatch(skeletal, 4, indices, 6, 1, 0, &transform[0][0], Entity(2), 6, 0, 0, false);
    frame.flush();
    CHECK(frame.stats().sprites == 0);
    CHECK(frame.stats().text == 1);
    CHECK(frame.stats().skeletal == 1);
    CHECK(frame.stats().triangles == 4);
}

TEST_CASE("sprites: affine parents preserve every draw mode and mirrored tile grid") {
    for (auto mode : {ecs::SpriteDrawMode::Simple, ecs::SpriteDrawMode::NineSlice, ecs::SpriteDrawMode::Tiled}) {
        for (bool parented : {false, true}) for (bool mirror : {false, true}) for (bool capped : {false, true}) {
            if (capped && mode != ecs::SpriteDrawMode::Tiled) continue;
            Harness h;
            RenderContext context(h.device);
            resource::ResourceManager resources;
            resources.init(h.device);
            const u8 pixels[16 * 16 * 4] = {};
            const auto texture = resources.createTexture(resource::ResourceContent::Retained, 16, 16,
                                                         pixels, TextureFormat::RGBA8);
            resource::TextureMetadata metadata;
            metadata.sliceBorder = {2, 2, 2, 2};
            resources.setTextureMetadata(texture, metadata);
            ecs::Registry registry;
            const auto parent = registry.create(), entity = registry.create();
            if (parented) registry.emplace<ecs::Parent>(entity).entity = parent;
            auto& transform = registry.emplace<ecs::Transform>(entity);
            const auto matrix = glm::scale(glm::mat4(1), glm::vec3(parented ? 2 : 1, 1, 1))
                                    * glm::translate(glm::mat4(1), glm::vec3(4, -7, 0))
                                    * glm::mat4_cast(glm::angleAxis(.7f, glm::vec3(0, 0, 1)))
                                    * glm::scale(glm::mat4(1), glm::vec3(mirror ? -3 : 3, 2, 1));
            if (parented) {
                transform.cachedMatrix_ = matrix;
                transform.decomposed_ = false;
            } else {
                // Childless roots intentionally leave cachedMatrix_ untouched.
                transform.worldPosition = {4, -7, 0};
                transform.worldRotation = glm::angleAxis(.7f, glm::vec3(0, 0, 1));
                transform.worldScale = {mirror ? -3 : 3, 2, 1};
                transform.decomposed_ = true;
            }
            auto& sprite = registry.emplace<ecs::Sprite>(entity);
            sprite.texture = texture;
            sprite.size = {20, 30};
            sprite.pivot = {.25f, .75f};
            sprite.tileSize = capped ? glm::vec2(.01f) : glm::vec2(4, 5);
            sprite.drawMode = mode;
            Frustum frustum;
            frustum.extractFromMatrix(glm::ortho(-500.0f, 500.0f, -500.0f, 500.0f));
            RenderFrameContext frameContext{context, resources};
            RenderCollectContext collect{registry, frustum, h.clips, h.pool, h.list, frameContext, {}};
            SpritePlugin plugin;
            plugin.init(frameContext);
            plugin.collect(collect);
            const auto* vertices = reinterpret_cast<const BatchVertex*>(h.pool.vertexData(LayoutId::Batch));
            const u32 count = h.pool.vertexBytesUsed(LayoutId::Batch) / sizeof(BatchVertex);
            CHECK(count > 0);
            const auto inverse = glm::inverse(matrix);
            f32 area = 0;
            for (u32 i = 0; i < count; ++i) {
                const auto local = glm::vec3(inverse * glm::vec4(vertices[i].position, 1));
                CHECK(local.x >= -5.001f);
                CHECK(local.x <= 15.001f);
                CHECK(local.y >= -22.501f);
                CHECK(local.y <= 7.501f);
                if (i % 4 == 0) {
                    const auto a = vertices[i+1].position - vertices[i].position;
                    const auto b = vertices[i+3].position - vertices[i].position;
                    area += std::abs(a.x * b.y - a.y * b.x);
                }
            }
            CHECK(area == doctest::Approx(parented ? 7200 : 3600).epsilon(.0001));
            // A camera touching the actual transformed corner must not cull it.
            const auto corner = glm::vec3(matrix * glm::vec4(-5, -22.5f, 0, 1));
            frustum.extractFromMatrix(glm::ortho(corner.x - .1f, corner.x + .1f,
                                                corner.y - .1f, corner.y + .1f));
            h.pool.beginFrame();
            h.list.clear();
            plugin.collect(collect);
            CHECK(h.pool.vertexBytesUsed(LayoutId::Batch) > 0);
            for (auto zeroAxis : {0, 1}) {
                sprite.size[zeroAxis] = 0;
                h.pool.beginFrame();
                h.list.clear();
                plugin.collect(collect);
                CHECK(h.pool.vertexBytesUsed(LayoutId::Batch) == 0);
                sprite.size = {20, 30};
            }
            resources.shutdown();
        }
    }
}

TEST_CASE("UI visuals: affine parents preserve box-local geometry and fill edges") {
    for (auto type : {ecs::UIVisualType::SolidColor, ecs::UIVisualType::Image,
                      ecs::UIVisualType::NineSlice, ecs::UIVisualType::Tiled, ecs::UIVisualType::Filled}) {
        for (bool mirror : {false, true}) for (bool radial : {false, true}) {
            if (radial && type != ecs::UIVisualType::Filled) continue;
            Harness h;
            RenderContext context(h.device);
            resource::ResourceManager resources;
            resources.init(h.device);
            const u8 pixels[16 * 16 * 4] = {};
            const auto texture = resources.createTexture(resource::ResourceContent::Retained,
                                                         16, 16, pixels, TextureFormat::RGBA8);
            ecs::Registry registry;
            const auto parent = registry.create(), entity = registry.create();
            registry.emplace<ecs::Parent>(entity).entity = parent;
            auto& transform = registry.emplace<ecs::Transform>(entity);
            transform.cachedMatrix_ = glm::scale(glm::mat4(1), glm::vec3(2, 1, 1))
                                    * glm::translate(glm::mat4(1), glm::vec3(4, -7, 0))
                                    * glm::mat4_cast(glm::angleAxis(.7f, glm::vec3(0, 0, 1)))
                                    * glm::scale(glm::mat4(1), glm::vec3(mirror ? -3 : 3, 2, 1));
            transform.decomposed_ = false;
            registry.emplace<ecs::UINode>(entity).computed_size_ = {20, 30};
            auto& visual = registry.emplace<ecs::UIVisual>(entity);
            visual.texture = texture;
            visual.visualType = type;
            visual.sliceBorder = {2, 2, 2, 2};
            visual.fillAmount = .5f;
            visual.fillMethod = radial ? ecs::UIFillMethod::Radial360 : ecs::UIFillMethod::Horizontal;
            visual.fillOrigin = radial ? ecs::UIFillOrigin::Top : ecs::UIFillOrigin::Left;
            Frustum frustum;
            frustum.extractFromMatrix(glm::ortho(-500.0f, 500.0f, -500.0f, 500.0f));
            RenderFrameContext frameContext{context, resources};
            RenderCollectContext collect{registry, frustum, h.clips, h.pool, h.list, frameContext, {}};
            UIElementPlugin plugin;
            plugin.init(frameContext);
            plugin.collect(collect);
            const u32 count = h.pool.vertexBytesUsed(LayoutId::Batch) / sizeof(BatchVertex);
            CHECK(count > 0);
            const auto* vertices = reinterpret_cast<const BatchVertex*>(h.pool.vertexData(LayoutId::Batch));
            const auto inverse = glm::inverse(transform.cachedMatrix_);
            for (u32 i = 0; i < count; ++i) {
                const auto local = glm::vec3(inverse * glm::vec4(vertices[i].position, 1));
                CHECK(local.x >= -10.001f);
                CHECK(local.x <= 10.001f);
                CHECK(local.y >= -15.001f);
                CHECK(local.y <= 15.001f);
                if (type == ecs::UIVisualType::Filled) {
                    if (radial) CHECK(local.x >= -.001f);
                    else CHECK(local.x <= .001f);
                }
            }
            const auto corner = glm::vec3(transform.cachedMatrix_ * glm::vec4(-10, 15, 0, 1));
            frustum.extractFromMatrix(glm::ortho(corner.x-.1f, corner.x+.1f, corner.y-.1f, corner.y+.1f));
            h.pool.beginFrame();
            h.list.clear();
            plugin.collect(collect);
            CHECK(h.pool.vertexBytesUsed(LayoutId::Batch) > 0);
            resources.shutdown();
        }
    }
}

TEST_CASE("radial fills: signed boxes mirror positions while retaining sampled UVs") {
    for (f32 x : {1.0f, -1.0f}) for (f32 y : {1.0f, -1.0f}) {
        Harness original, reflected;
        NineSlicePlugin plugin;
        const glm::vec3 center{13, 17, 0};
        plugin.emitRadialFill(original.pool, original.list, original.clips,
                             center, {20, 30}, 0, 1.5707963f, 3.1415927f,
                             {.2f, .3f}, {.4f, .5f}, {1, 1, 1, 1}, quadKey(1));
        plugin.emitRadialFill(reflected.pool, reflected.list, reflected.clips,
                             center, {20*x, 30*y}, 0, 1.5707963f, 3.1415927f,
                             {.2f, .3f}, {.4f, .5f}, {1, 1, 1, 1}, quadKey(1));
        REQUIRE(original.pool.vertexBytesUsed(LayoutId::Batch) > 0);
        REQUIRE(reflected.pool.vertexBytesUsed(LayoutId::Batch) == original.pool.vertexBytesUsed(LayoutId::Batch));
        const auto* a = reinterpret_cast<const BatchVertex*>(original.pool.vertexData(LayoutId::Batch));
        const auto* b = reinterpret_cast<const BatchVertex*>(reflected.pool.vertexData(LayoutId::Batch));
        for (u32 i = 0; i < original.pool.vertexBytesUsed(LayoutId::Batch) / sizeof(BatchVertex); ++i) {
            CHECK(b[i].position.x == doctest::Approx(center.x + (a[i].position.x-center.x)*x));
            CHECK(b[i].position.y == doctest::Approx(center.y + (a[i].position.y-center.y)*y));
            CHECK(b[i].texCoord == a[i].texCoord);
        }
    }
}

TEST_CASE("UI and sprite picking: parent shear follows authored local bounds") {
    for (bool uiNode : {false, true}) for (bool mirror : {false, true}) {
        ecs::Registry registry;
        const auto parent = registry.create(), entity = registry.create();
        registry.emplace<ecs::Canvas>(parent);
        registry.emplace<ecs::Transform>(parent);
        registry.emplace<ecs::UINode>(parent).computed_size_ = {200, 200};
        registry.emplace<ecs::Children>(parent).entities.push_back(entity);
        registry.emplace<ecs::Parent>(entity).entity = parent;
        auto& transform = registry.emplace<ecs::Transform>(entity);
        transform.cachedMatrix_ = glm::scale(glm::mat4(1), glm::vec3(2, 1, 1))
                                * glm::translate(glm::mat4(1), glm::vec3(4, -7, 0))
                                * glm::mat4_cast(glm::angleAxis(.7f, glm::vec3(0, 0, 1)))
                                * glm::scale(glm::mat4(1), glm::vec3(mirror ? -3 : 3, 2, 1));
        transform.decomposed_ = false;
        registry.emplace<ecs::Interactable>(entity);
        if (uiNode) registry.emplace<ecs::UINode>(entity).computed_size_ = {20, 30};
        else registry.emplace<ecs::Sprite>(entity).size = {20, 30};
        ecs::UISystem ui;
        ui.tree.rebuild(registry);
        for (const glm::vec2 local : {glm::vec2(9, 14), {-9, -14}, {11, 0}, {0, 16}}) {
            const auto point = glm::vec3(transform.cachedMatrix_ * glm::vec4(local, 0, 1));
            const bool inside = std::abs(local.x) < 10 && std::abs(local.y) < 15;
            ui.hitTestUpdate(registry, ecs::PickRay{{point.x, point.y, 100}, {0, 0, -1}}, nullptr);
            CHECK((ui.hitResult.hit_entity == entity) == inside);
            if (uiNode) CHECK((ui.pick(registry, point.x, point.y) == entity.id()) == inside);
        }
        const auto child = registry.create();
        registry.emplace<ecs::Parent>(child).entity = entity;
        if (!uiNode) registry.emplace<ecs::UINode>(entity).computed_size_ = {20, 30};
        registry.emplace<ecs::UIMask>(entity);
        for (const glm::vec2 local : {glm::vec2(9, 14), {-9, -14}, {11, 0}, {0, 16}}) {
            const auto point = glm::vec3(transform.cachedMatrix_ * glm::vec4(local, 0, 1));
            CHECK(ecs::isClippedByMask(registry, child, point.x, point.y)
                  == (std::abs(local.x) > 10 || std::abs(local.y) > 15));
        }
    }
}

TEST_CASE("UI scissor: affine corners determine the projected clip rectangle") {
    MockGfxDevice device;
    RenderContext context(device);
    resource::ResourceManager resources;
    ecs::Registry registry;
    RenderFrame frame(device, context, resources);
    frame.init(200, 200);
    const auto parent = registry.create(), mask = registry.create(), child = registry.create();
    registry.emplace<ecs::Parent>(mask).entity = parent;
    registry.emplace<ecs::Children>(mask).entities.push_back(child);
    registry.emplace<ecs::Parent>(child).entity = mask;
    auto& transform = registry.emplace<ecs::Transform>(mask);
    transform.cachedMatrix_ = glm::scale(glm::mat4(1), glm::vec3(2, 1, 1))
                            * glm::mat4_cast(glm::angleAxis(.7f, glm::vec3(0, 0, 1)));
    transform.decomposed_ = false;
    registry.emplace<ecs::UINode>(mask).computed_size_ = {20, 30};
    registry.emplace<ecs::UIMask>(mask).mode = ecs::MaskMode::Scissor;
    const auto half = glm::abs(glm::vec3(transform.cachedMatrix_[0])) * 10.0f
                    + glm::abs(glm::vec3(transform.cachedMatrix_[1])) * 15.0f;
    const std::array<i32, 4> expected{static_cast<i32>(std::round(100-half.x)),
                                     static_cast<i32>(std::round(100-half.y)),
                                     static_cast<i32>(std::round(2*half.x)),
                                     static_cast<i32>(std::round(2*half.y))};
    const f32 vertices[36] = {};
    const u16 indices[] = {0, 1, 2, 2, 3, 0};
    const glm::mat4 identity(1);
    frame.beginFrame();
    frame.begin(glm::ortho(-100.0f, 100.0f, -100.0f, 100.0f));
    frame.processMasks(registry, 0, 0, 200, 200);
    frame.collectAll(registry);
    frame.submitTextBatch(vertices, 4, indices, 6, 1, &identity[0][0], child, 0, 0, false);
    frame.flush();
    frame.end();
    CHECK(std::find(device.scissorRectangles.begin(), device.scissorRectangles.end(), expected)
          != device.scissorRectangles.end());
    frame.endFrame();
}

TEST_CASE("flat geometry: collapsed parent bases skip uploads and recover") {
    for (bool ui : {false, true}) {
        for (u32 mode = 0; mode < (ui ? 5u : 3u); ++mode) {
            Harness h;
            RenderContext context(h.device);
            resource::ResourceManager resources;
            resources.init(h.device);
            const u8 pixels[16 * 16 * 4] = {};
            const auto texture = resources.createTexture(resource::ResourceContent::Retained,
                                                         16, 16, pixels, TextureFormat::RGBA8);
            resource::TextureMetadata metadata;
            metadata.sliceBorder = {2, 2, 2, 2};
            resources.setTextureMetadata(texture, metadata);
            ecs::Registry registry;
            const auto parent = registry.create(), entity = registry.create();
            registry.emplace<ecs::Parent>(entity).entity = parent;
            auto& transform = registry.emplace<ecs::Transform>(entity);
            transform.cachedMatrix_[0] = {1, 1, 0, 0};
            transform.cachedMatrix_[1] = {.5f, .5f, 0, 0};
            if (ui) {
                registry.emplace<ecs::UINode>(entity).computed_size_ = {20, 30};
                auto& visual = registry.emplace<ecs::UIVisual>(entity);
                visual.texture = texture;
                visual.visualType = static_cast<ecs::UIVisualType>(mode + 1);
                visual.fillMethod = ecs::UIFillMethod::Radial360;
            } else {
                auto& sprite = registry.emplace<ecs::Sprite>(entity);
                sprite.size = {20, 30};
                sprite.tileSize = {10, 10};
                sprite.texture = texture;
                const ecs::SpriteDrawMode modes[] = {ecs::SpriteDrawMode::Simple,
                    ecs::SpriteDrawMode::NineSlice, ecs::SpriteDrawMode::Tiled};
                sprite.drawMode = modes[mode];
            }
            Frustum frustum;
            frustum.extractFromMatrix(glm::ortho(-500.0f, 500.0f, -500.0f, 500.0f));
            RenderFrameContext frameContext{context, resources};
            RenderCollectContext collect{registry, frustum, h.clips, h.pool, h.list, frameContext, {}};
            UIElementPlugin uiPlugin;
            SpritePlugin spritePlugin;
            uiPlugin.init(frameContext);
            spritePlugin.init(frameContext);
            for (bool collapsed : {true, false, true}) {
                transform.cachedMatrix_[1] = collapsed ? glm::vec4(.5f, .5f, 0, 0) : glm::vec4(.5f, -.5f, 0, 0);
                transform.decomposed_ = false;
                h.pool.beginFrame();
                h.list.clear();
                if (ui) uiPlugin.collect(collect);
                else spritePlugin.collect(collect);
                CHECK((h.pool.vertexBytesUsed(LayoutId::Batch) == 0) == collapsed);
                CHECK((h.pool.indicesUsed(LayoutId::Batch) == 0) == collapsed);
            }
            resources.shutdown();
        }
    }
}

TEST_CASE("UI masks: collapsed parent bases clip the complete subtree") {
    for (auto mode : {ecs::MaskMode::Scissor, ecs::MaskMode::Stencil}) {
        MockGfxDevice device;
        RenderContext context(device);
        resource::ResourceManager resources;
        ecs::Registry registry;
        RenderFrame frame(device, context, resources);
        frame.init(64, 64);
        const auto parent = registry.create(), mask = registry.create(), child = registry.create();
        registry.emplace<ecs::Parent>(mask).entity = parent;
        registry.emplace<ecs::Children>(mask).entities.push_back(child);
        registry.emplace<ecs::Parent>(child).entity = mask;
        auto& transform = registry.emplace<ecs::Transform>(mask);
        transform.cachedMatrix_[0] = {1, 1, 0, 0};
        registry.emplace<ecs::UINode>(mask).computed_size_ = {20, 20};
        registry.emplace<ecs::UIMask>(mask).mode = mode;
        const f32 vertices[36] = {};
        const u16 indices[] = {0, 1, 2, 2, 3, 0};
        const glm::mat4 identity(1);
        for (bool collapsed : {true, false, true}) {
            transform.cachedMatrix_[1] = collapsed ? glm::vec4(.5f, .5f, 0, 0) : glm::vec4(.5f, -.5f, 0, 0);
            transform.decomposed_ = false;
            frame.beginFrame();
            frame.begin(glm::ortho(-32.0f, 32.0f, -32.0f, 32.0f));
            frame.processMasks(registry, 0, 0, 64, 64);
            frame.collectAll(registry);
            const auto uploads = device.updateBufferCalls;
            frame.submitTextBatch(vertices, 4, indices, 6, 1, &identity[0][0], child, 0, 0, false);
            frame.flush();
            frame.end();
            CHECK(frame.stats().text == (collapsed ? 0 : 1));
            if (collapsed) CHECK(device.updateBufferCalls == uploads);
            frame.endFrame();
        }
    }
}

TEST_CASE("flat geometry: tiny finite and tilted spans retain their area") {
    ecs::Transform transform;
    transform.cachedMatrix_[0] = {1, 1, 0, 0};
    transform.cachedMatrix_[1] = {.5f, .5f, 0, 0};
    CHECK_FALSE(ecs::hasFlatGeometryArea(transform, true));
    CHECK(ecs::hasFlatGeometryArea(transform, false));
    transform.cachedMatrix_[1].z = 1;
    CHECK(ecs::hasFlatGeometryArea(transform, true));
    transform.cachedMatrix_[0] = {1e-30f, 0, 0, 0};
    transform.cachedMatrix_[1] = {0, 1e-30f, 0, 0};
    CHECK(ecs::hasFlatGeometryArea(transform, true));
    transform.cachedMatrix_[1].y = std::numeric_limits<f32>::infinity();
    CHECK_FALSE(ecs::hasFlatGeometryArea(transform, true));
}

TEST_CASE("flat geometry: authored planar zero scales remain collapsed through rotation") {
    for (f32 angle : {0.0f, .4f, .7f}) {
        ecs::Registry registry;
        ecs::TransformSystem system;
        const auto parent = registry.create(), group = registry.create(), child = registry.create();
        auto& root = registry.emplace<ecs::Transform>(parent);
        root.scale.x = 0;
        root.rotation = glm::angleAxis(.7f, glm::vec3(0, 0, 1));
        auto& transform = registry.emplace<ecs::Transform>(child);
        transform.rotation = glm::angleAxis(angle, glm::vec3(0, 0, 1));
        ecs::setParent(registry, group, parent);
        ecs::setParent(registry, child, group);
        system.ensureComposed(registry);
        CHECK_FALSE(ecs::hasFlatGeometryArea(registry, child, transform));
        CHECK_FALSE(ecs::pointInTransformedBox(registry, child, transform, 0, 0, 20, 30, .5f, .5f));
        registry.get<ecs::Transform>(parent).scale.x = 1;
        ecs::invalidateTransformComposition();
        system.ensureComposed(registry);
        CHECK(ecs::hasFlatGeometryArea(registry, child, transform));
        CHECK(ecs::pointInTransformedBox(registry, child, transform, 0, 0, 20, 30, .5f, .5f));
        registry.get<ecs::Transform>(parent).scale.x = 0;
        transform.rotation = glm::angleAxis(.5f, glm::vec3(0, 1, 0));
        ecs::invalidateTransformComposition();
        system.ensureComposed(registry);
        CHECK(ecs::hasFlatGeometryArea(registry, child, transform));
        ecs::setParent(registry, child, INVALID_ENTITY);
        system.ensureComposed(registry);
        CHECK(ecs::hasFlatGeometryArea(registry, child, transform));
    }
}

TEST_CASE("flat geometry: deep collapsed groups propagate and recover in one traversal") {
    ecs::Registry registry;
    ecs::TransformSystem system;
    const auto root = registry.create();
    registry.emplace<ecs::Transform>(root).scale.x = 0;
    auto parent = root;
    for (u32 i = 0; i < 50000; ++i) {
        const auto child = registry.create();
        registry.emplace<ecs::Parent>(child).entity = parent;
        registry.emplace<ecs::Children>(parent).entities.push_back(child);
        parent = child;
    }
    auto& transform = registry.emplace<ecs::Transform>(parent);
    transform.rotation = glm::angleAxis(.4f, glm::vec3(0, 0, 1));
    system.ensureComposed(registry);
    CHECK_FALSE(ecs::hasFlatGeometryArea(registry, parent, transform));
    registry.get<ecs::Transform>(root).scale.x = 1;
    ecs::invalidateTransformComposition();
    system.ensureComposed(registry);
    CHECK(ecs::hasFlatGeometryArea(registry, parent, transform));
    CHECK(registry.entitiesWith<ecs::FlatGeometryCollapsed>().empty());
}

TEST_CASE("bitmap text: collapsed parent bases skip long glyph runs and recover") {
    Harness h;
    RenderContext context(h.device);
    resource::ResourceManager resources;
    resources.init(h.device);
    const u8 pixels[16 * 16 * 4] = {};
    const auto texture = resources.createTexture(resource::ResourceContent::Retained,
                                                 16, 16, pixels, TextureFormat::RGBA8);
    const auto font = resources.createBitmapFont(
        "common lineHeight=16 base=12 scaleW=16 scaleH=16 pages=1\n"
        "char id=65 x=0 y=0 width=8 height=16 xoffset=0 yoffset=0 xadvance=10 page=0 chnl=15\n",
        texture, 16, 16);
    REQUIRE(font.isValid());
    ecs::Registry registry;
    const auto parent = registry.create(), entity = registry.create();
    registry.emplace<ecs::Parent>(entity).entity = parent;
    auto& transform = registry.emplace<ecs::Transform>(entity);
    transform.cachedMatrix_[0] = {1, 1, 0, 0};
    auto& text = registry.emplace<ecs::BitmapText>(entity);
    text.font = font;
    text.text = std::string(65536, 'A');
    Frustum frustum;
    frustum.extractFromMatrix(glm::ortho(-1e7f, 1e7f, -1e7f, 1e7f));
    RenderFrameContext frameContext{context, resources};
    RenderCollectContext collect{registry, frustum, h.clips, h.pool, h.list, frameContext, {}};
    TextPlugin plugin;
    plugin.init(frameContext);
    for (bool collapsed : {true, false, true}) {
        transform.cachedMatrix_[1] = collapsed ? glm::vec4(.5f, .5f, 0, 0) : glm::vec4(.5f, -.5f, 0, 0);
        transform.decomposed_ = false;
        h.pool.beginFrame();
        h.list.clear();
        plugin.collect(collect);
        CHECK(h.pool.vertexBytesUsed(LayoutId::Batch) == (collapsed ? 0 : 65536 * 4 * sizeof(BatchVertex)));
        CHECK(h.pool.indicesUsed(LayoutId::Batch) == (collapsed ? 0 : 65536 * 6));
    }
    resources.shutdown();
}

TEST_CASE("text transform bridge: full parent basis and childless root TRS reach the caller") {
    ecs::Registry registry;
    const auto parent = registry.create(), child = registry.create();
    registry.emplace<ecs::Parent>(child).entity = parent;
    auto& transform = registry.emplace<ecs::Transform>(child);
    transform.cachedMatrix_[0] = {2, 1, 0, 0};
    transform.cachedMatrix_[1] = {3, 4, 0, 0};
    transform.cachedMatrix_[3] = {13, 17, 0, 1};
    transform.decomposed_ = false;
    glm::mat4 output(9);
    CHECK(ecs::copyFlatRenderMatrix(registry, child, output));
    CHECK(output == transform.cachedMatrix_);
    registry.emplace<ecs::FlatGeometryCollapsed>(child);
    const auto retained = output;
    CHECK_FALSE(ecs::copyFlatRenderMatrix(registry, child, output));
    CHECK(output == retained);
    CHECK_FALSE(ecs::copyFlatRenderMatrix(registry, INVALID_ENTITY, output));
    const auto root = registry.create();
    auto& rootTransform = registry.emplace<ecs::Transform>(root);
    rootTransform.worldPosition = {4, 7, 2};
    rootTransform.worldScale = {-2, 3, 4};
    rootTransform.worldRotation = glm::angleAxis(.7f, glm::vec3(0, 1, 0));
    CHECK(ecs::copyFlatRenderMatrix(registry, root, output));
    CHECK(output == math::compose(rootTransform.worldPosition, rootTransform.worldRotation, rootTransform.worldScale));
    CHECK(rootTransform.cachedMatrix_ == glm::mat4(1));
}

TEST_CASE("sprites: tile budget applies before integer conversion") {
    struct Case { glm::vec2 tile, spacing; u32 quads; };
    const Case cases[] = {
        {{1e-20f, 1}, {}, 1},
        {{1, 1e-20f}, {}, 1},
        {{std::numeric_limits<f32>::denorm_min(), 1}, {}, 1},
        {{1e-20f, 1e-20f}, {}, 1},
        {{1, 1}, {}, 16384},
        {{.5f, 1}, {}, 1},
        {{1, 1}, {-1, 0}, 0},
        {{1, 1}, {std::numeric_limits<f32>::quiet_NaN(), 0}, 0},
        {{1, 1}, {std::numeric_limits<f32>::infinity(), 0}, 0},
    };
    for (const auto& item : cases) {
        Harness h;
        RenderContext context(h.device);
        resource::ResourceManager resources;
        resources.init(h.device);
        ecs::Registry registry;
        const auto entity = registry.create();
        auto& transform = registry.emplace<ecs::Transform>(entity);
        transform.worldScale = {1, 1, 1};
        transform.decomposed_ = true;
        auto& sprite = registry.emplace<ecs::Sprite>(entity);
        sprite.size = {128, 128};
        sprite.tileSize = item.tile;
        sprite.tileSpacing = item.spacing;
        sprite.drawMode = ecs::SpriteDrawMode::Tiled;
        Frustum frustum;
        frustum.extractFromMatrix(glm::ortho(-500.0f, 500.0f, -500.0f, 500.0f));
        RenderFrameContext frameContext{context, resources};
        RenderCollectContext collect{registry, frustum, h.clips, h.pool, h.list, frameContext, {}};
        SpritePlugin plugin;
        plugin.init(frameContext);
        plugin.collect(collect);
        CHECK(h.pool.vertexBytesUsed(LayoutId::Batch) == item.quads * 4 * sizeof(BatchVertex));
        const auto* vertices = reinterpret_cast<const BatchVertex*>(h.pool.vertexData(LayoutId::Batch));
        bool finite = true;
        for (u32 i = 0; i < h.pool.vertexBytesUsed(LayoutId::Batch) / sizeof(BatchVertex); ++i) {
            finite = finite && std::isfinite(vertices[i].position.x) && std::isfinite(vertices[i].position.y);
        }
        CHECK(finite);
        resources.shutdown();
    }
}

TEST_CASE("bitmap text: world geometry follows affine transforms and parallax") {
    for (u32 kind : {0u, 1u, 2u}) {
        const bool alignedEdge = kind == 1, rootWithoutMatrix = kind == 2;
        Harness h;
        RenderContext context(h.device);
        resource::ResourceManager resources;
        resources.init(h.device);
        const u8 pixels[16 * 16 * 4] = {};
        const auto texture = resources.createTexture(resource::ResourceContent::Retained, 16, 16,
                                                     pixels, TextureFormat::RGBA8);
        REQUIRE(texture.isValid());
        const auto font = resources.createBitmapFont(
            "common lineHeight=16 base=12 scaleW=16 scaleH=16 pages=1\n"
            "char id=65 x=0 y=0 width=8 height=16 xoffset=2 yoffset=1 xadvance=10 page=0 chnl=15\n",
            texture, 16, 16);
        REQUIRE(font.isValid());
        ecs::Registry registry;
        const auto entity = registry.create();
        auto& transform = registry.emplace<ecs::Transform>(entity);
        auto& text = registry.emplace<ecs::BitmapText>(entity);
        text.font = font;
        text.text = "A";
        glm::mat4 projection;
        if (alignedEdge) {
            text.align = ecs::TextAlign::Right;
            transform.cachedMatrix_ = glm::translate(glm::mat4(1), glm::vec3(7, 0, 0));
            projection = glm::ortho(-1.0f, 1.0f, -20.0f, 20.0f);
        } else if (rootWithoutMatrix) {
            transform.worldPosition = {4, -7, 0};
            transform.worldRotation = glm::angleAxis(.7f, glm::vec3(0, 0, 1));
            transform.worldScale = {-2, 3, 1};
            text.parallax = {.5f, .25f};
            projection = glm::ortho(-100.0f, 100.0f, -100.0f, 100.0f);
        } else {
            const auto parent = registry.create();
            registry.emplace<ecs::Parent>(entity).entity = parent;
            registry.emplace<ecs::Children>(parent).entities.push_back(entity);
            transform.cachedMatrix_ = glm::scale(glm::mat4(1), glm::vec3(2, 1, 1))
                                    * glm::translate(glm::mat4(1), glm::vec3(4, -7, 0))
                                    * glm::mat4_cast(glm::angleAxis(.7f, glm::vec3(0, 0, 1)))
                                    * glm::scale(glm::mat4(1), glm::vec3(-2, 3, 1));
            text.parallax = {.5f, .25f};
            projection = glm::ortho(-100.0f, 100.0f, -100.0f, 100.0f);
        }
        transform.decomposed_ = rootWithoutMatrix;
        Frustum frustum;
        frustum.extractFromMatrix(projection);
        RenderFrameContext frameContext{context, resources};
        RenderCollectContext collect{registry, frustum, h.clips, h.pool, h.list, frameContext, {}};
        collect.camera.center = {10, 20};
        TextPlugin plugin;
        plugin.init(frameContext);
        plugin.collect(collect);
        REQUIRE(h.pool.vertexBytesUsed(LayoutId::Batch) == 4 * sizeof(BatchVertex));
        CHECK(h.pool.indicesUsed(LayoutId::Batch) == 6);
        const auto* vertices = reinterpret_cast<const BatchVertex*>(h.pool.vertexData(LayoutId::Batch));
        const glm::vec2 local[] = {{2, -5}, {10, -5}, {10, 11}, {2, 11}};
        for (u32 i = 0; i < 4; ++i) {
            const auto matrix = rootWithoutMatrix
                ? glm::translate(glm::mat4(1), transform.worldPosition) * glm::mat4_cast(transform.worldRotation)
                  * glm::scale(glm::mat4(1), transform.worldScale)
                : transform.cachedMatrix_;
            const glm::vec3 origin = glm::vec3(matrix * glm::vec4(local[i].x - (alignedEdge ? 10 : 0), local[i].y, 0, 1));
            const auto expected = origin + glm::vec3(collect.camera.center * (glm::vec2(1) - text.parallax), 0);
            CHECK(vertices[i].position.x == doctest::Approx(expected.x));
            CHECK(vertices[i].position.y == doctest::Approx(expected.y));
        }
        resources.shutdown();
    }
}

TEST_CASE("bitmap text: UTF-8 strings retain every glyph beyond 64 KiB") {
    for (u32 length : {65535u, 65536u, 65537u, 65539u}) {
        Harness h;
        RenderContext context(h.device);
        resource::ResourceManager resources;
        resources.init(h.device);
        const u8 pixels[16 * 16 * 4] = {};
        const auto texture = resources.createTexture(resource::ResourceContent::Retained, 16, 16,
                                                     pixels, TextureFormat::RGBA8);
        const auto font = resources.createBitmapFont(
            "common lineHeight=16 base=16 scaleW=16 scaleH=16 pages=1\n"
            "char id=65 x=0 y=0 width=8 height=16 xoffset=0 yoffset=0 xadvance=8 page=0 chnl=15\n"
            "char id=128512 x=8 y=0 width=8 height=16 xoffset=0 yoffset=0 xadvance=8 page=0 chnl=15\n",
            texture, 16, 16);
        REQUIRE(font.isValid());
        ecs::Registry registry;
        const auto entity = registry.create();
        registry.emplace<ecs::Transform>(entity);
        auto& text = registry.emplace<ecs::BitmapText>(entity);
        text.font = font;
        text.align = ecs::TextAlign::Right;
        text.text = length == 65539 ? std::string(65534, 'A') + "\xf0\x9f\x98\x80" + "A" : std::string(length, 'A');
        const u32 glyphs = length == 65539 ? 65536 : length;
        Frustum frustum;
        frustum.extractFromMatrix(glm::ortho(-1000000.0f, 1000000.0f, -32.0f, 32.0f));
        RenderFrameContext frameContext{context, resources};
        RenderCollectContext collect{registry, frustum, h.clips, h.pool, h.list, frameContext, {}};
        TextPlugin plugin;
        plugin.init(frameContext);
        plugin.collect(collect);
        CHECK(h.pool.vertexBytesUsed(LayoutId::Batch) == glyphs * 4 * sizeof(BatchVertex));
        CHECK(h.pool.indicesUsed(LayoutId::Batch) == glyphs * 6);
        if (h.pool.vertexBytesUsed(LayoutId::Batch) == glyphs * 4 * sizeof(BatchVertex)) {
            const auto* vertices = reinterpret_cast<const BatchVertex*>(h.pool.vertexData(LayoutId::Batch));
            CHECK(vertices[0].position.x == doctest::Approx(-8.0f * glyphs));
            CHECK(vertices[glyphs * 4 - 2].position.x == doctest::Approx(0));
            CHECK(h.pool.indexData(LayoutId::Batch)[glyphs * 6 - 2] == glyphs * 4 - 1);
        }
        h.pool.beginFrame();
        h.list.clear();
        frustum.extractFromMatrix(glm::ortho(-16.0f, 0.0f, -32.0f, 32.0f));
        plugin.collect(collect);
        CHECK(h.pool.vertexBytesUsed(LayoutId::Batch) == 3 * 4 * sizeof(BatchVertex));
        CHECK(h.pool.indicesUsed(LayoutId::Batch) == 18);
        if (h.pool.vertexBytesUsed(LayoutId::Batch) == 3 * 4 * sizeof(BatchVertex)) {
            const auto* vertices = reinterpret_cast<const BatchVertex*>(h.pool.vertexData(LayoutId::Batch));
            CHECK(vertices[10].position.x == doctest::Approx(0));
            CHECK(h.pool.indexData(LayoutId::Batch)[16] == 11);
        }
        h.pool.beginFrame();
        h.list.clear();
        frustum.extractFromMatrix(glm::ortho(-520.0f, -504.0f, -32.0f, 32.0f));
        plugin.collect(collect);
        CHECK(h.pool.vertexBytesUsed(LayoutId::Batch) == 4 * 4 * sizeof(BatchVertex));
        CHECK(h.pool.indicesUsed(LayoutId::Batch) == 24);
        if (h.pool.vertexBytesUsed(LayoutId::Batch) == 4 * 4 * sizeof(BatchVertex)) {
            const auto* vertices = reinterpret_cast<const BatchVertex*>(h.pool.vertexData(LayoutId::Batch));
            CHECK(vertices[0].position.x == doctest::Approx(-528));
            CHECK(vertices[14].position.x == doctest::Approx(-496));
        }
        resources.shutdown();
    }
}

TEST_CASE("UI masks: deep grouping hierarchies reach their leaf without call-stack recursion") {
    for (auto mode : {ecs::MaskMode::Scissor, ecs::MaskMode::Stencil}) {
        MockGfxDevice device;
        RenderContext context(device);
        resource::ResourceManager resources;
        ecs::Registry registry;
        RenderFrame frame(device, context, resources);
        frame.init(64, 64);
        const auto root = registry.create();
        registry.emplace<ecs::Transform>(root);
        registry.get<ecs::Transform>(root).worldRotation = glm::angleAxis(.7f, glm::vec3(0, 0, 1));
        registry.get<ecs::Transform>(root).worldScale.y = -1;
        auto& node = registry.emplace<ecs::UINode>(root);
        node.computed_size_ = {20, 20};
        registry.emplace<ecs::UIMask>(root).mode = mode;
        Entity leaf = root;
        for (u32 i = 0; i < 50000; ++i) {
            const auto child = registry.create();
            registry.emplace<ecs::Parent>(child).entity = leaf;
            registry.emplace<ecs::Children>(leaf).entities.push_back(child);
            leaf = child;
        }
        const glm::mat4 projection = glm::ortho(-32.0f, 32.0f, -32.0f, 32.0f);
        const glm::mat4 transform(1);
        const f32 text[36] = {};
        const u16 indices[] = {0, 1, 2, 2, 3, 0};
        for (bool empty : {true, false}) {
            node.computed_size_.x = empty ? 0 : 20;
            frame.beginFrame();
            frame.begin(projection);
            frame.processMasks(registry, 0, 0, 64, 64);
            frame.collectAll(registry);
            const int uploads = device.updateBufferCalls;
            frame.submitTextBatch(text, 4, indices, 6, 1, &transform[0][0], leaf, 0, 0, false);
            frame.flush();
            if (empty) {
                CHECK(frame.stats().text == 0);
                CHECK(device.updateBufferCalls == uploads);
            } else {
                CHECK(frame.stats().text == 1);
                CHECK(device.updateBufferCalls > uploads);
            }
            frame.end();
            frame.endFrame();
        }
    }
}

TEST_CASE("UI stencil traversal keeps nested and sibling references in authored order") {
    MockGfxDevice device;
    RenderContext context(device);
    resource::ResourceManager resources;
    ecs::Registry registry;
    RenderFrame frame(device, context, resources);
    frame.init(64, 64);
    const auto child = [&](Entity parent, bool mask) {
        const Entity entity = registry.create();
        if (parent != INVALID_ENTITY) {
            registry.emplace<ecs::Parent>(entity).entity = parent;
            if (!registry.has<ecs::Children>(parent)) registry.emplace<ecs::Children>(parent);
            registry.get<ecs::Children>(parent).entities.push_back(entity);
        }
        if (mask) registry.emplace<ecs::UIMask>(entity).mode = ecs::MaskMode::Stencil;
        return entity;
    };
    const Entity root = child(INVALID_ENTITY, true), a = child(root, false), nested = child(root, true);
    const Entity b = child(nested, false), deep = child(nested, true), c = child(deep, false);
    const Entity group = child(root, false), d = child(group, false), e = child(root, false);
    registry.emplace<ecs::Transform>(deep);
    auto& nestedBox = registry.emplace<ecs::UINode>(deep);
    nestedBox.computed_size_ = {20, 20};
    const glm::mat4 transform(1);
    const f32 text[36] = {};
    const u16 indices[] = {0, 1, 2, 2, 3, 0};
    for (u32 repeat = 0; repeat < 4; ++repeat) {
        const bool empty = repeat == 2;
        nestedBox.computed_size_.y = empty ? 0 : 20;
        device.stencilReferences.clear();
        frame.beginFrame();
        frame.begin(transform);
        frame.processMasks(registry, 0, 0, 64, 64);
        frame.collectAll(registry);
        i32 layer = 0;
        for (Entity entity : {root, a, nested, b, deep, c, d, e}) {
            frame.submitTextBatch(text, 4, indices, 6, 1, &transform[0][0], entity, layer++, 0, false);
        }
        frame.flush();
        frame.end();
        CHECK(frame.stats().text == (empty ? 6 : 8));
        const std::vector<i32> expected = empty
            ? std::vector<i32>{1, 1, 1, 2, 2, 1, 1}
            : std::vector<i32>{1, 1, 1, 2, 2, 3, 3, 2, 1, 1};
        CHECK(device.stencilReferences.size() == expected.size());
        for (u32 i = 0; i < std::min(device.stencilReferences.size(), expected.size()); ++i) {
            CHECK(device.stencilReferences[i] == expected[i]);
        }
        frame.endFrame();
    }
}

TEST_CASE("flat bounds: reflected extents enclose the same rotated box") {
    for (f32 x : {1.0f, -1.0f}) for (f32 y : {1.0f, -1.0f}) {
        for (f32 angle : {0.0f, .7f}) {
            const auto extent = flatHalfExtents({std::cos(angle), std::sin(angle)}, {3*x, 5*y, -2});
            CHECK(extent.x == doctest::Approx(std::abs(std::cos(angle))*3 + std::abs(std::sin(angle))*5));
            CHECK(extent.y == doctest::Approx(std::abs(std::sin(angle))*3 + std::abs(std::cos(angle))*5));
            CHECK(extent.z == 2);
        }
    }
}

TEST_CASE("UI stencil reference budget follows depth rather than sibling count") {
    MockGfxDevice device;
    RenderContext context(device);
    resource::ResourceManager resources;
    ecs::Registry registry;
    RenderFrame frame(device, context, resources);
    frame.init(64, 64);
    const Entity root = registry.create();
    registry.emplace<ecs::UIMask>(root).mode = ecs::MaskMode::Stencil;
    registry.emplace<ecs::Children>(root);
    std::vector<Entity> ordered{root};
    for (u32 i = 0; i < 300; ++i) {
        const Entity mask = registry.create(), content = registry.create();
        registry.emplace<ecs::Parent>(mask).entity = root;
        registry.emplace<ecs::Parent>(content).entity = mask;
        registry.get<ecs::Children>(root).entities.push_back(mask);
        registry.emplace<ecs::Children>(mask).entities.push_back(content);
        registry.emplace<ecs::UIMask>(mask).mode = ecs::MaskMode::Stencil;
        ordered.push_back(mask);
        ordered.push_back(content);
    }
    const glm::mat4 transform(1);
    const f32 text[36] = {};
    const u16 indices[] = {0, 1, 2, 2, 3, 0};
    frame.beginFrame();
    frame.begin(transform);
    frame.processMasks(registry, 0, 0, 64, 64);
    frame.collectAll(registry);
    i32 layer = 0;
    for (Entity entity : ordered) {
        frame.submitTextBatch(text, 4, indices, 6, 1, &transform[0][0], entity, layer++, 0, false);
    }
    frame.flush();
    frame.end();
    CHECK(frame.stats().text == 601);
    REQUIRE(device.stencilReferences.size() == 902);
    for (u32 i = 0; i < 300; ++i) {
        CHECK(device.stencilReferences[1 + i * 3] == 1);
        CHECK(device.stencilReferences[2 + i * 3] == 2);
        CHECK(device.stencilReferences[3 + i * 3] == 2);
    }
    frame.endFrame();
}

TEST_CASE("detached UI refreshes inherited state without relocating its geometry") {
    ecs::Registry registry;
    ecs::UISystem ui;
    const auto child = [&](Entity parent, bool node) {
        const Entity entity = registry.create();
        registry.emplace<ecs::Transform>(entity);
        if (node) registry.emplace<ecs::UINode>(entity);
        if (parent != INVALID_ENTITY) {
            registry.emplace<ecs::Parent>(entity).entity = parent;
            if (!registry.has<ecs::Children>(parent)) registry.emplace<ecs::Children>(parent);
            registry.get<ecs::Children>(parent).entities.push_back(entity);
        }
        return entity;
    };
    const Entity root = child(INVALID_ENTITY, true);
    registry.emplace<ecs::Canvas>(root);
    const Entity group = child(root, false), leaf = child(group, true);
    registry.get<ecs::UINode>(root).opacity = .5f;
    registry.get<ecs::UINode>(leaf).opacity = .5f;
    ui.layoutUpdate(registry, -100, -100, 100, 100, true);
    CHECK(registry.get<ecs::UINode>(leaf).alpha_in_tree_ == doctest::Approx(.25f));
    const auto position = registry.get<ecs::Transform>(leaf).position;
    const auto size = registry.get<ecs::UINode>(leaf).computed_size_;
    registry.remove<ecs::Canvas>(root);
    auto& parent = registry.get<ecs::UINode>(root);
    parent.display = ecs::UIDisplay::None;
    parent.pointerEvents = ecs::UIPointerEvents::None;
    ui.layoutUpdate(registry, -200, -200, 200, 200, true);
    CHECK(ui.tree.nodes_.empty());
    CHECK(parent.hidden_in_tree_);
    CHECK(registry.get<ecs::UINode>(leaf).hidden_in_tree_);
    CHECK(registry.get<ecs::UINode>(leaf).pointer_blocked_in_tree_);
    CHECK(registry.get<ecs::Transform>(leaf).position == position);
    CHECK(registry.get<ecs::UINode>(leaf).computed_size_ == size);
    parent.display = ecs::UIDisplay::Flex;
    parent.pointerEvents = ecs::UIPointerEvents::Auto;
    parent.opacity = .8f;
    ui.layoutUpdate(registry, -200, -200, 200, 200, false);
    CHECK_FALSE(registry.get<ecs::UINode>(leaf).hidden_in_tree_);
    CHECK_FALSE(registry.get<ecs::UINode>(leaf).pointer_blocked_in_tree_);
    CHECK(registry.get<ecs::UINode>(leaf).alpha_in_tree_ == doctest::Approx(.4f));
    registry.emplace<ecs::Canvas>(root);
    ui.layoutUpdate(registry, -100, -100, 100, 100, false);
    CHECK(ui.tree.nodes_.size() == 2);
    CHECK(registry.get<ecs::UINode>(leaf).alpha_in_tree_ == doctest::Approx(.4f));
}

TEST_CASE("detached UI state walks shared deep ancestry iteratively and recovers from reparenting") {
    ecs::Registry registry;
    ecs::UISystem ui;
    const Entity root = registry.create();
    auto& parent = registry.emplace<ecs::UINode>(root);
    parent.display = ecs::UIDisplay::None;
    parent.opacity = .5f;
    parent.pointerEvents = ecs::UIPointerEvents::None;
    Entity group = root;
    for (u32 i = 0; i < 50000; ++i) {
        const Entity next = registry.create();
        registry.emplace<ecs::Parent>(next).entity = group;
        group = next;
    }
    std::vector<Entity> leaves;
    for (u32 i = 0; i < 100; ++i) {
        const Entity leaf = registry.create();
        registry.emplace<ecs::Parent>(leaf).entity = group;
        registry.emplace<ecs::UINode>(leaf).opacity = .25f;
        leaves.push_back(leaf);
    }
    ui.layoutUpdate(registry, -100, -100, 100, 100, false);
    for (Entity leaf : leaves) {
        const auto& node = registry.get<ecs::UINode>(leaf);
        CHECK(node.hidden_in_tree_);
        CHECK(node.pointer_blocked_in_tree_);
        CHECK(node.alpha_in_tree_ == doctest::Approx(.125f));
    }
    const Entity visible = registry.create();
    registry.emplace<ecs::UINode>(visible).opacity = .8f;
    registry.get<ecs::Parent>(group).entity = visible;
    ui.layoutUpdate(registry, -100, -100, 100, 100, false);
    for (Entity leaf : leaves) {
        const auto& node = registry.get<ecs::UINode>(leaf);
        CHECK_FALSE(node.hidden_in_tree_);
        CHECK_FALSE(node.pointer_blocked_in_tree_);
        CHECK(node.alpha_in_tree_ == doctest::Approx(.2f));
    }
}

TEST_CASE("a Canvas inherits visibility and pointer policy from an ancestor outside its layout tree") {
    ecs::Registry registry;
    ecs::UISystem ui;
    ecs::TransformSystem transforms;
    const Entity parent = registry.create(), canvas = registry.create(), leaf = registry.create();
    registry.emplace<ecs::Transform>(parent).position = {13, 17, 0};
    registry.emplace<ecs::UINode>(parent).opacity = .5f;
    registry.get<ecs::UINode>(parent).pointerEvents = ecs::UIPointerEvents::None;
    registry.emplace<ecs::Children>(parent).entities.push_back(canvas);
    registry.emplace<ecs::Parent>(canvas).entity = parent;
    registry.emplace<ecs::Transform>(canvas);
    registry.emplace<ecs::UINode>(canvas);
    registry.emplace<ecs::Canvas>(canvas);
    registry.emplace<ecs::Children>(canvas).entities.push_back(leaf);
    registry.emplace<ecs::Parent>(leaf).entity = canvas;
    registry.emplace<ecs::Transform>(leaf);
    auto& node = registry.emplace<ecs::UINode>(leaf);
    node.width = {40, 0};
    node.height = {30, 0};
    node.opacity = .5f;
    registry.emplace<ecs::Interactable>(leaf);
    ui.layoutUpdate(registry, -100, -100, 100, 100, true);
    transforms.ensureComposed(registry);
    REQUIRE(ui.tree.nodes_.size() == 2);
    CHECK(node.alpha_in_tree_ == doctest::Approx(.25f));
    auto& transform = registry.get<ecs::Transform>(leaf);
    transform.ensureDecomposed();
    const auto position = transform.worldPosition;
    const ecs::PickRay ray{{position.x, position.y, 100}, {0, 0, -1}};
    ui.hitTestUpdate(registry, ray, nullptr);
    CHECK(ui.hitResult.hit_entity == INVALID_ENTITY);
    registry.get<ecs::UINode>(parent).pointerEvents = ecs::UIPointerEvents::Auto;
    ui.layoutUpdate(registry, -100, -100, 100, 100, false);
    ui.hitTestUpdate(registry, ray, nullptr);
    CHECK(ui.hitResult.hit_entity == leaf);
    registry.get<ecs::UINode>(parent).display = ecs::UIDisplay::None;
    ui.layoutUpdate(registry, -100, -100, 100, 100, false);
    ui.hitTestUpdate(registry, ray, nullptr);
    CHECK(ui.hitResult.hit_entity == INVALID_ENTITY);
}

TEST_CASE("nine-slice: small boxes contain their borders and preserve source UVs") {
    for (const glm::vec2 size : {glm::vec2{40, 30}, {10, 6}, {10, 30}, {40, 6}, {0, 6}, {10, 0}}) {
        Harness h;
        NineSlicePlugin plugin;
        const glm::vec3 position{13, 17, 0};
        const glm::vec2 pivot{.25f, .75f};
        plugin.emitNineSlice(h.pool, h.list, h.clips, position, size, pivot,
                            0, {100, 100}, {8, 12, 10, 6}, {0, 0}, {1, 1}, {1, 1, 1, 1}, quadKey(1));
        const u32 bytes = h.pool.vertexBytesUsed(LayoutId::Batch);
        if (size.x == 0 || size.y == 0) {
            CHECK(bytes == 0);
            CHECK(h.pool.indicesUsed(LayoutId::Batch) == 0);
            CHECK(h.list.commandCount() == 0);
            continue;
        }
        const auto* vertices = reinterpret_cast<const BatchVertex*>(h.pool.vertexData(LayoutId::Batch));
        const u32 count = bytes / sizeof(BatchVertex);
        REQUIRE(count > 0);
        const glm::vec2 low = glm::vec2(position) - size * pivot;
        const glm::vec2 high = low + size;
        f32 area = 0;
        bool hasLeftUV = false, hasRightUV = false, hasBottomUV = false, hasTopUV = false;
        for (u32 i = 0; i < count; ++i) {
            CHECK(vertices[i].position.x >= low.x - .0001f);
            CHECK(vertices[i].position.x <= high.x + .0001f);
            CHECK(vertices[i].position.y >= low.y - .0001f);
            CHECK(vertices[i].position.y <= high.y + .0001f);
            hasLeftUV |= std::abs(vertices[i].texCoord.x - .08f) < .0001f;
            hasRightUV |= std::abs(vertices[i].texCoord.x - .88f) < .0001f;
            hasBottomUV |= std::abs(vertices[i].texCoord.y - .06f) < .0001f;
            hasTopUV |= std::abs(vertices[i].texCoord.y - .90f) < .0001f;
            if (i % 4 == 0) area += (vertices[i + 1].position.x - vertices[i].position.x)
                                  * (vertices[i + 3].position.y - vertices[i].position.y);
        }
        CHECK(area == doctest::Approx(size.x * size.y));
        CHECK(hasLeftUV);
        CHECK(hasRightUV);
        CHECK(hasBottomUV);
        CHECK(hasTopUV);
    }
}

TEST_CASE("nine-slice: signed transforms and UV flips preserve every cell") {
    NineSlicePlugin plugin;
    const glm::vec3 position{13, 17, 0};
    const glm::vec2 pivot{.25f, .75f}, uvOffset{.2f, .1f}, uvScale{.6f, .8f};
    for (const glm::vec2 size : {glm::vec2{40, 30}, {10, 6}}) {
        Harness reference;
        plugin.emitNineSlice(reference.pool, reference.list, reference.clips, position, size, pivot,
                            0, {100, 100}, {8, 12, 10, 6}, uvOffset, uvScale, {1, 1, 1, 1}, quadKey(1));
        const u32 bytes = reference.pool.vertexBytesUsed(LayoutId::Batch);
        const auto* original = reinterpret_cast<const BatchVertex*>(reference.pool.vertexData(LayoutId::Batch));
        for (f32 signX : {1.0f, -1.0f}) for (f32 signY : {1.0f, -1.0f}) {
            for (f32 flipX : {1.0f, -1.0f}) for (f32 flipY : {1.0f, -1.0f}) {
                for (f32 angle : {0.0f, .4f}) {
                    Harness h;
                    const glm::vec2 offset = uvOffset + glm::vec2(flipX < 0 ? uvScale.x : 0, flipY < 0 ? uvScale.y : 0);
                    plugin.emitNineSlice(h.pool, h.list, h.clips, position, size * glm::vec2(signX, signY), pivot,
                                        angle, {100, 100}, {8, 12, 10, 6}, offset, uvScale * glm::vec2(flipX, flipY),
                                        {1, 1, 1, 1}, quadKey(1));
                    REQUIRE(h.pool.vertexBytesUsed(LayoutId::Batch) == bytes);
                    CHECK(h.pool.indicesUsed(LayoutId::Batch) == reference.pool.indicesUsed(LayoutId::Batch));
                    const auto* vertices = reinterpret_cast<const BatchVertex*>(h.pool.vertexData(LayoutId::Batch));
                    for (u32 i = 0; i < bytes / sizeof(BatchVertex); ++i) {
                        glm::vec2 local = glm::vec2(original[i].position) - glm::vec2(position);
                        if (flipX < 0) local.x = size.x * (1 - 2 * pivot.x) - local.x;
                        if (flipY < 0) local.y = size.y * (1 - 2 * pivot.y) - local.y;
                        local *= glm::vec2(signX, signY);
                        const glm::vec2 expected{position.x + local.x * std::cos(angle) - local.y * std::sin(angle),
                                                 position.y + local.x * std::sin(angle) + local.y * std::cos(angle)};
                        bool found = false;
                        for (u32 j = 0; j < bytes / sizeof(BatchVertex); ++j) {
                            found |= glm::length(glm::vec2(vertices[j].position) - expected) < .0001f
                                  && glm::length(vertices[j].texCoord - original[i].texCoord) < .0001f;
                        }
                        CHECK(found);
                    }
                }
            }
        }
    }
}

TEST_CASE("UI visuals: invisible and collapsed boxes skip geometry and recover") {
    enum class Hidden { OwnAlpha, InheritedAlpha, Width, Height, ScaleX, ScaleY };
    for (auto mode : {ecs::UIVisualType::SolidColor, ecs::UIVisualType::Image,
                      ecs::UIVisualType::NineSlice, ecs::UIVisualType::Tiled,
                      ecs::UIVisualType::Filled}) {
        for (auto hidden : {Hidden::OwnAlpha, Hidden::InheritedAlpha, Hidden::Width,
                            Hidden::Height, Hidden::ScaleX, Hidden::ScaleY}) {
            Harness h;
            RenderContext context(h.device);
            resource::ResourceManager resources;
            ecs::Registry registry;
            const auto entity = registry.create();
            registry.emplace<ecs::Transform>(entity);
            auto& node = registry.emplace<ecs::UINode>(entity);
            node.computed_size_ = {20, 20};
            auto& visual = registry.emplace<ecs::UIVisual>(entity);
            visual.visualType = mode;
            visual.sliceBorder = {2, 2, 2, 2};
            visual.fillMethod = ecs::UIFillMethod::Radial360;
            visual.fillAmount = .5f;
            auto& scale = registry.get<ecs::Transform>(entity).worldScale;
            switch (hidden) {
                case Hidden::OwnAlpha: visual.color.a = 0; break;
                case Hidden::InheritedAlpha: node.alpha_in_tree_ = 0; break;
                case Hidden::Width: node.computed_size_.x = 0; break;
                case Hidden::Height: node.computed_size_.y = 0; break;
                case Hidden::ScaleX: scale.x = 0; break;
                case Hidden::ScaleY: scale.y = 0; break;
            }
            RenderFrameContext frameContext{context, resources};
            frameContext.purpose = RenderPurpose::ScreenOverlay;
            std::unordered_set<u32> screen{entity.id()};
            Frustum frustum;
            RenderCollectContext collect{registry, frustum, h.clips, h.pool, h.list, frameContext, {}};
            collect.screen_ui = &screen;
            UIElementPlugin plugin;
            plugin.init(frameContext);
            plugin.collect(collect);
            CHECK(h.list.commandCount() == 0);
            CHECK(h.pool.vertexBytesUsed(LayoutId::Batch) == 0);
            CHECK(h.pool.indicesUsed(LayoutId::Batch) == 0);
            node.alpha_in_tree_ = .5f;
            visual.color.a = 1;
            node.computed_size_ = {20, 20};
            scale = {1, 1, 1};
            plugin.collect(collect);
            CHECK(h.list.commandCount() > 0);
            CHECK(h.pool.vertexBytesUsed(LayoutId::Batch) > 0);
            CHECK(h.pool.indicesUsed(LayoutId::Batch) > 0);
        }
    }
}

TEST_CASE("UI visuals: transparent stencil masks and custom materials retain geometry") {
    for (int kind : {0, 1, 2}) {
        Harness h;
        RenderContext context(h.device);
        resource::ResourceManager resources;
        ecs::Registry registry;
        const auto entity = registry.create();
        registry.emplace<ecs::Transform>(entity);
        auto& node = registry.emplace<ecs::UINode>(entity);
        node.computed_size_ = {20, 20};
        node.alpha_in_tree_ = 0;
        auto& visual = registry.emplace<ecs::UIVisual>(entity);
        visual.visualType = ecs::UIVisualType::SolidColor;
        if (kind == 0) visual.material = 42;
        if (kind == 1) registry.emplace<ecs::UIMask>(entity).mode = ecs::MaskMode::Stencil;
        if (kind == 2) h.clips.setStencilMask(entity.id(), 1);
        RenderFrameContext frameContext{context, resources};
        frameContext.purpose = RenderPurpose::ScreenOverlay;
        std::unordered_set<u32> screen{entity.id()};
        Frustum frustum;
        RenderCollectContext collect{registry, frustum, h.clips, h.pool, h.list, frameContext, {}};
        collect.screen_ui = &screen;
        UIElementPlugin plugin;
        plugin.init(frameContext);
        plugin.collect(collect);
        CHECK(h.list.commandCount() == 1);
        CHECK(h.pool.vertexBytesUsed(LayoutId::Batch) == 4 * sizeof(BatchVertex));
        CHECK(h.pool.indicesUsed(LayoutId::Batch) == 6);
    }
}

TEST_CASE("camera passes: empty text and skeletal clips recover on the next camera") {
    MockGfxDevice device;
    RenderContext context(device);
    resource::ResourceManager resources;
    ecs::Registry registry;
    RenderFrame frame(device, context, resources);
    frame.init(64, 64);
    const glm::mat4 transform(1.0f);
    const f32 text[36] = {};
    const f32 skeletal[32] = {};
    const u16 indices[] = {0, 1, 2, 2, 3, 0};
    for (const auto& size : {std::pair{0, 10}, std::pair{10, 0}, std::pair{-1, 10}, std::pair{10, -1}}) {
        frame.beginFrame();
        frame.begin(transform);
        frame.setEntityClipRect(1, 0, 0, size.first, size.second);
        frame.setEntityClipRect(2, 0, 0, size.first, size.second);
        frame.collectAll(registry);
        const int uploads = device.updateBufferCalls;
        frame.submitTextBatch(text, 4, indices, 6, 1, &transform[0][0], Entity(1), 0, 0, false);
        frame.submitSkeletalBatch(skeletal, 4, indices, 6, 1, 0, &transform[0][0], Entity(2), 0, 0, 0, false);
        frame.flush();
        CHECK(device.updateBufferCalls == uploads);
        CHECK(frame.stats().draw_calls == 0);
        frame.end();

        frame.begin(transform);
        frame.clearAllClipRects();
        frame.collectAll(registry);
        frame.submitTextBatch(text, 4, indices, 6, 1, &transform[0][0], Entity(1), 0, 0, false);
        frame.submitSkeletalBatch(skeletal, 4, indices, 6, 1, 0, &transform[0][0], Entity(2), 0, 0, 0, false);
        frame.flush();
        CHECK(frame.stats().text == 1);
        CHECK(frame.stats().skeletal == 1);
        CHECK(frame.stats().triangles == 4);
        frame.end();
        frame.endFrame();
    }
}

TEST_CASE("camera mask: excluded bulk geometry does not enter transient streams") {
    for (LayoutId layout : {LayoutId::Batch, LayoutId::Shape}) {
        Harness h;
        h.list.setCullingMask(1u << 6);
        auto hidden = quadKey(1, 4);
        hidden.layoutId = layout;
        BatchVertex quad[4] = {};
        TestShapeVertex shape[4] = {};
        const void* verts = layout == LayoutId::Batch ? static_cast<const void*>(quad)
                                                     : static_cast<const void*>(shape);
        for (u32 i = 0; i < 10000; ++i) {
            appendIndexedDraw(h.pool, h.list, h.clips, verts, 4, BATCH_QUAD_INDICES, 6, hidden);
        }
        CHECK(h.list.commandCount() == 0);
        CHECK(h.pool.vertexBytesUsed(layout) == 0);
        CHECK(h.pool.indicesUsed(layout) == 0);

        h.list.setSortingGroup(31, {6, 0, false, 0});
        hidden.entity = Entity(31);
        appendIndexedDraw(h.pool, h.list, h.clips, verts, 4, BATCH_QUAD_INDICES, 6, hidden);
        CHECK(h.list.commandCount() == 1);
        CHECK(h.pool.vertexBytesUsed(layout) == 4 * h.pool.vertexStride(layout));
        CHECK(h.pool.indicesUsed(layout) == 6);
    }
}

TEST_CASE("camera mask: resident geometry skips excluded indices with both source widths") {
    Harness h;
    h.list.setCullingMask(1u << 6);
    BatchVertex quad[4] = {};
    const u32 offset = h.pool.appendVertices(LayoutId::Batch, quad, sizeof(quad));
    const u16 indices16[] = {0, 1, 2, 2, 3, 0};
    auto hidden = quadKey(1, 4);
    pushBatchCommand(h.pool, h.list, h.clips, offset, 4, BATCH_QUAD_INDICES, 6, hidden);
    pushBatchCommand(h.pool, h.list, h.clips, offset, 4, indices16, 6, hidden);
    CHECK(h.pool.indicesUsed(LayoutId::Batch) == 0);
    CHECK(h.pool.vertexBytesUsed(LayoutId::Batch) == sizeof(quad));
    CHECK(h.list.commandCount() == 0);
    hidden.cullBit = 1u << 6;
    pushBatchCommand(h.pool, h.list, h.clips, offset, 4, indices16, 6, hidden);
    CHECK(h.pool.indicesUsed(LayoutId::Batch) == 6);
    CHECK(h.list.commandCount() == 1);
    auto excludedGroup = quadKey(1, 6);
    excludedGroup.entity = Entity(32);
    h.list.setSortingGroup(32, {4, 0, false, 0});
    appendQuad(h.pool, h.list, h.clips, quad, excludedGroup);
    auto excludedBit = quadKey(1, 6);
    excludedBit.cullBit = 1u << 4;
    appendQuad(h.pool, h.list, h.clips, quad, excludedBit);
    CHECK(h.pool.vertexBytesUsed(LayoutId::Batch) == sizeof(quad));
    CHECK(h.pool.indicesUsed(LayoutId::Batch) == 6);
    CHECK(h.list.commandCount() == 1);
    appendQuad(h.pool, h.list, h.clips, quad, quadKey(1, -1));
    CHECK(h.pool.indicesUsed(LayoutId::Batch) == 12);
    CHECK(h.list.commandCount() == 2);
}

TEST_CASE("finalize: full texture slots reject index copies but allow existing textures") {
    for (bool masked : {false, true}) {
        for (bool reuse : {false, true}) {
            Harness h;
            if (masked) {
                h.list.reserveMask2DSlots(1);
                h.list.setMask2DTexture(7, 123);
            }
            const u32 budget = MAX_CMD_TEXTURE_SLOTS - (masked ? 1 : 0);
            BatchVertex quad[4] = {};
            appendQuad(h.pool, h.list, h.clips, quad, quadKey(reuse ? 1 : 99, 2));
            for (u32 texture = 1; texture <= budget; ++texture) {
                appendQuad(h.pool, h.list, h.clips, quad, quadKey(texture, 1));
            }
            const u32 emitted = h.pool.indicesUsed(LayoutId::Batch);
            h.list.finalize(h.pool);
            CHECK(h.list.mergedDrawCallCount() == (reuse ? 1 : 2));
            CHECK(h.pool.indicesUsed(LayoutId::Batch) == emitted + (reuse ? 6 : 0));
            CHECK(h.list.command(0).texture_count == budget);
            CHECK(h.list.command(0).index_count == (budget + (reuse ? 1 : 0)) * 6);
            if (!reuse) {
                CHECK(h.list.command(1).index_offset == 0);
                CHECK(h.list.command(1).break_reason == BatchBreak::TextureSlots);
            }
        }
    }
}

TEST_CASE("index range copies survive staging growth and reject unwritten sources") {
    MockGfxDevice device;
    TransientBufferPool pool{device};
    pool.init(64, 2);
    const u32 values[] = {9,8,7,6,5,4};
    pool.appendIndices(LayoutId::Batch, values, 6);
    u32 at = 99;
    REQUIRE(pool.copyIndexRange(LayoutId::Batch, 0, 6, at));
    CHECK(at == 6);
    for (u32 i = 0; i < 6; i++) CHECK(pool.indexData(LayoutId::Batch)[at + i] == values[i]);
    CHECK_FALSE(pool.copyIndexRange(LayoutId::Batch, 12, 1, at));
    CHECK_FALSE(pool.copyIndexRange(LayoutId::Batch, 0, 13, at));
    CHECK(pool.indicesUsed(LayoutId::Batch) == 12);
    pool.shutdown();
}

TEST_CASE("finalize: mixed Sprite and Text runs preserve source type counts") {
    Harness h;
    BatchVertex quad[4] = {};
    auto sprite = quadKey(10, 2), text = quadKey(11, 1);
    text.type = RenderType::Text;
    appendQuad(h.pool, h.list, h.clips, quad, sprite);
    appendQuad(h.pool, h.list, h.clips, quad, text);
    h.list.finalize(h.pool);
    REQUIRE(h.list.mergedDrawCallCount() == 1);
    CHECK(h.list.sourceEntityCount(RenderType::Sprite) == 1);
    CHECK(h.list.sourceEntityCount(RenderType::Text) == 1);
    h.list.clear();
    CHECK(h.list.sourceEntityCount(RenderType::Sprite) == 0);
    CHECK(h.list.sourceEntityCount(RenderType::Text) == 0);
}

TEST_CASE("finalize: external Batch buffers retain their separate index ranges") {
    Harness h;
    BatchVertex quad[4] = {};
    appendQuad(h.pool, h.list, h.clips, quad, quadKey(10, 2));
    appendQuad(h.pool, h.list, h.clips, quad, quadKey(10, 1));
    auto a = h.list.command(0), b = h.list.command(1);
    a.vertex_buffer = b.vertex_buffer = static_cast<BufferHandle>(123);
    h.list.clear(); h.list.push(a); h.list.push(b);
    h.list.finalize(h.pool);
    CHECK(h.list.mergedDrawCallCount() == 2);
    CHECK(h.pool.indicesUsed(LayoutId::Batch) == 12);
}

TEST_CASE("merge identity: depth bias and geometry bindings must agree") {
    DrawCommand a{}, b{};
    a.shader_id = b.shader_id = 7;
    a.index_count = b.index_count = 6;
    b.index_offset = 6;
    CHECK(a.canMergeWith(b));
    SUBCASE("depth bias") {
        b.depth_bias = 1;
        CHECK_FALSE(a.canMergeWith(b));
    }
    SUBCASE("vertex buffer") {
        a.vertex_buffer = static_cast<BufferHandle>(11);
        b.vertex_buffer = static_cast<BufferHandle>(12);
        CHECK_FALSE(a.canMergeWith(b));
    }
    SUBCASE("index buffer") {
        a.index_buffer = static_cast<BufferHandle>(11);
        b.index_buffer = static_cast<BufferHandle>(12);
        CHECK_FALSE(a.canMergeWith(b));
    }
    SUBCASE("vertex layout") {
        a.vertex_layout = static_cast<VertexLayoutHandle>(11);
        b.vertex_layout = static_cast<VertexLayoutHandle>(12);
        CHECK_FALSE(a.canMergeWith(b));
    }
}

TEST_CASE("finalize: different streams never coalesce; instanced draws stay one per emitter") {
    Harness h;
    BatchVertex quad[4] = {};
    appendQuad(h.pool, h.list, h.clips, quad, quadKey(42));

    TestShapeVertex sverts[4] = {};
    BatchDrawKey shapeKey = quadKey(0);
    shapeKey.layoutId = LayoutId::Shape;
    appendIndexedDraw(h.pool, h.list, h.clips, sverts, 4, BATCH_QUAD_INDICES, 6, shapeKey);

    BatchDrawKey inst = quadKey(42);
    inst.layoutId = LayoutId::ParticleInstance;
    inst.instanceCount = 2;
    pushBatchDraw(h.list, h.clips, 0, 0, 0, 6, inst);
    pushBatchDraw(h.list, h.clips, 80, 0, 0, 6, inst);

    h.list.finalize(h.pool);
    // Batch quad + shape + two instanced draws: nothing merges across these.
    CHECK(h.list.mergedDrawCallCount() == 4);
}

/**
 * A resident-mesh draw as MeshPlugin submits one: the mesh's own buffers, one
 * per-object record in the frame's stream, opaque so its order does not matter.
 * `z` goes into the record so a test can see WHICH instances a merged draw holds.
 */
BatchDrawKey meshKey(u32 meshBuffer, u32 textureId = 0) {
    BatchDrawKey key{};
    key.stage = RenderStage::Opaque;
    key.shaderId = 11;
    key.blend = BlendMode::None;
    key.depthTest = true;
    key.depthWrite = true;
    key.textureId = textureId;
    key.type = RenderType::Mesh;
    key.layoutId = LayoutId::MeshInstance;
    key.instanceCount = 1;
    key.instanceStride = 68;
    key.vertexBuffer = BufferHandle{meshBuffer};
    key.indexBuffer = BufferHandle{meshBuffer + 100};
    // ONE layout for every mesh with these channels, which is what the resource
    // layer hands out: two meshes differ by their buffers, not by their shape.
    // A fixture giving each its own would let a missing buffer check pass.
    key.vertexLayout = VertexLayoutHandle{200};
    return key;
}

/** Submits one instance of `key`'s mesh, tagging its record with `mark`. */
u32 pushMeshInstance(Harness& h, const BatchDrawKey& key, f32 mark, f32 depth = 0.0f) {
    const u32 at = h.pool.allocVertices(LayoutId::MeshInstance, key.instanceStride);
    auto* rec = reinterpret_cast<f32*>(h.pool.vertexData(LayoutId::MeshInstance) + at);
    *rec = mark;
    BatchDrawKey k = key;
    k.depth = depth;
    pushBatchDraw(h.list, h.clips, at, 0, 0, 36, k);
    return at;
}

/** The mark each instance of a merged draw carries, read back from the stream. */
std::vector<f32> instanceMarks(Harness& h, const DrawCommand& cmd) {
    std::vector<f32> out;
    const u8* base = h.pool.vertexData(LayoutId::MeshInstance) + cmd.vertex_byte_offset;
    for (u32 i = 0; i < cmd.instance_count; ++i) {
        out.push_back(*reinterpret_cast<const f32*>(base + i * cmd.instance_stride));
    }
    return out;
}

TEST_CASE("finalize: the same mesh drawn three times is one instanced draw") {
    Harness h;
    BatchDrawKey key = meshKey(5);
    // Written 1,2,3, drawn nearest first (z=1000,10,1): marks 2,3,1, no two records adjacent
    // in the pool, which is why relocation is needed. A mesh's run keeps only the top of the
    // depth's exponent, so these sit in three different steps of it (below 2, to 512, above).
    pushMeshInstance(h, key, 1.0f, 1.0f);
    pushMeshInstance(h, key, 2.0f, 1000.0f);
    pushMeshInstance(h, key, 3.0f, 10.0f);

    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 1);
    const DrawCommand& cmd = h.list.command(0);
    CHECK(cmd.instance_count == 3);
    CHECK(cmd.index_count == 36);  // one mesh's indices, not three meshes' worth
    CHECK(cmd.entity_count == 3);
    // Every instance is present, in the order the draw will read them.
    CHECK(instanceMarks(h, cmd) == std::vector<f32>{2.0f, 3.0f, 1.0f});
}

/** Submits `count` instances of `key`'s mesh as ONE draw (a set of placements), the n-th record marked `mark + n`. */
void pushMeshInstances(Harness& h, BatchDrawKey key, u32 count, f32 mark, f32 depth) {
    const u32 at = h.pool.allocVertices(LayoutId::MeshInstance, key.instanceStride * count);
    for (u32 n = 0; n < count; ++n) {
        *reinterpret_cast<f32*>(h.pool.vertexData(LayoutId::MeshInstance) + at + n * key.instanceStride) = mark + static_cast<f32>(n);
    }
    key.instanceCount = count;
    key.depth = depth;
    pushBatchDraw(h.list, h.clips, at, 0, 0, 36, key);
}

TEST_CASE("finalize: draws that each place the mesh many times merge with every record carried") {
    Harness h;
    const BatchDrawKey key = meshKey(5);
    // Three draws of 3, 2 and 4 instances; depths reorder them so no two runs are adjacent in the pool
    // (in three different steps of the key's coarse depth, as above).
    pushMeshInstances(h, key, 3, 10.0f, 1.0f);
    pushMeshInstances(h, key, 2, 20.0f, 1000.0f);
    pushMeshInstances(h, key, 4, 30.0f, 10.0f);

    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 1);
    const DrawCommand& cmd = h.list.command(0);
    CHECK(cmd.instance_count == 9);
    // Nearest first: the draw at depth 1000 (marks 20, 21), then 10 (30..33), then 1 (10..12), each whole.
    CHECK(instanceMarks(h, cmd) == std::vector<f32>{20.0f, 21.0f, 30.0f, 31.0f, 32.0f, 33.0f, 10.0f, 11.0f, 12.0f});
}

/** Two mesh draws, the second differing only as `vary` says. How many draws survive. */
u32 drawsAfterMerge(const std::function<void(BatchDrawKey&, u32&)>& vary) {
    Harness h;
    const BatchDrawKey base = meshKey(5);
    BatchDrawKey second = base;
    u32 indexOffset = 0;
    vary(second, indexOffset);

    for (const auto& [key, at] : { std::pair{base, 0u}, std::pair{second, indexOffset} }) {
        const u32 rec = h.pool.allocVertices(LayoutId::MeshInstance, key.instanceStride);
        pushBatchDraw(h.list, h.clips, rec, 0, at, 36, key);
    }
    h.list.finalize(h.pool);
    return h.list.mergedDrawCallCount();
}

TEST_CASE("finalize: two mesh draws alike but for one thing stay two draws") {
    // Each case varies ONE thing and leaves the pair adjacent in the sort, so
    // the check under test is the only thing that can separate them. A fixture
    // where something else also differs would pass with the check deleted.
    CHECK(drawsAfterMerge([](BatchDrawKey&, u32&) {}) == 1);  // the control

    CHECK(drawsAfterMerge([](BatchDrawKey& k, u32&) {
        k.vertexBuffer = BufferHandle{6};                     // another mesh
    }) == 2);
    CHECK(drawsAfterMerge([](BatchDrawKey& k, u32&) {
        k.indexBuffer = BufferHandle{106};
    }) == 2);
    CHECK(drawsAfterMerge([](BatchDrawKey&, u32& indexOffset) {
        indexOffset = 36;                                     // another range of it
    }) == 2);
    CHECK(drawsAfterMerge([](BatchDrawKey& k, u32&) {
        k.textureId = 42;                                     // samplers are per draw
    }) == 2);
    CHECK(drawsAfterMerge([](BatchDrawKey& k, u32&) {
        k.materialId = 9;
    }) == 2);
    CHECK(drawsAfterMerge([](BatchDrawKey& k, u32&) {
        k.cull = 1;
    }) == 2);
    CHECK(drawsAfterMerge([](BatchDrawKey& k, u32&) {
        k.shaderId = 12;
    }) == 2);

    // Order-dependence, one property at a time. Each of these alone makes the
    // second draw one whose result depends on when it happens, and the head is
    // the opaque one — so a check that asks only about ITSELF passes them all.
    CHECK(drawsAfterMerge([](BatchDrawKey& k, u32&) {
        k.blend = BlendMode::Normal;
    }) == 2);
    CHECK(drawsAfterMerge([](BatchDrawKey& k, u32&) {
        k.depthTest = false;
    }) == 2);
    CHECK(drawsAfterMerge([](BatchDrawKey& k, u32&) {
        k.depthWrite = false;
    }) == 2);
}

TEST_CASE("finalize: the HEAD's own order-dependence stops a merge too") {
    // A material can say `blend: none, depthWrite: false`: nothing reads what
    // is behind and nothing records what is in front, so the last draw wins.
    // Submitted first it is the head, which only a check on ITS state refuses.
    Harness h;
    BatchDrawKey unordered = meshKey(5);
    unordered.depthWrite = false;
    pushMeshInstance(h, unordered, 1.0f, 20.0f);
    pushMeshInstance(h, meshKey(5), 2.0f, 20.0f);

    h.list.finalize(h.pool);
    CHECK(h.list.mergedDrawCallCount() == 2);
}

TEST_CASE("finalize: a blended mesh keeps its own draw, because its order is the result") {
    Harness h;
    BatchDrawKey key = meshKey(5);
    key.stage = RenderStage::Transparent;
    key.blend = BlendMode::Normal;
    key.depthWrite = false;
    pushMeshInstance(h, key, 1.0f, 10.0f);
    pushMeshInstance(h, key, 2.0f, 20.0f);

    h.list.finalize(h.pool);
    CHECK(h.list.mergedDrawCallCount() == 2);
}

TEST_CASE("finalize: an opaque head does not swallow a blended draw of the same mesh") {
    // The asymmetric case, and the one a pixel gate caught: asking only whether
    // THIS draw is opaque lets an opaque head absorb a blended sibling and paint
    // it with the head's own state — the blended one then hides what is behind it.
    Harness h;
    pushMeshInstance(h, meshKey(5), 1.0f, 20.0f);

    // Same stage on purpose — what MeshPlugin submits when one of two meshes
    // has `opaque` off, and what puts the pair next to each other. Giving the
    // blended one its own stage would sort them apart and prove nothing.
    BatchDrawKey blended = meshKey(5);
    blended.blend = BlendMode::Normal;
    blended.depthTest = false;
    pushMeshInstance(h, blended, 2.0f, 10.0f);

    h.list.finalize(h.pool);
    CHECK(h.list.mergedDrawCallCount() == 2);
}

TEST_CASE("finalize: a skinned mesh keeps its own draw, because a pose is per draw") {
    Harness h;
    BatchDrawKey key = meshKey(5);
    key.instanceStride = 4;
    key.skinCount = 2;
    key.skinOffset = 0;
    pushMeshInstance(h, key, 1.0f);
    pushMeshInstance(h, key, 2.0f);

    h.list.finalize(h.pool);
    CHECK(h.list.mergedDrawCallCount() == 2);
}

TEST_CASE("execute: a merged mesh draw asks the device for its instances in one call") {
    Harness h;
    BatchDrawKey key = meshKey(5);
    for (int i = 0; i < 4; ++i) pushMeshInstance(h, key, static_cast<f32>(i));

    h.list.finalize(h.pool);
    h.pool.upload();
    MaterialStore materials;
    h.list.execute(h.device, h.pool, materials, 1);

    CHECK(h.device.drawElementsInstancedCalls == 1);
    CHECK(h.device.lastDrawInstanceCount == 4);
    CHECK(h.device.lastDrawIndexCount == 36);
}

TEST_CASE("execute: a sampling draw pins every sampler unit it does not use") {
    // A unit a draw leaves alone keeps what the draw BEFORE it bound, across passes
    // and frames. So a draw states its whole sampler block or none of it: one that
    // leaves unit 2 alone samples the shadow atlas a shadow pass is drawing into.
    Harness h;
    MaterialStore materials;
    const u32 white = 99;

    BatchDrawKey key = meshKey(5, /*textureId=*/7);  // albedo only: texture_count == 1
    pushMeshInstance(h, key, 1.0f);
    h.list.finalize(h.pool);
    h.pool.upload();
    h.list.execute(h.device, h.pool, materials, white);

    u32 boundAt[MAX_CMD_TEXTURE_SLOTS] = {};
    bool seen[MAX_CMD_TEXTURE_SLOTS] = {};
    bool record = false;
    for (const auto& [unit, tex] : h.device.bindLog) {
        // The frame's per-object record rides its own unit above the draw's eight.
        if (unit == MESH_INSTANCE_TEXTURE_UNIT) {
            record = true;
            continue;
        }
        REQUIRE(unit < MAX_CMD_TEXTURE_SLOTS);
        boundAt[unit] = static_cast<u32>(tex);
        seen[unit] = true;
    }
    CHECK(record);
    for (u32 unit = 0; unit < MAX_CMD_TEXTURE_SLOTS; ++unit) {
        CHECK(seen[unit]);  // no unit left to whatever ran before
        CHECK(boundAt[unit] == (unit == 0 ? 7u : white));
    }
}

TEST_CASE("execute: a textureless stream declares no sampler and is left alone") {
    // The other half of the same rule: the shape stream samples nothing, so it
    // declares nothing, so there is no binding for stale state to land in.
    Harness h;
    MaterialStore materials;

    TestShapeVertex sverts[4] = {};
    BatchDrawKey key = quadKey(0);
    key.layoutId = LayoutId::Shape;
    appendIndexedDraw(h.pool, h.list, h.clips, sverts, 4, BATCH_QUAD_INDICES, 6, key);

    h.list.finalize(h.pool);
    h.pool.upload();
    h.list.execute(h.device, h.pool, materials, 99);

    CHECK(h.device.bindLog.empty());
}

TEST_CASE("clip state is stamped onto commands from every stream") {
    Harness h;
    Entity clipped{5};
    h.clips.setScissor(clipped.id(), 1, 2, 3, 4);

    TestShapeVertex sverts[4] = {};
    BatchDrawKey key = quadKey(0);
    key.layoutId = LayoutId::Shape;
    key.entity = clipped;
    appendIndexedDraw(h.pool, h.list, h.clips, sverts, 4, BATCH_QUAD_INDICES, 6, key);

    REQUIRE(h.list.commandCount() == 1);
    const DrawCommand& cmd = h.list.command(0);
    CHECK((cmd.state_flags & CMD_STATE_SCISSOR) != 0);
    CHECK(cmd.scissor.x == 1);
    CHECK(cmd.scissor.h == 4);
}

TEST_CASE("execute: indexed and instanced commands dispatch through the device") {
    Harness h;
    MaterialStore materials;

    BatchVertex quad[4] = {};
    appendQuad(h.pool, h.list, h.clips, quad, quadKey(42));

    BatchDrawKey inst = quadKey(42);
    inst.layoutId = LayoutId::ParticleInstance;
    inst.instanceCount = 5;
    pushBatchDraw(h.list, h.clips, 0, 0, 0, 6, inst);

    h.list.finalize(h.pool);
    h.pool.upload();
    h.list.execute(h.device, h.pool, materials);

    CHECK(h.device.drawElementsCalls == 1);
    CHECK(h.device.drawElementsInstancedCalls == 1);
    CHECK(h.device.lastDrawInstanceCount == 5);
    CHECK(h.device.setPipelineCalls == 2);
}

// The sort key ranks layer above stage, and both of these pin that down. Swapping the
// two fields back (stage on top, the classic 3D pipeline order) flips the first check
// and leaves the second passing — which is exactly the failure the old layout had:
// correct inside a layer, and silently wrong across layers. Every other case in this
// file submits Transparent only, so neither would have been caught here.
TEST_CASE("sort order: a lower sorting layer draws first even when a higher one is opaque") {
    Harness h;
    BatchVertex quad[4] = {};

    BatchDrawKey opaqueAbove = quadKey(50, /*layer=*/5);
    opaqueAbove.stage = RenderStage::Opaque;
    // A different shader only keeps the two from coalescing, so their order stays
    // observable; shader ranks below both fields under test.
    opaqueAbove.shaderId = 8;
    appendQuad(h.pool, h.list, h.clips, quad, opaqueAbove);
    appendQuad(h.pool, h.list, h.clips, quad, quadKey(51, /*layer=*/3));

    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 2);
    CHECK(h.list.command(0).texture_ids[0] == 51);
    CHECK(h.list.command(1).texture_ids[0] == 50);
}

TEST_CASE("sort order: inside one layer, opaque draws before blended") {
    Harness h;
    BatchVertex quad[4] = {};

    appendQuad(h.pool, h.list, h.clips, quad, quadKey(60, /*layer=*/4));
    BatchDrawKey opaque = quadKey(61, /*layer=*/4);
    opaque.stage = RenderStage::Opaque;
    opaque.shaderId = 8;
    appendQuad(h.pool, h.list, h.clips, quad, opaque);

    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 2);
    CHECK(h.list.command(0).texture_ids[0] == 61);
    CHECK(h.list.command(1).texture_ids[0] == 60);
}

// Opaque is a blend MODE, not a switch beside one — so "no blending" has to survive
// the trip from the draw's blend field to the pipeline the device is handed. Without
// this the scene path hardcoded blendEnabled, and an opaque material silently kept
// reading the destination it was asking to replace.
TEST_CASE("execute: BlendMode::None turns blending off in the resolved pipeline") {
    Harness h;
    MaterialStore materials;
    BatchVertex quad[4] = {};

    BatchDrawKey key = quadKey(42);
    key.blend = BlendMode::None;
    appendQuad(h.pool, h.list, h.clips, quad, key);
    h.list.finalize(h.pool);
    h.pool.upload();
    h.list.execute(h.device, h.pool, materials);

    CHECK(h.device.lastPipelineDesc.blend == BlendMode::None);
    CHECK(h.device.lastPipelineDesc.blendEnabled == false);
}

TEST_CASE("execute: every other blend mode leaves blending on") {
    Harness h;
    MaterialStore materials;
    BatchVertex quad[4] = {};

    appendQuad(h.pool, h.list, h.clips, quad, quadKey(42));
    h.list.finalize(h.pool);
    h.pool.upload();
    h.list.execute(h.device, h.pool, materials);

    CHECK(h.device.lastPipelineDesc.blend == BlendMode::Normal);
    CHECK(h.device.lastPipelineDesc.blendEnabled == true);
}

// Two draws that agree on everything the merge used to look at, and disagree on
// whether they write depth. Before a layer could derive depth state from its stage,
// equal material_id implied equal depth state and this could not arise; now it can,
// and merging them would hand one of them the other's depth behaviour.
TEST_CASE("finalize: draws with different depth state never coalesce") {
    Harness h;
    BatchVertex quad[4] = {};

    BatchDrawKey writes = quadKey(42);
    writes.depthWrite = true;
    appendQuad(h.pool, h.list, h.clips, quad, writes);

    BatchDrawKey reads = quadKey(43);
    reads.depthWrite = false;
    appendQuad(h.pool, h.list, h.clips, quad, reads);

    h.list.finalize(h.pool);

    CHECK(h.list.mergedDrawCallCount() == 2);
}

// A depth layer resolves its own stage and depth state from the one physical fact
// that decides them: whether the draw reads the destination. Nobody declares this
// per material, because getting it wrong is not a preference — a blended draw that
// writes depth clips its neighbours into black edges.
TEST_CASE("depth layer: an opaque draw writes depth and lands in the Opaque stage") {
    Harness h;
    h.list.setDepthMask(1u << 4);
    BatchVertex quad[4] = {};

    BatchDrawKey key = quadKey(42, /*layer=*/4);
    key.blend = BlendMode::None;
    appendQuad(h.pool, h.list, h.clips, quad, key);

    REQUIRE(h.list.commandCount() == 1);
    CHECK(h.list.command(0).stage == RenderStage::Opaque);
    CHECK(h.list.command(0).depth_test == true);
    CHECK(h.list.command(0).depth_write == true);
}

TEST_CASE("depth layer: a blended draw tests depth but never writes it") {
    Harness h;
    h.list.setDepthMask(1u << 4);
    BatchVertex quad[4] = {};

    appendQuad(h.pool, h.list, h.clips, quad, quadKey(42, /*layer=*/4));

    REQUIRE(h.list.commandCount() == 1);
    CHECK(h.list.command(0).stage == RenderStage::Transparent);
    CHECK(h.list.command(0).depth_test == true);
    CHECK(h.list.command(0).depth_write == false);
}

// The whole point of making it a layer property: a project that declares no depth
// layer must render exactly as it did, down to the pipeline state.
TEST_CASE("depth layer: a painter layer is untouched by the opt-in") {
    Harness h;
    h.list.setDepthMask(1u << 4);
    BatchVertex quad[4] = {};

    BatchDrawKey key = quadKey(42, /*layer=*/5);  // not the depth layer
    key.blend = BlendMode::None;
    appendQuad(h.pool, h.list, h.clips, quad, key);

    REQUIRE(h.list.commandCount() == 1);
    CHECK(h.list.command(0).stage == RenderStage::Transparent);
    CHECK(h.list.command(0).depth_test == false);
}

// Y-sort is a depth projected from world Y; real depth is the thing itself. A layer
// claiming both has said two contradictory things, and y-sort wins so that a project
// which had it keeps rendering as it did.
TEST_CASE("depth layer: y-sort wins when a layer declares both") {
    Harness h;
    h.list.setYSortMask(1u << 4);
    h.list.setDepthMask(1u << 4);

    CHECK(h.list.layerOrder(4) == DrawList::LayerOrder::YSort);
    CHECK(h.list.layerOrder(5) == DrawList::LayerOrder::Painter);
}

// ─── Order within a layer ────────────────────────────────────────────────────
// The author's explicit answer to "what is on top of what", inside one layer. Each case
// below is one the layer's own ordering gets wrong on purpose, so it measures an override.

// Each pair gets two shaders, which keeps them from coalescing into one multi-texture
// draw and leaves their order observable. Shader ranks below every field under test.

TEST_CASE("order: a higher order draws on top of a nearer sprite") {
    Harness h;
    BatchVertex quad[4] = {};

    BatchDrawKey nearer = quadKey(1, /*layer=*/3);
    nearer.depth = 50.0f;   // nearest — depth alone would put it last
    BatchDrawKey farther = quadKey(2, /*layer=*/3);
    farther.depth = -50.0f;
    farther.order = 1;
    farther.shaderId = 8;

    appendQuad(h.pool, h.list, h.clips, quad, nearer);
    appendQuad(h.pool, h.list, h.clips, quad, farther);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 2);
    CHECK(h.list.command(0).texture_ids[0] == 1);
    CHECK(h.list.command(1).texture_ids[0] == 2);
}

// The gap this field was added for. A y-sorted layer drops z from the key entirely, so
// before this there was NO way to pin a draw inside one — a shadow that must stay under
// its owner had only the owner's own Y to argue with.
TEST_CASE("order: inside a y-sorted layer, a stated order beats world Y") {
    Harness h;
    h.list.setYSortMask(1u << 4);
    BatchVertex quad[4] = {};

    // Lower Y draws last under y-sort, so this one would land on top unaided.
    BatchDrawKey low = quadKey(1, /*layer=*/4);
    low.y = -100.0f;
    BatchDrawKey high = quadKey(2, /*layer=*/4);
    high.y = 100.0f;
    high.order = 1;
    high.shaderId = 8;

    appendQuad(h.pool, h.list, h.clips, quad, low);
    appendQuad(h.pool, h.list, h.clips, quad, high);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 2);
    CHECK(h.list.command(0).texture_ids[0] == 1);
    CHECK(h.list.command(1).texture_ids[0] == 2);
}

// Y-sort still orders everything the author did not speak for. Without this, a field
// that simply disabled y-sort would pass every other case here.
TEST_CASE("order: equal orders leave y-sort to decide") {
    Harness h;
    h.list.setYSortMask(1u << 4);
    BatchVertex quad[4] = {};

    BatchDrawKey low = quadKey(1, /*layer=*/4);  low.y = -100.0f;
    BatchDrawKey high = quadKey(2, /*layer=*/4); high.y = 100.0f; high.shaderId = 8;
    low.order = high.order = 5;                  // stated, and stated the same

    appendQuad(h.pool, h.list, h.clips, quad, low);
    appendQuad(h.pool, h.list, h.clips, quad, high);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 2);
    CHECK(h.list.command(0).texture_ids[0] == 2);  // higher Y is further back
    CHECK(h.list.command(1).texture_ids[0] == 1);
}

// An order is a promise about one layer's contents, never about the layer itself.
TEST_CASE("order: the largest order never escapes its own layer") {
    Harness h;
    BatchVertex quad[4] = {};

    BatchDrawKey shouted = quadKey(1, /*layer=*/3);
    shouted.order = 127;
    BatchDrawKey above = quadKey(2, /*layer=*/4);
    above.order = -128;
    above.shaderId = 8;

    appendQuad(h.pool, h.list, h.clips, quad, shouted);
    appendQuad(h.pool, h.list, h.clips, quad, above);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 2);
    CHECK(h.list.command(0).layer == 3);
    CHECK(h.list.command(1).layer == 4);
}

// Biased, not masked: -1 has to land below 0 rather than wrapping to the top of the
// field, which is what a two's-complement cast into the key would have done.
TEST_CASE("order: a negative order sinks below an unstated one") {
    Harness h;
    BatchVertex quad[4] = {};

    BatchDrawKey plain = quadKey(1, /*layer=*/3);
    BatchDrawKey behind = quadKey(2, /*layer=*/3);
    behind.order = -1;
    behind.shaderId = 8;

    appendQuad(h.pool, h.list, h.clips, quad, plain);
    appendQuad(h.pool, h.list, h.clips, quad, behind);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 2);
    CHECK(h.list.command(0).texture_ids[0] == 2);
    CHECK(h.list.command(1).texture_ids[0] == 1);
}

// Clamped, not wrapped. A project ported from an engine with a wider range keeps the
// SIGN of what it asked for: "far on top" degrades to "on top", never to "behind".
TEST_CASE("order: an order past the range pins to the end it ran past") {
    Harness h;
    BatchVertex quad[4] = {};

    BatchDrawKey huge = quadKey(1, /*layer=*/3);
    huge.order = 32000;
    BatchDrawKey tiny = quadKey(2, /*layer=*/3);
    tiny.order = -32000;
    tiny.shaderId = 8;

    appendQuad(h.pool, h.list, h.clips, quad, huge);
    appendQuad(h.pool, h.list, h.clips, quad, tiny);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 2);
    CHECK(h.list.command(0).texture_ids[0] == 2);
    CHECK(h.list.command(1).texture_ids[0] == 1);
}

// Order outranks stage for the same reason layer does: it is a promise the author made,
// and a stage is only how a layer groups what it holds. An opaque draw the author put
// underneath must stay underneath, early-z or not.
TEST_CASE("order: a blended draw ordered below an opaque one still draws first") {
    Harness h;
    BatchVertex quad[4] = {};

    BatchDrawKey blended = quadKey(1, /*layer=*/3);
    blended.order = -1;
    BatchDrawKey opaque = quadKey(2, /*layer=*/3);
    opaque.stage = RenderStage::Opaque;
    opaque.shaderId = 8;

    appendQuad(h.pool, h.list, h.clips, quad, opaque);
    appendQuad(h.pool, h.list, h.clips, quad, blended);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 2);
    CHECK(h.list.command(0).texture_ids[0] == 1);
    CHECK(h.list.command(1).texture_ids[0] == 2);
}

// BlendMode::None is 9 and the key's blend field is 3 bits, so unmasked it set a bit in
// the SHADER field above it. Painter-ordered on purpose: a depth layer routes a None
// blend to the Opaque stage, never reaching the blended packing where the spill showed.
TEST_CASE("sort key: an opaque blend mode cannot reach the shader field") {
    Harness h;
    BatchVertex quad[4] = {};

    BatchDrawKey none = quadKey(1, /*layer=*/3);
    none.blend = BlendMode::None;
    BatchDrawKey normal = quadKey(2, /*layer=*/3);

    // Same shader, same depth, same everything the key ranks above blend: whatever
    // separates them is the blend field, and it may not reach past its own 3 bits.
    CHECK((DrawCommand::buildSortKey(RenderStage::Transparent, 3, none.shaderId,
                                     BlendMode::None, 0, 0.0f) >> 10)
          == (DrawCommand::buildSortKey(RenderStage::Transparent, 3, normal.shaderId,
                                        BlendMode::Normal, 0, 0.0f) >> 10));

    appendQuad(h.pool, h.list, h.clips, quad, none);
    appendQuad(h.pool, h.list, h.clips, quad, normal);
    h.list.finalize(h.pool);
    REQUIRE(h.list.mergedDrawCallCount() == 2);
}

// ─── Stencil mask ordering ───────────────────────────────────────────────────
// A stencil write must precede the draws that test it, and the sort key holds no
// clip state. The layer does it: UI pre-order puts a parent below its descendants.

TEST_CASE("stencil: the mask outranks its content even when material and depth fight it") {
    Harness h;
    BatchVertex quad[4] = {};
    Entity maskEntity{11};
    Entity contentEntity{12};

    // Worst case the UI tree can produce: the mask is the parent (lower uiOrder →
    // lower layer) but loses on every field below layer.
    BatchDrawKey mask = quadKey(1, /*layer=*/1000);
    mask.entity = maskEntity;
    mask.materialId = 90000;   // sorts after the content's material
    mask.depth = 100.0f;       // nearest — would sort last within a transparent layer
    h.clips.setStencilMask(maskEntity.id(), 1);

    BatchDrawKey content = quadKey(2, /*layer=*/1001);
    content.entity = contentEntity;
    content.materialId = 1;
    content.depth = -100.0f;
    h.clips.setStencilTest(contentEntity.id(), 1);

    // Submitted content-first, so only the sort can put them right.
    appendQuad(h.pool, h.list, h.clips, quad, content);
    appendQuad(h.pool, h.list, h.clips, quad, mask);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 2);
    CHECK((h.list.command(0).state_flags & CMD_STATE_STENCIL_WRITE) != 0);
    CHECK((h.list.command(1).state_flags & CMD_STATE_STENCIL_TEST) != 0);
}

TEST_CASE("stencil: a nested mask still writes before the content it clips") {
    Harness h;
    BatchVertex quad[4] = {};
    Entity outer{20}, inner{21}, leaf{22};

    // outer(layer 1000) → inner mask(1001) → leaf(1002), each on its own material.
    BatchDrawKey outerKey = quadKey(1, 1000);
    outerKey.entity = outer;
    outerKey.materialId = 7;
    h.clips.setStencilMask(outer.id(), 1);

    BatchDrawKey innerKey = quadKey(2, 1001);
    innerKey.entity = inner;
    innerKey.materialId = 300;
    h.clips.setStencilMask(inner.id(), 2);

    BatchDrawKey leafKey = quadKey(3, 1002);
    leafKey.entity = leaf;
    leafKey.materialId = 4;
    h.clips.setStencilTest(leaf.id(), 2);

    appendQuad(h.pool, h.list, h.clips, quad, leafKey);
    appendQuad(h.pool, h.list, h.clips, quad, innerKey);
    appendQuad(h.pool, h.list, h.clips, quad, outerKey);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 3);
    CHECK(h.list.command(0).stencil_ref == 1);
    CHECK((h.list.command(0).state_flags & CMD_STATE_STENCIL_WRITE) != 0);
    CHECK(h.list.command(1).stencil_ref == 2);
    CHECK((h.list.command(1).state_flags & CMD_STATE_STENCIL_WRITE) != 0);
    CHECK(h.list.command(2).stencil_ref == 2);
    CHECK((h.list.command(2).state_flags & CMD_STATE_STENCIL_TEST) != 0);
}

TEST_CASE("UI stencil restores parents between siblings without duplicating geometry") {
    Harness h;
    BatchVertex quad[4] = {};
    const Entity outer{201}, first{202}, second{203}, leafA{204}, leafB{205}, tail{206};
    h.clips.setUIStencilMask(outer.id(), 1);
    h.clips.setUIStencilMask(first.id(), 2);
    h.clips.setUIStencilMask(second.id(), 2);
    h.clips.setUIStencilTest(leafA.id(), 2);
    h.clips.setUIStencilTest(leafB.id(), 2);
    h.clips.setUIStencilTest(tail.id(), 1);
    // Sprite masks occupy the lower references; nested UI must never accept
    // their pixels outside its own root.
    h.clips.reserveSpriteStencilReferences(7);
    i32 layer = 0;
    for (Entity entity : {outer, first, leafA, second, leafB, tail}) {
        auto key = quadKey(1, layer++);
        key.entity = entity;
        appendQuad(h.pool, h.list, h.clips, quad, key);
    }
    const u32 vertexBytes = h.pool.vertexBytesUsed(LayoutId::Batch);
    const u32 indices = h.pool.indicesUsed(LayoutId::Batch);
    h.list.finalize(h.pool);
    REQUIRE(h.list.mergedDrawCallCount() == 9);
    const GfxStencilMode modes[] = {GfxStencilMode::Write, GfxStencilMode::Increment,
        GfxStencilMode::Test, GfxStencilMode::Decrement, GfxStencilMode::Increment,
        GfxStencilMode::Test, GfxStencilMode::Decrement, GfxStencilMode::Test, GfxStencilMode::Zero};
    const i32 refs[] = {8, 8, 9, 9, 8, 9, 9, 8, 8};
    for (u32 i = 0; i < 9; ++i) {
        const auto& command = h.list.command(i);
        CHECK(stencilModeOf(command.state_flags) == modes[i]);
        CHECK(command.stencil_ref == refs[i]);
        if (writesStencil(modes[i])) {
            CHECK_FALSE(command.depth_test);
            CHECK_FALSE(command.depth_write);
        }
    }
    CHECK(h.list.command(3).index_offset == h.list.command(1).index_offset);
    CHECK(h.list.command(6).index_offset == h.list.command(4).index_offset);
    CHECK(h.list.command(8).index_offset == h.list.command(0).index_offset);
    CHECK(h.pool.vertexBytesUsed(LayoutId::Batch) == vertexBytes);
    CHECK(h.pool.indicesUsed(LayoutId::Batch) == indices);
}

TEST_CASE("UI stencil keeps every piece of a mask and supports 255 nested levels") {
    SUBCASE("multiple commands contribute to one mask") {
        Harness h;
        BatchVertex quad[4] = {};
        h.clips.setUIStencilMask(301, 1);
        h.clips.setUIStencilTest(302, 1);
        for (u32 i = 0; i < 3; ++i) {
            auto key = quadKey(i + 1, static_cast<i32>(i));
            key.entity = Entity{i < 2 ? 301u : 302u};
            appendQuad(h.pool, h.list, h.clips, quad, key);
        }
        h.list.finalize(h.pool);
        REQUIRE(h.list.mergedDrawCallCount() == 5);
        CHECK(stencilModeOf(h.list.command(0).state_flags) == GfxStencilMode::Write);
        CHECK(stencilModeOf(h.list.command(1).state_flags) == GfxStencilMode::Write);
        CHECK(stencilModeOf(h.list.command(2).state_flags) == GfxStencilMode::Test);
        CHECK(stencilModeOf(h.list.command(3).state_flags) == GfxStencilMode::Zero);
        CHECK(stencilModeOf(h.list.command(4).state_flags) == GfxStencilMode::Zero);
        CHECK(h.list.command(0).texture_ids[0] == h.list.command(4).texture_ids[0]);
        CHECK(h.list.command(1).texture_ids[0] == h.list.command(3).texture_ids[0]);
        const auto* vertices = reinterpret_cast<const BatchVertex*>(h.pool.vertexData(LayoutId::Batch));
        for (u32 vertex = 0; vertex < 8; ++vertex) CHECK(vertices[vertex].texIndex == 0);
    }
    SUBCASE("all eight stencil planes remain available") {
        Harness h;
        BatchVertex quad[4] = {};
        for (u32 depth = 1; depth <= 255; ++depth) {
            h.clips.setUIStencilMask(depth, static_cast<i32>(depth));
            auto key = quadKey(1, static_cast<i32>(depth));
            key.entity = Entity{depth};
            appendQuad(h.pool, h.list, h.clips, quad, key);
        }
        h.clips.setUIStencilTest(256, 255);
        auto key = quadKey(1, 256);
        key.entity = Entity{256};
        appendQuad(h.pool, h.list, h.clips, quad, key);
        h.list.finalize(h.pool);
        REQUIRE(h.list.mergedDrawCallCount() == 511);
        CHECK(h.list.command(254).stencil_ref == 254);
        CHECK(h.list.command(255).stencil_ref == 255);
        CHECK(stencilModeOf(h.list.command(256).state_flags) == GfxStencilMode::Decrement);
        CHECK(h.list.command(256).stencil_ref == 255);
        CHECK(stencilModeOf(h.list.command(510).state_flags) == GfxStencilMode::Zero);
    }
    SUBCASE("missing mask geometry does not expose stale stencil values") {
        Harness h;
        BatchVertex quad[4] = {};
        h.clips.setUIStencilTest(401, 1);
        auto key = quadKey(1);
        key.entity = Entity{401};
        appendQuad(h.pool, h.list, h.clips, quad, key);
        h.list.finalize(h.pool);
        CHECK(h.list.mergedDrawCallCount() == 0);
    }
    SUBCASE("shared stencil capacity clips overflow instead of aliasing") {
        ClipState clips;
        clips.setUIStencilMask(501, 254);
        clips.setUIStencilTest(502, 255);
        clips.reserveSpriteStencilReferences(1);
        CHECK(clips.getEntry(501)->stencil_ref == 255);
        CHECK_FALSE(clips.isEmptyScissor(Entity{501}));
        CHECK(clips.isEmptyScissor(Entity{502}));
    }
}

// Where the guarantee stops. Nothing the engine emits puts a mask and its content
// on one layer; a caller reaching for renderer_setEntityStencilMask directly can.
TEST_CASE("stencil: on one layer, material — not submission or depth — decides") {
    Harness h;
    BatchVertex quad[4] = {};
    Entity a{31}, b{32};

    BatchDrawKey writer = quadKey(1, /*layer=*/1000);
    writer.entity = a;
    writer.materialId = 90000;
    h.clips.setStencilMask(a.id(), 1);

    BatchDrawKey tester = quadKey(2, /*layer=*/1000);
    tester.entity = b;
    tester.materialId = 1;
    h.clips.setStencilTest(b.id(), 1);

    appendQuad(h.pool, h.list, h.clips, quad, writer);
    appendQuad(h.pool, h.list, h.clips, quad, tester);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 2);
    // The lower material wins, so the test lands FIRST — the mask is written after
    // the thing it was supposed to clip.
    CHECK((h.list.command(0).state_flags & CMD_STATE_STENCIL_TEST) != 0);
    CHECK((h.list.command(1).state_flags & CMD_STATE_STENCIL_WRITE) != 0);
}

// ─── Blended depth ordering ──────────────────────────────────────────────────
// A blended draw composites onto what is already there, so back-to-front IS the
// result. Material may not outrank it — batching is the thing that yields.

TEST_CASE("transparent: back-to-front holds across materials") {
    Harness h;
    BatchVertex quad[4] = {};

    // Camera looks down -z, so larger z is nearer and must land last.
    BatchDrawKey nearer = quadKey(1, /*layer=*/3);
    nearer.materialId = 1;          // lowest material — would have sorted first
    nearer.depth = 50.0f;

    BatchDrawKey middle = quadKey(2, /*layer=*/3);
    middle.materialId = 90000;
    middle.depth = 0.0f;

    BatchDrawKey farther = quadKey(3, /*layer=*/3);
    farther.materialId = 500;
    farther.depth = -50.0f;

    appendQuad(h.pool, h.list, h.clips, quad, nearer);
    appendQuad(h.pool, h.list, h.clips, quad, middle);
    appendQuad(h.pool, h.list, h.clips, quad, farther);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 3);
    CHECK(h.list.command(0).texture_ids[0] == 3);  // far
    CHECK(h.list.command(1).texture_ids[0] == 2);  // middle
    CHECK(h.list.command(2).texture_ids[0] == 1);  // near
}

TEST_CASE("transparent: equal depth still groups by material for the merge") {
    Harness h;
    BatchVertex quad[4] = {};

    BatchDrawKey a1 = quadKey(1, 3); a1.materialId = 7; a1.depth = 0.0f;
    BatchDrawKey b = quadKey(2, 3);  b.materialId = 8;  b.depth = 0.0f;
    BatchDrawKey a2 = quadKey(3, 3); a2.materialId = 7; a2.depth = 0.0f;

    // Submitted adjacent so their index ranges stay contiguous — the merge needs
    // that as well as adjacency after the sort.
    appendQuad(h.pool, h.list, h.clips, quad, a1);
    appendQuad(h.pool, h.list, h.clips, quad, a2);
    appendQuad(h.pool, h.list, h.clips, quad, b);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 2);
    CHECK(h.list.command(0).material_id == 7);
    CHECK(h.list.command(1).material_id == 8);
}

TEST_CASE("opaque: material still outranks depth, since order cannot change the result") {
    Harness h;
    BatchVertex quad[4] = {};

    BatchDrawKey a1 = quadKey(1, 3); a1.stage = RenderStage::Opaque;
    a1.blend = BlendMode::None; a1.materialId = 7; a1.depth = 100.0f;
    BatchDrawKey b = quadKey(2, 3);  b.stage = RenderStage::Opaque;
    b.blend = BlendMode::None;  b.materialId = 8;  b.depth = 0.0f;
    BatchDrawKey a2 = quadKey(3, 3); a2.stage = RenderStage::Opaque;
    a2.blend = BlendMode::None; a2.materialId = 7; a2.depth = -100.0f;

    appendQuad(h.pool, h.list, h.clips, quad, a1);
    appendQuad(h.pool, h.list, h.clips, quad, a2);
    appendQuad(h.pool, h.list, h.clips, quad, b);
    h.list.finalize(h.pool);

    // Both material-7 draws coalesce despite straddling material 8 in depth.
    REQUIRE(h.list.mergedDrawCallCount() == 2);
    CHECK(h.list.command(0).material_id == 7);
    CHECK(h.list.command(1).material_id == 8);
}

// 20 bits is sign + exponent + 11 mantissa bits, so the step is ~2^-11 of the
// exponent's range: about 0.004 around z=10. Closer than that shares a key and
// keeps submission order, which is the quantization talking, not a rule.
TEST_CASE("transparent: sorted index runs preserve distinct depth keys and quantized ties") {
    Harness h;
    BatchVertex quad[4] = {};

    BatchDrawKey nearer = quadKey(1, 3); nearer.materialId = 1; nearer.depth = 10.01f;
    BatchDrawKey farther = quadKey(2, 3); farther.materialId = 1; farther.depth = 10.00f;
    appendQuad(h.pool, h.list, h.clips, quad, nearer);
    appendQuad(h.pool, h.list, h.clips, quad, farther);
    CHECK(h.list.command(1).sort_key < h.list.command(0).sort_key);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 1);
    CHECK(h.list.command(0).texture_ids[0] == 2);
    CHECK(h.list.command(0).texture_ids[1] == 1);
    const auto* sorted = h.pool.indexData(LayoutId::Batch) + h.list.command(0).index_offset;
    CHECK(sorted[0] == 4);
    CHECK(sorted[6] == 0);

    Harness fine;
    BatchDrawKey a = quadKey(1, 3); a.materialId = 1; a.depth = 10.001f;
    BatchDrawKey b = quadKey(2, 3); b.materialId = 1; b.depth = 10.000f;
    appendQuad(fine.pool, fine.list, fine.clips, quad, a);
    appendQuad(fine.pool, fine.list, fine.clips, quad, b);
    CHECK(fine.list.command(0).sort_key == fine.list.command(1).sort_key);
    fine.list.finalize(fine.pool);
    CHECK(fine.list.mergedDrawCallCount() == 1);
    const auto* tied = fine.pool.indexData(LayoutId::Batch) + fine.list.command(0).index_offset;
    CHECK(tied[0] == 0);
    CHECK(tied[6] == 4);
}

// ─── Transient buffer growth ─────────────────────────────────────────────────
// A workload creeping upward each frame must not reallocate the GPU buffer every
// frame. The staging vectors double, and the GPU capacity follows them.

TEST_CASE("storage: idle streams allocate nothing and used streams survive recovery") {
    MockGfxDevice device;
    TransientBufferPool pool{device};
    pool.init(4096, 1024);
    CHECK(device.createBufferCalls == 0);
    CHECK(device.estimatedGpuBytes() == 0);
    for (auto layout : {LayoutId::Batch, LayoutId::Shape, LayoutId::Sky, LayoutId::ParticleInstance}) {
        CHECK(pool.layoutHandle(layout) != VertexLayoutHandle::Invalid);
        CHECK(pool.vertexStride(layout) > 0);
        CHECK(pool.vertexBuffer(layout) == BufferHandle::Invalid);
    }
    pool.allocVertices(LayoutId::Batch, 0);
    pool.allocIndices(LayoutId::Shape, 0);
    pool.upload();
    CHECK(device.createBufferCalls == 0);
    BatchVertex vertices[4] = {};
    const u32 indices[6] = {0, 1, 2, 2, 3, 0};
    pool.appendVertices(LayoutId::Batch, vertices, sizeof(vertices));
    pool.appendIndices(LayoutId::Batch, indices, 6);
    pool.upload();
    CHECK(device.createBufferCalls == 2);
    CHECK(device.estimatedGpuBytes() == 8192);
    const auto batch = pool.vertexBuffer(LayoutId::Batch);
    pool.beginFrame();
    pool.appendVertices(LayoutId::Batch, vertices, sizeof(vertices));
    pool.upload();
    CHECK(device.createBufferCalls == 2);
    CHECK(pool.vertexBuffer(LayoutId::Batch) == batch);
    std::vector<u8> particle(44);
    pool.appendVertices(LayoutId::ParticleInstance, particle.data(), 44);
    pool.upload();
    CHECK(device.createBufferCalls == 5);
    CHECK(device.estimatedGpuBytes() == 8192 + 4096 + 64 + 24);
    CHECK(pool.vertexBuffer(LayoutId::Sky) == BufferHandle::Invalid);
    CHECK(pool.vertexBuffer(LayoutId::Shape) == BufferHandle::Invalid);
    const auto storage = device.estimatedGpuBytes();
    device.notifyDeviceLost(GfxDeviceLostReason::ContextLost, "test");
    CHECK(device.estimatedGpuBytes() == 0);
    REQUIRE(device.recoverDevice());
    CHECK(device.estimatedGpuBytes() == storage);
    CHECK(pool.vertexBuffer(LayoutId::Batch) == batch);
    pool.upload();
    pool.shutdown();
    CHECK(device.estimatedGpuBytes() == 0);
    pool.init(4096, 1024);
    CHECK(device.estimatedGpuBytes() == 0);
    pool.shutdown();
}

TEST_CASE("growth: a slowly rising workload reallocates a handful of times, not per frame") {
    MockGfxDevice device;
    TransientBufferPool pool{device};
    pool.init(/*initialVertexBytes=*/4096, /*initialIndexCount=*/1024);

    const int FRAMES = 200;
    for (int f = 0; f < FRAMES; ++f) {
        pool.beginFrame();
        // Each frame asks for a little more than the last.
        const u32 quads = 64 + static_cast<u32>(f) * 8;
        BatchVertex quad[4] = {};
        for (u32 i = 0; i < quads; ++i) {
            pool.appendVertices(LayoutId::Batch, quad, sizeof(quad));
        }
        pool.upload();
    }

    // Doubling from 4KB, the whole run needs a bounded number of reallocations —
    // one per doubling per stream, not one per frame.
    CHECK(device.resizeBufferCalls < 32);
    CHECK(device.resizeBufferCalls > 0);   // it did have to grow
}

TEST_CASE("growth: a steady workload inside capacity never reallocates") {
    MockGfxDevice device;
    TransientBufferPool pool{device};
    pool.init(/*initialVertexBytes=*/1024 * 1024, /*initialIndexCount=*/64 * 1024);
    const int before = device.resizeBufferCalls;

    BatchVertex quad[4] = {};
    for (int f = 0; f < 100; ++f) {
        pool.beginFrame();
        for (int i = 0; i < 100; ++i) pool.appendVertices(LayoutId::Batch, quad, sizeof(quad));
        pool.upload();
    }
    CHECK_EQ(device.resizeBufferCalls, before);
}

// ============================================================================
// SortingGroup — the resolution pushBatchDraw does, asserted through the frame.
// The key's own field layout is test_sort_key's; what these hold is that the draw
// path ASKS the group rather than the member, everywhere a layer is consulted.
// ============================================================================

// The promise a per-sprite order cannot make. Two members straddle an outsider's
// order, and the outsider still may not come between them.
TEST_CASE("group: an outsider cannot be drawn between two members") {
    Harness h;
    h.list.setSortingGroup(11, {/*layer=*/3, /*order=*/5, false, 0});
    h.list.setSortingGroup(12, {/*layer=*/3, /*order=*/5, false, 0});
    BatchVertex quad[4] = {};

    BatchDrawKey low = quadKey(1, /*layer=*/9);   // the member's own layer is ignored
    low.order = -100;
    low.entity = Entity(11);
    BatchDrawKey high = quadKey(3, /*layer=*/9);
    high.order = 100;
    high.entity = Entity(12);
    // Ungrouped, and stated BETWEEN what the two members state for themselves. Sorting
    // by the member's own order — the pre-group behaviour — puts it in the middle.
    BatchDrawKey outsider = quadKey(2, /*layer=*/3);
    outsider.order = 6;
    outsider.shaderId = 8;

    appendQuad(h.pool, h.list, h.clips, quad, low);
    appendQuad(h.pool, h.list, h.clips, quad, outsider);
    appendQuad(h.pool, h.list, h.clips, quad, high);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 2);
    // The two members adjacent and in their stated order, the outsider clear of both.
    CHECK(h.list.command(0).texture_ids[0] == 1);
    CHECK(h.list.command(0).texture_ids[1] == 3);
    CHECK(h.list.command(1).texture_ids[0] == 2);
    const auto* indices = h.pool.indexData(LayoutId::Batch) + h.list.command(0).index_offset;
    CHECK(indices[0] == 0);
    CHECK(indices[6] == 8);
    const auto members = h.list.runEntities(0);
    REQUIRE(members.size() == 2);
    CHECK(members[0] == Entity(11));
    CHECK(members[1] == Entity(12));
}

// Everything derived from a layer has to come from the GROUP's layer. A member whose
// own layer is y-sorted, in a group whose layer is not, must not y-sort.
TEST_CASE("group: the layer's rule is the group's, not the member's") {
    Harness h;
    h.list.setYSortMask(1u << 4);
    h.list.setSortingGroup(21, {/*layer=*/6, 0, false, 0});
    h.list.setSortingGroup(22, {/*layer=*/6, 0, false, 0});
    BatchVertex quad[4] = {};

    // The two rules must DISAGREE or this passes whichever ran. A stated order cannot make
    // them — it outranks both — so the orders are equal and depth and world Y are set to
    // opposite conclusions.
    BatchDrawKey backY = quadKey(1, /*layer=*/4);
    backY.y = -100.0f;      // y-sort: lower Y draws LAST
    backY.depth = -100.0f;  // painter: further draws FIRST
    backY.entity = Entity(21);
    BatchDrawKey frontY = quadKey(2, /*layer=*/4);
    frontY.y = 100.0f;
    frontY.depth = 100.0f;
    frontY.shaderId = 8;
    frontY.entity = Entity(22);

    appendQuad(h.pool, h.list, h.clips, quad, backY);
    appendQuad(h.pool, h.list, h.clips, quad, frontY);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 2);
    // The group's layer is painter-ordered, so depth decides: y-sort would have
    // reversed exactly this pair.
    CHECK(h.list.command(0).texture_ids[0] == 1);
    CHECK(h.list.command(1).texture_ids[0] == 2);
}

// A group's members answer the camera's culling mask on the group's layer too —
// otherwise half a character disappears when a camera drops the layer it was rigged in.
TEST_CASE("group: culling reads the group's layer") {
    Harness h;
    h.list.setCullingMask(1u << 6);  // the group's layer only
    h.list.setSortingGroup(31, {/*layer=*/6, 0, false, 0});
    BatchVertex quad[4] = {};

    BatchDrawKey member = quadKey(1, /*layer=*/4);  // a layer this camera does not draw
    member.entity = Entity(31);
    BatchDrawKey ungrouped = quadKey(2, /*layer=*/4);

    appendQuad(h.pool, h.list, h.clips, quad, member);
    appendQuad(h.pool, h.list, h.clips, quad, ungrouped);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 1);
    CHECK(h.list.command(0).texture_ids[0] == 1);
}

// A nested group is one block: its contents share the block's order and do not
// interleave with a sibling of the block, whatever they state for themselves.
TEST_CASE("group: a nested group's contents stay one block") {
    Harness h;
    h.list.setSortingGroup(41, {/*layer=*/3, 0, /*blockOrder=*/true, /*block=*/0});
    h.list.setSortingGroup(42, {/*layer=*/3, 0, /*blockOrder=*/true, /*block=*/0});
    h.list.setSortingGroup(43, {/*layer=*/3, 0, false, 0});
    BatchVertex quad[4] = {};

    // Two members of the inner block, stated far apart, and a sibling of the block
    // whose own order sits between those two statements.
    BatchDrawKey blockLow = quadKey(1, 3);
    blockLow.order = -50;
    blockLow.entity = Entity(41);
    BatchDrawKey sibling = quadKey(2, 3);
    sibling.order = 1;
    sibling.shaderId = 8;
    sibling.entity = Entity(43);
    BatchDrawKey blockHigh = quadKey(3, 3);
    blockHigh.order = 50;
    blockHigh.entity = Entity(42);

    appendQuad(h.pool, h.list, h.clips, quad, blockLow);
    appendQuad(h.pool, h.list, h.clips, quad, sibling);
    appendQuad(h.pool, h.list, h.clips, quad, blockHigh);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 2);
    CHECK(h.list.command(1).texture_ids[0] == 2);  // the sibling is above the whole block
    const auto* indices = h.pool.indexData(LayoutId::Batch) + h.list.command(0).index_offset;
    CHECK(indices[0] == 0);
    CHECK(indices[6] == 8);
    const auto members = h.list.runEntities(0);
    REQUIRE(members.size() == 2);
    CHECK(members[0] == Entity(41));
    CHECK(members[1] == Entity(42));
}

// A group that is not there changes nothing — the field that decides is the table,
// not the presence of the component elsewhere in the scene.
TEST_CASE("group: an ungrouped draw is unaffected by another entity's group") {
    Harness h;
    h.list.setSortingGroup(51, {/*layer=*/0, /*order=*/100, false, 0});
    BatchVertex quad[4] = {};

    BatchDrawKey a = quadKey(1, /*layer=*/2);
    BatchDrawKey b = quadKey(2, /*layer=*/1);
    b.shaderId = 8;

    appendQuad(h.pool, h.list, h.clips, quad, a);
    appendQuad(h.pool, h.list, h.clips, quad, b);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 2);
    CHECK(h.list.command(0).texture_ids[0] == 2);
    CHECK(h.list.command(1).texture_ids[0] == 1);
}

// A sprite cut to the inside of a mask and one cut to the outside of the SAME mask differ
// only in a state flag. Merged, one of them would be drawn with the other's stencil compare
// — the hole and the window are the same picture then.
TEST_CASE("stencil: inside and outside of one mask are different draws") {
    Harness h;
    h.clips.setStencilTest(61, 1);
    h.clips.setStencilTestOutside(62, 1);
    BatchVertex quad[4] = {};

    BatchDrawKey inside = quadKey(1, /*layer=*/2);
    inside.entity = Entity(61);
    BatchDrawKey outside = quadKey(1, /*layer=*/2);
    outside.entity = Entity(62);

    appendQuad(h.pool, h.list, h.clips, quad, inside);
    appendQuad(h.pool, h.list, h.clips, quad, outside);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 2);
    CHECK((h.list.command(0).state_flags & CMD_STATE_STENCIL_OUT) == 0);
    CHECK((h.list.command(1).state_flags & CMD_STATE_STENCIL_OUT) != 0);
}

// Setting one mode must clear the other, or a sprite switched from outside to inside keeps
// both flags and reads as outside forever.
TEST_CASE("stencil: the two test modes are exclusive on one entity") {
    ClipState clips;
    clips.setStencilTestOutside(70, 3);
    clips.setStencilTest(70, 3);
    DrawCommand cmd{};
    clips.applyTo(Entity(70), cmd);
    CHECK((cmd.state_flags & CMD_STATE_STENCIL_TEST) != 0);
    CHECK((cmd.state_flags & CMD_STATE_STENCIL_OUT) == 0);

    clips.setStencilTestOutside(70, 3);
    DrawCommand back{};
    clips.applyTo(Entity(70), back);
    CHECK((back.state_flags & CMD_STATE_STENCIL_OUT) != 0);
}
