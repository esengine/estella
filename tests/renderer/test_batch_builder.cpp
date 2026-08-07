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
    BatchDrawKey near = quadKey(1, /*layer=*/3);
    near.materialId = 1;          // lowest material — would have sorted first
    near.depth = 50.0f;

    BatchDrawKey middle = quadKey(2, /*layer=*/3);
    middle.materialId = 90000;
    middle.depth = 0.0f;

    BatchDrawKey far = quadKey(3, /*layer=*/3);
    far.materialId = 500;
    far.depth = -50.0f;

    appendQuad(h.pool, h.list, h.clips, quad, near);
    appendQuad(h.pool, h.list, h.clips, quad, middle);
    appendQuad(h.pool, h.list, h.clips, quad, far);
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
TEST_CASE("transparent: hundredths of depth separate; thousandths share a bucket") {
    Harness h;
    BatchVertex quad[4] = {};

    BatchDrawKey nearer = quadKey(1, 3); nearer.materialId = 1; nearer.depth = 10.01f;
    BatchDrawKey farther = quadKey(2, 3); farther.materialId = 1; farther.depth = 10.00f;
    appendQuad(h.pool, h.list, h.clips, quad, nearer);
    appendQuad(h.pool, h.list, h.clips, quad, farther);
    h.list.finalize(h.pool);

    REQUIRE(h.list.mergedDrawCallCount() == 2);
    CHECK(h.list.command(0).texture_ids[0] == 2);
    CHECK(h.list.command(1).texture_ids[0] == 1);

    Harness fine;
    BatchDrawKey a = quadKey(1, 3); a.materialId = 1; a.depth = 10.001f;
    BatchDrawKey b = quadKey(2, 3); b.materialId = 1; b.depth = 10.000f;
    appendQuad(fine.pool, fine.list, fine.clips, quad, a);
    appendQuad(fine.pool, fine.list, fine.clips, quad, b);
    fine.list.finalize(fine.pool);
    CHECK(fine.list.mergedDrawCallCount() == 1);
}
