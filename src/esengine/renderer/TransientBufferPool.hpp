#pragma once

#include "../core/Types.hpp"
#include "GfxDevice.hpp"

#include <vector>
#include <array>

namespace esengine {

enum class LayoutId : u8 {
    Batch    = 0,
    Shape    = 2,
    MatSprite = 3,
};

static constexpr u32 LAYOUT_COUNT = 4;

class TransientBufferPool {
public:
    explicit TransientBufferPool(GfxDevice& device);

    void init(u32 initialVertexBytes = 2 * 1024 * 1024,
              u32 initialIndexCount = 256 * 1024);
    void shutdown();

    void beginFrame();

    u32 allocVertices(u32 byteSize);
    u32 allocIndices(u32 count);

    void writeVertices(u32 byteOffset, const void* data, u32 byteSize);
    void writeIndices(u32 indexOffset, const u16* data, u32 count);

    u32 appendVertices(const void* data, u32 byteSize);
    u32 appendIndices(const u16* data, u32 count);

    void upload();

    void bindLayout(LayoutId layout);

    u8* vertexData() { return vertex_staging_.data(); }
    u32 vertexBytesUsed() const { return vertex_write_pos_; }
    u32 indicesUsed() const { return index_write_pos_; }
    u32 vboId() const { return vbo_; }
    u32 eboId() const { return ebo_; }

private:
    void setupLayoutVAO(LayoutId layout);
    void growVertexBuffer(u32 requiredBytes);
    void growIndexBuffer(u32 requiredCount);

    GfxDevice& device_;

    std::array<u32, LAYOUT_COUNT> vaos_{};
    u32 vbo_ = 0;
    u32 ebo_ = 0;

    std::vector<u8> vertex_staging_;
    std::vector<u16> index_staging_;

    u32 vertex_write_pos_ = 0;
    u32 index_write_pos_ = 0;

    u32 vbo_capacity_ = 0;
    u32 ebo_capacity_ = 0;

    bool initialized_ = false;
};

}  // namespace esengine
