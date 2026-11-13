// The REAL ResourceManager.cpp against MockGfxDevice: a mesh and its buffers survive
// a device loss, replayable geometry is owed until its source puts it back, and
// host-only geometry comes back from the bytes the device kept.

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

void loseAndRecover(MockGfxDevice& d) {
    d.notifyDeviceLost(GfxDeviceLostReason::ContextLost, "gone");
    d.recoverDevice();
}

bool rematerialize(resource::ResourceManager& rm, resource::MeshHandle h, f32 extent) {
    const Vertex verts[3] = {{0, 0, 0, 0, 0}, {extent, 0, 0, 1, 0}, {0, extent, 0, 0, 1}};
    const u32 indices[3] = {0, 1, 2};
    return rm.rematerializeMesh(
        h, ConstSpan<u8>(reinterpret_cast<const u8*>(verts), sizeof(verts)),
        ConstSpan<u32>(indices, 3), ConstSpan<GfxVertexAttribute>(kChannels, 2),
        sizeof(Vertex), glm::vec3(0.0f), glm::vec3(extent));
}

// The same triangle with a third channel: a vertex of another shape, which no page of the first shape can hold.
bool rematerializeWide(resource::ResourceManager& rm, resource::MeshHandle h) {
    const f32 verts[3 * 8] = {0, 0, 0, 0, 0, 0, 0, 1,  1, 0, 0, 1, 0, 0, 0, 1,  0, 1, 0, 0, 1, 0, 0, 1};
    const u32 indices[3] = {0, 1, 2};
    const GfxVertexAttribute wide[3] = {
        {0, 3, GfxDataType::Float, false, 0, 0},
        {1, 2, GfxDataType::Float, false, 12, 0},
        {2, 3, GfxDataType::Float, false, 20, 0},
    };
    return rm.rematerializeMesh(
        h, ConstSpan<u8>(reinterpret_cast<const u8*>(verts), sizeof(verts)),
        ConstSpan<u32>(indices, 3), ConstSpan<GfxVertexAttribute>(wide, 3),
        8 * sizeof(f32), glm::vec3(0.0f), glm::vec3(1.0f));
}

}  // namespace

int main() {
    // Replayable meshes of one vertex shape share a page: its layout and both its buffers, each mesh at its own range. A mesh
    // of buffers of its own owns its layout. A page goes with its last mesh.
    {
        MockGfxDevice d;
        resource::ResourceManager rm;
        rm.init(d);
        const auto first = makeMesh(rm, MeshRecovery::SourceReplayable);
        const auto second = makeMesh(rm, MeshRecovery::SourceReplayable);
        const auto own = makeMesh(rm, MeshRecovery::HostOnly);
        const Mesh* a = rm.getMesh(first);
        const Mesh* b = rm.getMesh(second);
        const Mesh* o = rm.getMesh(own);
        CHECK(a->arenaPage != 0 && a->arenaPage == b->arenaPage, "two replayable meshes of one vertex shape share a page");
        CHECK(a->layout == b->layout && a->vertexBuffer == b->vertexBuffer && a->indexBuffer == b->indexBuffer,
              "its layout and both its buffers");
        CHECK(a->firstIndex != b->firstIndex && a->arenaFirstVertex != b->arenaFirstVertex,
              "each at its own range of the indices and of the vertices");
        CHECK(rm.meshPageCount() == 1, "one page holds them");
        CHECK(o->arenaPage == 0 && o->layout != a->layout, "a host-only mesh owns its buffers and its layout");
        const auto pageLayout = a->layout;
        const auto ownLayout = o->layout;
        CHECK(rematerialize(rm, first, 2.0f), "a shared mesh can replace its realization");
        CHECK(rm.getMesh(first)->layout == pageLayout && d.vertexLayoutDesc(pageLayout) != nullptr,
              "in the page it shares, whose layout stands");
        rm.releaseMesh(first);
        CHECK(d.vertexLayoutDesc(pageLayout) != nullptr, "releasing one mesh of a page keeps the page");
        rm.releaseMesh(second);
        CHECK(d.vertexLayoutDesc(pageLayout) == nullptr && rm.meshPageCount() == 0, "and the page goes with its last mesh");
        rm.shutdown();
        CHECK(d.vertexLayoutDesc(ownLayout) == nullptr && rm.getMesh(own) == nullptr,
              "shutdown releases remaining meshes and their layouts");
        const int deleted = d.deleteVertexLayoutCalls;
        rm.shutdown();
        CHECK(d.deleteVertexLayoutCalls == deleted, "resource shutdown is idempotent");
    }
    // A mint the device refuses releases the layout it made.
    {
        MockGfxDevice d;
        resource::ResourceManager rm;
        rm.init(d);
        const int before = d.deleteVertexLayoutCalls;
        d.createBufferSucceeds = false;
        CHECK(!makeMesh(rm, MeshRecovery::HostOnly).isValid(), "a host-only mesh the device refuses is not minted");
        CHECK(d.deleteVertexLayoutCalls == before + 1, "and the layout made for it is released");
    }
    // --- The identity and its buffers survive; replayable geometry is owed ---
    {
        MockGfxDevice d;
        resource::ResourceManager rm;
        rm.init(d);

        const auto h = makeMesh(rm, MeshRecovery::SourceReplayable);
        CHECK(h.isValid(), "a mesh mints a handle");
        const Mesh* before = rm.getMesh(h);
        CHECK(before != nullptr && before->isDrawable(), "a fresh mesh is drawable");
        const BufferHandle vbo = before->vertexBuffer;
        CHECK(rm.meshesAwaitingRematerialization().empty(), "a live device owes nothing");

        loseAndRecover(d);

        const Mesh* after = rm.getMesh(h);
        CHECK(after == before, "the SAME record — identity was never re-minted");
        CHECK(after->vertexBuffer == vbo, "behind the SAME buffer handle");
        CHECK(owes(rm.meshesAwaitingRematerialization(), h), "whose geometry is owed");
        CHECK(d.deviceStatus() == GfxDeviceStatus::Recovering, "which keeps the device Recovering");
        const auto rows = rm.meshRealizations();
        CHECK(rows.size() == 1 && !rows[0].realized, "and reads as not realized from outside");
    }

    // --- Host-only geometry comes back from the bytes the device kept ---
    {
        MockGfxDevice d;
        resource::ResourceManager rm;
        rm.init(d);

        const auto asset = makeMesh(rm, MeshRecovery::SourceReplayable);
        const auto hostOnly = makeMesh(rm, MeshRecovery::HostOnly);
        loseAndRecover(d);

        const auto awaiting = rm.meshesAwaitingRematerialization();
        CHECK(awaiting.size() == 1 && owes(awaiting, asset), "only the replayable mesh is owed");
        CHECK(!owes(awaiting, hostOnly), "host-only geometry is not waiting for a source it has not got");
        CHECK(rm.getMesh(hostOnly)->isDrawable(), "and draws: the device put its bytes back");
    }

    // --- A released mesh is not owed ---
    {
        MockGfxDevice d;
        resource::ResourceManager rm;
        rm.init(d);

        const auto keep = makeMesh(rm, MeshRecovery::SourceReplayable);
        const auto drop = makeMesh(rm, MeshRecovery::SourceReplayable);
        loseAndRecover(d);
        CHECK(rm.meshesAwaitingRematerialization().size() == 2, "both are owed to begin with");

        rm.releaseMesh(drop);
        const auto awaiting = rm.meshesAwaitingRematerialization();
        CHECK(awaiting.size() == 1 && owes(awaiting, keep), "releasing a mesh cancels its debt");
        rm.releaseMesh(keep);
        CHECK(d.deviceStatus() == GfxDeviceStatus::Live, "and with nothing left owed the device is whole");
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
        loseAndRecover(d);

        CHECK(rematerialize(rm, h, 2.0f), "a replayed source rematerializes");
        CHECK(rm.getMesh(h) == record, "into the SAME record — no second handle was minted");
        CHECK(record->isDrawable(), "which is drawable");
        CHECK(record->arenaPage != 0, "in a page of the new device: the page it left was owed whole");
        CHECK(record->localMax == glm::vec3(2.0f), "carrying the geometry that was replayed");
        CHECK(rm.meshesAwaitingRematerialization().empty(), "and the debt is paid");
        CHECK(d.deviceStatus() == GfxDeviceStatus::Live, "so the device is whole again");
        const auto rows = rm.meshRealizations();
        CHECK(rows.size() == 1 && rows[0].realized, "and the mesh reads as realized");
    }

    // --- A rebuild that fails leaves the debt standing ---
    {
        MockGfxDevice d;
        resource::ResourceManager rm;
        rm.init(d);

        const auto h = makeMesh(rm, MeshRecovery::SourceReplayable);
        loseAndRecover(d);

        const bool ok = rm.rematerializeMesh(
            h, ConstSpan<u8>(), ConstSpan<u32>(), ConstSpan<GfxVertexAttribute>(kChannels, 2),
            sizeof(Vertex), glm::vec3(0.0f), glm::vec3(1.0f));

        CHECK(!ok, "a rebuild that cannot happen reports failure");
        CHECK(owes(rm.meshesAwaitingRematerialization(), h),
              "and the handle is STILL owed — a debt dropped on failure is a hole nothing reports");
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

        const bool empty = rm.rematerializeMesh(h, ConstSpan<u8>(), ConstSpan<u32>(),
                                                ConstSpan<GfxVertexAttribute>(kChannels, 2),
                                                sizeof(Vertex), glm::vec3(0.0f), glm::vec3(1.0f));
        CHECK(!empty, "a rebuild with nothing to build from fails");
        CHECK(record->hasRealization(), "and the mesh keeps what it had");

        // The other way it fails, and the one the promise is actually about: the
        // geometry is fine and the GPU cannot allocate for it. A vertex of another shape, so
        // the page the mesh is in cannot take it and a new one has to be made.
        const u32 firstIndex = record->firstIndex;
        d.createBufferSucceeds = false;
        CHECK(!rematerializeWide(rm, h), "a rebuild the GPU cannot allocate for fails");
        CHECK(record->hasRealization(),
              "and the mesh KEEPS the realization it had — a rebuild that cannot finish must"
              " not take away the geometry that was already drawing");
        CHECK(record->vertexBuffer == vbo && record->indexBuffer == ebo && record->firstIndex == firstIndex,
              "the same buffers, at the same range");
    }

    // --- Host-only geometry cannot be rematerialized into ---
    {
        MockGfxDevice d;
        resource::ResourceManager rm;
        rm.init(d);

        const auto h = makeMesh(rm, MeshRecovery::HostOnly);
        loseAndRecover(d);
        CHECK(!rematerialize(rm, h, 1.0f), "a host-only mesh refuses geometry it never had a source for");
        CHECK(rm.getMesh(h)->isDrawable(), "and keeps the geometry the device restored");
    }

    std::printf(g_failures ? "\n%d FAILURE(S)\n" : "\nall passed\n", g_failures);
    return g_failures ? 1 : 0;
}
