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

    std::printf(g_failures ? "\n%d FAILURE(S)\n" : "\nall passed\n", g_failures);
    return g_failures ? 1 : 0;
}
