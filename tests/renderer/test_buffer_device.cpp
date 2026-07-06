// Native MSVC/CTest harness for Buffer + CustomGeometry (GfxDevice).
//
// Compiles the converted Buffer.cpp + CustomGeometry.cpp against MockGfxDevice.
// Linking proves they no longer touch GL; the asserts confirm create/upload/
// layout-registration/bind/delete all route through GfxDevice.

#include "MockGfxDevice.hpp"
#include "esengine/renderer/Buffer.hpp"
#include "esengine/renderer/CustomGeometry.hpp"

#include <cstdio>
#include <vector>

using namespace esengine;

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

int main() {
    // --- VertexBuffer ---
    {
        MockGfxDevice d;
        float verts[] = { 0, 0, 1, 1, 2, 2, 3, 3 };
        {
            auto vbo = VertexBuffer::createRaw(d, verts, sizeof(verts));
            CHECK(vbo != nullptr, "VertexBuffer::createRaw returns a buffer");
            CHECK(d.createBufferCalls == 1, "createRaw -> device.createBuffer");
            CHECK(d.lastCreateBufferHadData, "createRaw uploads its initial data at creation");
            CHECK(d.lastBufferDesc.usage == GfxBufferUsage::Vertex, "createRaw declares Vertex usage");
            CHECK(d.lastBufferDesc.size == sizeof(verts), "createRaw sizes the buffer to the data");
            CHECK(vbo->handle() == BufferHandle{200}, "buffer handle is device-assigned");
            vbo->setDataRaw(verts, sizeof(verts));
            CHECK(d.updateBufferCalls == 1, "setDataRaw -> device.updateBuffer");
        }
        CHECK(d.deleteBufferCalls == 1, "destructor -> device.deleteBuffer");
    }

    // --- IndexBuffer ---
    {
        MockGfxDevice d;
        u32 idx[] = { 0, 1, 2, 2, 3, 0 };
        auto ibo = IndexBuffer::create(d, idx, 6);
        CHECK(ibo != nullptr, "IndexBuffer::create returns a buffer");
        CHECK(d.createBufferCalls == 1 && d.lastCreateBufferHadData, "create -> device.createBuffer with data");
        CHECK(d.lastBufferDesc.usage == GfxBufferUsage::Index, "create declares Index usage");
        CHECK(ibo->getCount() == 6, "index count stored");
        CHECK(!ibo->is16Bit(), "u32 indices not flagged 16-bit");
    }

    // --- CustomGeometry end-to-end (init + indices + bind, all via device) ---
    {
        MockGfxDevice d;
        float verts[] = { 0, 0, 0, 0, 1, 1, 1, 1 };  // 2 verts, stride 16
        u16 idx[] = { 0, 1, 2 };
        CustomGeometry geom;
        geom.init(d, verts, 8, VertexLayout{
            { ShaderDataType::Float2, "a_position" },
            { ShaderDataType::Float2, "a_texCoord" },
        });
        CHECK(geom.isValid(), "CustomGeometry initialized");
        CHECK(d.createBufferCalls == 1, "geom.init creates a VBO via device");
        CHECK(d.createVertexLayoutCalls == 1, "geom.init registers its vertex layout via device");
        CHECK(d.lastVertexLayoutDesc.attributeCount == 2, "layout carries one entry per attribute");
        CHECK(d.lastVertexLayoutDesc.strides[0] == 16, "layout carries the vertex stride");
        CHECK(geom.layoutHandle() != VertexLayoutHandle::Invalid, "geometry exposes its layout handle");

        geom.setIndices(idx, 3);
        CHECK(geom.hasIndices() && geom.getIndexCount() == 3, "geom.setIndices stored an index buffer");
        CHECK(d.createBufferCalls == 2, "geom.setIndices creates an IBO via device");

        geom.bind(d);
        CHECK(d.setVertexBufferCalls == 1 && d.setIndexBufferCalls == 1,
              "geom.bind sets the vertex + index buffers via device");
    }

    // --- CustomGeometry: an empty vertex layout must not divide-by-zero ---
    // stride 0 would trap on the vertexCount divide; init must bail gracefully.
    {
        MockGfxDevice d;
        float verts[] = { 0, 0, 0, 0 };
        CustomGeometry geom;
        geom.init(d, verts, 4, VertexLayout{});  // empty layout -> stride 0
        CHECK(!geom.isValid(), "init with an empty layout leaves the geometry invalid (no crash)");
        CHECK(d.createBufferCalls == 0, "no VBO is created for an empty layout");
        CHECK(d.createVertexLayoutCalls == 0, "no device layout is registered for an empty layout");
        geom.bind(d);
        CHECK(d.setVertexBufferCalls == 0, "bind on an empty-layout geometry is a no-op");
    }

    if (g_failures == 0) {
        std::printf("\nALL BUFFER/GEOMETRY TESTS PASSED\n");
        return 0;
    }
    std::printf("\n%d FAILURE(S)\n", g_failures);
    return 1;
}
