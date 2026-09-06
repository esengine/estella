// Persistent mesh identity across a device generation.
//
// The REAL ResourceManager.cpp against MockGfxDevice: at the loss the handle
// survives, the realization does not, and every mesh is owed or gone for good.

#include "../renderer/MockGfxDevice.hpp"
#include "esengine/resource/ResourceManager.hpp"

#include <algorithm>
#include <cstdio>
#include <vector>

using namespace esengine;

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

namespace {

struct Vertex { f32 x, y, z, u, v; };

const GfxVertexAttribute kChannels[2] = {
    {0, 3, GfxDataType::Float, false, 0, 0},
    {1, 2, GfxDataType::Float, false, 12, 0},
};

resource::MeshHandle makeMesh(resource::ResourceManager& rm, MeshRecovery recovery) {
    const Vertex verts[3] = {{0, 0, 0, 0, 0}, {1, 0, 0, 1, 0}, {0, 1, 0, 0, 1}};
    const u32 indices[3] = {0, 1, 2};
    return rm.createMesh(
        ConstSpan<u8>(reinterpret_cast<const u8*>(verts), sizeof(verts)),
        ConstSpan<u32>(indices, 3),
        ConstSpan<GfxVertexAttribute>(kChannels, 2), sizeof(Vertex),
        glm::vec3(0.0f), glm::vec3(1.0f), recovery);
}

bool owes(const std::vector<resource::MeshHandle>& awaiting, resource::MeshHandle h) {
    return std::find(awaiting.begin(), awaiting.end(), h) != awaiting.end();
}

}  // namespace

int main() {
    // --- The identity survives; the realization does not ---
    {
        MockGfxDevice d;
        resource::ResourceManager rm;
        rm.init(d);

        const auto h = makeMesh(rm, MeshRecovery::SourceReplayable);
        CHECK(h.isValid(), "a mesh mints a handle");
        const Mesh* before = rm.getMesh(h);
        CHECK(before != nullptr, "and the handle resolves");
        CHECK(before->hasRealization(), "a fresh mesh has a GPU realization");
        CHECK(before->isDrawable(), "and is drawable");
        CHECK(before->indexCount == 3, "with its index count");

        rm.invalidateGpuMeshes();

        const Mesh* after = rm.getMesh(h);
        CHECK(after != nullptr, "the SAME handle still resolves after the loss");
        CHECK(after == before, "naming the same record — identity was never re-minted");
        CHECK(!after->hasRealization(), "whose realization is gone");
        CHECK(!after->isDrawable(), "so the draw path skips it instead of binding a dead buffer");
        CHECK(after->vertexBuffer == BufferHandle::Invalid, "the VBO is unavailable");
        CHECK(after->indexBuffer == BufferHandle::Invalid, "the EBO is unavailable");
        CHECK(after->layout == VertexLayoutHandle::Invalid, "the vertex layout is unavailable");
        // Bounds and index count are the identity's, not the realization's: they
        // are what culling reads while the geometry is on its way back.
        CHECK(after->indexCount == 3, "the index count survives the loss");
        CHECK(after->localMax == glm::vec3(1.0f), "and so do the bounds");
    }

    // --- The debt is declared, and declared once ---
    {
        MockGfxDevice d;
        resource::ResourceManager rm;
        rm.init(d);

        const auto a = makeMesh(rm, MeshRecovery::SourceReplayable);
        const auto b = makeMesh(rm, MeshRecovery::SourceReplayable);
        CHECK(rm.meshesAwaitingRematerialization().empty(), "a live device owes nothing");

        const u32 owed = rm.invalidateGpuMeshes();
        const auto awaiting = rm.meshesAwaitingRematerialization();
        CHECK(owed == 2, "the loss reports what it enqueued");
        CHECK(awaiting.size() == 2, "both meshes are owed");
        CHECK(owes(awaiting, a) && owes(awaiting, b), "by handle, and by the right ones");

        // One loss, one debt: a second sweep of the same event must not double it.
        rm.invalidateGpuMeshes();
        const auto again = rm.meshesAwaitingRematerialization();
        CHECK(again.size() == 2, "a second invalidate does not double the debt");
        CHECK(std::count(again.begin(), again.end(), a) == 1, "each handle is owed exactly once");
    }

    // --- Host-only geometry is counted, never quietly skipped ---
    {
        MockGfxDevice d;
        resource::ResourceManager rm;
        rm.init(d);

        const auto asset = makeMesh(rm, MeshRecovery::SourceReplayable);
        const auto hostOnly = makeMesh(rm, MeshRecovery::HostOnly);

        rm.invalidateGpuMeshes();
        const auto awaiting = rm.meshesAwaitingRematerialization();
        CHECK(awaiting.size() == 1, "only the replayable mesh is owed");
        CHECK(owes(awaiting, asset), "and it is the asset-backed one");
        CHECK(!owes(awaiting, hostOnly), "host-only geometry is not queued for a source it has not got");
        CHECK(rm.meshesLostNonRecoverable() == 1, "it is REPORTED as permanently gone");
        CHECK(rm.getMesh(hostOnly) != nullptr, "its handle still resolves");
        CHECK(!rm.getMesh(hostOnly)->isDrawable(), "and it is undrawable rather than drawing garbage");
    }

    // --- A dead device is not asked to free what it already lost ---
    {
        MockGfxDevice d;
        resource::ResourceManager rm;
        rm.init(d);
        makeMesh(rm, MeshRecovery::SourceReplayable);

        const int deletesBefore = d.deleteBufferCalls;
        rm.invalidateGpuMeshes();
        CHECK(d.deleteBufferCalls == deletesBefore,
              "invalidation deletes no buffer — the objects went with the device");
    }

    // --- The generation a realization belongs to is on the record ---
    {
        MockGfxDevice d;
        resource::ResourceManager rm;
        rm.init(d);

        const auto h = makeMesh(rm, MeshRecovery::SourceReplayable);
        CHECK(rm.getMesh(h)->realizationGeneration == d.deviceGeneration(),
              "a mesh records the device generation it was realized on");

        d.notifyDeviceLost(GfxDeviceLostReason::ContextLost, "gone");
        d.recoverDevice();
        CHECK(d.deviceGeneration() == 1, "a rebuilt device is a new generation");
        rm.invalidateGpuMeshes();
        CHECK(rm.getMesh(h)->realizationGeneration == 0,
              "and a mesh not yet rebuilt still carries the OLD one, so nothing can"
              " mistake a stale realization for a current one");
    }

    // --- A released mesh is not owed ---
    {
        MockGfxDevice d;
        resource::ResourceManager rm;
        rm.init(d);

        const auto keep = makeMesh(rm, MeshRecovery::SourceReplayable);
        const auto drop = makeMesh(rm, MeshRecovery::SourceReplayable);
        rm.invalidateGpuMeshes();
        CHECK(rm.meshesAwaitingRematerialization().size() == 2, "both are owed to begin with");

        rm.releaseMesh(drop);
        const auto awaiting = rm.meshesAwaitingRematerialization();
        CHECK(awaiting.size() == 1, "releasing a mesh cancels its debt");
        CHECK(owes(awaiting, keep), "leaving the one that is still there");
        CHECK(!owes(awaiting, drop), "and not an identity nothing holds any more");
    }

    // --- A mint the GPU refuses hands back nothing, not a mesh that draws nothing ---
    {
        MockGfxDevice d;
        resource::ResourceManager rm;
        rm.init(d);
        d.createBufferSucceeds = false;

        const auto h = makeMesh(rm, MeshRecovery::SourceReplayable);
        CHECK(!h.isValid(),
              "a mesh whose buffers the device refused is not minted at all — a pool record"
              " reads as valid while naming no GPU object, and would draw nothing forever");
    }

    // --- The source comes back INTO the handle it left ---
    {
        MockGfxDevice d;
        resource::ResourceManager rm;
        rm.init(d);

        const auto h = makeMesh(rm, MeshRecovery::SourceReplayable);
        const Mesh* record = rm.getMesh(h);
        rm.invalidateGpuMeshes();
        CHECK(!record->hasRealization(), "the mesh starts owed and unrealized");

        const Vertex verts[3] = {{0, 0, 0, 0, 0}, {2, 0, 0, 1, 0}, {0, 2, 0, 0, 1}};
        const u32 indices[3] = {0, 1, 2};
        const bool ok = rm.rematerializeMesh(
            h, ConstSpan<u8>(reinterpret_cast<const u8*>(verts), sizeof(verts)),
            ConstSpan<u32>(indices, 3), ConstSpan<GfxVertexAttribute>(kChannels, 2),
            sizeof(Vertex), glm::vec3(0.0f), glm::vec3(2.0f));

        CHECK(ok, "a replayed source rematerializes");
        CHECK(rm.getMesh(h) == record, "into the SAME record — no second handle was minted");
        CHECK(record->hasRealization(), "which has a realization again");
        CHECK(record->isDrawable(), "and is drawable again");
        CHECK(record->vertexBuffer != BufferHandle::Invalid, "on a new VBO");
        CHECK(record->indexBuffer != BufferHandle::Invalid, "a new EBO");
        CHECK(record->layout != VertexLayoutHandle::Invalid, "and a new vertex layout");
        CHECK(record->localMax == glm::vec3(2.0f), "carrying the geometry that was replayed");
        CHECK(rm.meshesAwaitingRematerialization().empty(),
              "and the debt is acknowledged, because the rebuild worked");
    }

    // --- A rebuild that fails leaves the debt standing ---
    {
        MockGfxDevice d;
        resource::ResourceManager rm;
        rm.init(d);

        const auto h = makeMesh(rm, MeshRecovery::SourceReplayable);
        rm.invalidateGpuMeshes();

        // Empty geometry: the decode produced nothing usable.
        const bool ok = rm.rematerializeMesh(
            h, ConstSpan<u8>(), ConstSpan<u32>(), ConstSpan<GfxVertexAttribute>(kChannels, 2),
            sizeof(Vertex), glm::vec3(0.0f), glm::vec3(1.0f));

        CHECK(!ok, "a rebuild that cannot happen reports failure");
        CHECK(owes(rm.meshesAwaitingRematerialization(), h),
              "and the handle is STILL owed — a debt dropped on failure is a hole nothing reports");
        CHECK(!rm.getMesh(h)->hasRealization(), "the mesh stays unrealized rather than half-built");
    }

    // --- A failed rebuild leaves a LIVE mesh exactly as it found it ---
    {
        MockGfxDevice d;
        resource::ResourceManager rm;
        rm.init(d);

        const auto h = makeMesh(rm, MeshRecovery::SourceReplayable);
        const Mesh* record = rm.getMesh(h);
        const BufferHandle vbo = record->vertexBuffer;
        const BufferHandle ebo = record->indexBuffer;
        CHECK(record->hasRealization(), "the mesh is realized to begin with");

        const bool empty = rm.rematerializeMesh(h, ConstSpan<u8>(), ConstSpan<u32>(),
                                                ConstSpan<GfxVertexAttribute>(kChannels, 2),
                                                sizeof(Vertex), glm::vec3(0.0f), glm::vec3(1.0f));
        CHECK(!empty, "a rebuild with nothing to build from fails");
        CHECK(record->hasRealization(), "and the mesh keeps what it had");

        // The other way it fails, and the one the promise is actually about: the
        // geometry is fine and the GPU cannot allocate for it.
        d.createBufferSucceeds = false;
        const Vertex verts[3] = {{0, 0, 0, 0, 0}, {1, 0, 0, 1, 0}, {0, 1, 0, 0, 1}};
        const u32 indices[3] = {0, 1, 2};
        const bool oom = rm.rematerializeMesh(
            h, ConstSpan<u8>(reinterpret_cast<const u8*>(verts), sizeof(verts)),
            ConstSpan<u32>(indices, 3), ConstSpan<GfxVertexAttribute>(kChannels, 2),
            sizeof(Vertex), glm::vec3(0.0f), glm::vec3(1.0f));
        CHECK(!oom, "a rebuild the GPU cannot allocate for fails");
        CHECK(record->hasRealization(),
              "and the mesh KEEPS the realization it had — a rebuild that cannot finish must"
              " not take away the geometry that was already drawing");
        CHECK(record->vertexBuffer == vbo, "the same VBO");
        CHECK(record->indexBuffer == ebo, "and the same EBO");
    }

    // --- Host-only geometry cannot be rematerialized into ---
    {
        MockGfxDevice d;
        resource::ResourceManager rm;
        rm.init(d);

        const auto h = makeMesh(rm, MeshRecovery::HostOnly);
        rm.invalidateGpuMeshes();

        const Vertex verts[3] = {{0, 0, 0, 0, 0}, {1, 0, 0, 1, 0}, {0, 1, 0, 0, 1}};
        const u32 indices[3] = {0, 1, 2};
        const bool ok = rm.rematerializeMesh(
            h, ConstSpan<u8>(reinterpret_cast<const u8*>(verts), sizeof(verts)),
            ConstSpan<u32>(indices, 3), ConstSpan<GfxVertexAttribute>(kChannels, 2),
            sizeof(Vertex), glm::vec3(0.0f), glm::vec3(1.0f));
        CHECK(!ok, "a host-only mesh refuses geometry it never had a source for");
        CHECK(!rm.getMesh(h)->hasRealization(), "and stays gone, as its producer declared");
    }

    // --- A rematerialized mesh belongs to the CURRENT generation ---
    {
        MockGfxDevice d;
        resource::ResourceManager rm;
        rm.init(d);

        const auto h = makeMesh(rm, MeshRecovery::SourceReplayable);
        CHECK(rm.getMesh(h)->realizationGeneration == 0, "minted on generation 0");

        d.notifyDeviceLost(GfxDeviceLostReason::ContextLost, "gone");
        d.recoverDevice();
        rm.invalidateGpuMeshes();

        const Vertex verts[3] = {{0, 0, 0, 0, 0}, {1, 0, 0, 1, 0}, {0, 1, 0, 0, 1}};
        const u32 indices[3] = {0, 1, 2};
        rm.rematerializeMesh(
            h, ConstSpan<u8>(reinterpret_cast<const u8*>(verts), sizeof(verts)),
            ConstSpan<u32>(indices, 3), ConstSpan<GfxVertexAttribute>(kChannels, 2),
            sizeof(Vertex), glm::vec3(0.0f), glm::vec3(1.0f));
        CHECK(rm.getMesh(h)->realizationGeneration == 1,
              "a rebuilt mesh records the generation it was rebuilt ON, so a stale realization"
              " cannot pass for a current one");
    }

    std::printf(g_failures ? "\n%d FAILURE(S)\n" : "\nall passed\n", g_failures);
    return g_failures ? 1 : 0;
}
