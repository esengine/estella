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
#include "esengine/renderer/draw/DrawList.hpp"
#include "esengine/renderer/store/MaterialStore.hpp"
#include "esengine/renderer/rhi/TransientBufferPool.hpp"

using namespace esengine;

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

}  // namespace

TEST_CASE("pool reports each stream's vertex stride (single source for baseVertex math)") {
    Harness h;
    CHECK(h.pool.vertexStride(LayoutId::Batch) == sizeof(BatchVertex));
    CHECK(h.pool.vertexStride(LayoutId::Shape) == sizeof(TestShapeVertex));
    CHECK(h.pool.vertexStride(LayoutId::ParticleInstance) == 40);  // per-instance slot
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
    // A textureless non-Batch draw must not claim a sampler slot (execute() binds
    // only texture_count units for non-Batch layouts).
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
