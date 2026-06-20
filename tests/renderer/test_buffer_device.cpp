// Native MSVC/CTest harness for Buffer + CustomGeometry (RC5-GfxDevice).
//
// Compiles the converted Buffer.cpp + CustomGeometry.cpp against MockGfxDevice.
// Linking proves they no longer touch GL; the asserts confirm create/upload/
// attribute-setup/bind/delete all route through GfxDevice.

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
            CHECK(d.bufferDataCalls == 1, "createRaw -> device.bufferData");
            CHECK(vbo->getId() == 200, "buffer id is device-assigned");
            vbo->setDataRaw(verts, sizeof(verts));
            CHECK(d.bufferSubDataCalls == 1, "setDataRaw -> device.bufferSubData");
        }
        CHECK(d.deleteBufferCalls == 1, "destructor -> device.deleteBuffer");
    }

    // --- IndexBuffer ---
    {
        MockGfxDevice d;
        u32 idx[] = { 0, 1, 2, 2, 3, 0 };
        auto ibo = IndexBuffer::create(d, idx, 6);
        CHECK(ibo != nullptr, "IndexBuffer::create returns a buffer");
        CHECK(d.createBufferCalls == 1 && d.bufferDataCalls == 1, "create -> device.createBuffer + bufferData");
        CHECK(d.bindIndexBufferCalls >= 1, "create binds via device.bindIndexBuffer");
        CHECK(ibo->getCount() == 6, "index count stored");
        CHECK(!ibo->is16Bit(), "u32 indices not flagged 16-bit");
    }

    // --- VertexArray + attribute setup ---
    {
        MockGfxDevice d;
        float verts[] = { 0, 0, 0, 0 };
        auto vao = VertexArray::create(d);
        CHECK(d.createVertexArrayCalls == 1, "VertexArray::create -> device.createVertexArray");

        auto vbo = Shared<VertexBuffer>(VertexBuffer::createRaw(d, verts, sizeof(verts)));
        vbo->setLayout({
            { ShaderDataType::Float2, "a_position" },
            { ShaderDataType::Float2, "a_texCoord" },
        });
        vao->addVertexBuffer(vbo);
        CHECK(d.enableVertexAttribCalls == 2, "addVertexBuffer enables one attrib per layout entry");
        CHECK(d.vertexAttribPointerCalls == 2, "addVertexBuffer sets one pointer per layout entry");
        CHECK(d.bindVertexArrayCalls >= 1, "addVertexBuffer binds the VAO via device");
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
        CHECK(d.createVertexArrayCalls == 1, "geom.init creates a VAO via device");
        CHECK(d.createBufferCalls == 1, "geom.init creates a VBO via device");

        geom.setIndices(idx, 3);
        CHECK(geom.hasIndices() && geom.getIndexCount() == 3, "geom.setIndices stored an index buffer");
        CHECK(d.createBufferCalls == 2, "geom.setIndices creates an IBO via device");

        geom.bind(d);
        CHECK(d.bindVertexArrayCalls >= 1, "geom.bind routes through device");
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
        geom.bind(d);
        CHECK(d.bindVertexArrayCalls == 0, "bind on an empty-layout geometry is a no-op");
    }

    if (g_failures == 0) {
        std::printf("\nALL BUFFER/GEOMETRY TESTS PASSED\n");
        return 0;
    }
    std::printf("\n%d FAILURE(S)\n", g_failures);
    return 1;
}
