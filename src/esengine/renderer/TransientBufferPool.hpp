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

/**
 * Per-frame vertex/index staging with one independent VBO+EBO+VAO per layout.
 *
 * Design note: heterogeneous vertex formats (BatchVertex 20B, ShapeVertex 48B,
 * ...) cannot safely share a single VBO because each plugin computes
 * `baseVertex = byteOffset / sizeof(OwnVertex)`. Once a prior plugin writes a
 * non-multiple of the next plugin's vertex size, the next plugin's baseVertex
 * truncates and the GPU reads garbage vertices. Giving each layout its own
 * stream makes every offset "vertex 0" for that layout by construction — no
 * alignment discipline needed at call sites, no cross-plugin coupling.
 */
class TransientBufferPool {
public:
    explicit TransientBufferPool(GfxDevice& device);

    void init(u32 initialVertexBytes = 2 * 1024 * 1024,
              u32 initialIndexCount = 256 * 1024);
    void shutdown();

    void beginFrame();

    u32 allocVertices(LayoutId layout, u32 byteSize);
    u32 allocIndices(LayoutId layout, u32 count);

    void writeVertices(LayoutId layout, u32 byteOffset, const void* data, u32 byteSize);
    void writeIndices(LayoutId layout, u32 indexOffset, const u16* data, u32 count);

    u32 appendVertices(LayoutId layout, const void* data, u32 byteSize);
    u32 appendIndices(LayoutId layout, const u16* data, u32 count);

    /** Upload every non-empty stream's staging to its VBO/EBO. */
    void upload();

    /** Bind the VAO for this layout (which also binds its EBO — VAO state). */
    void bindLayout(LayoutId layout);

    /** Direct write-through pointer into a layout's staging, for hot paths
     *  that want to format vertices in place after `allocVertices`. */
    u8* vertexData(LayoutId layout);
    u32 vertexBytesUsed(LayoutId layout) const;
    u32 indicesUsed(LayoutId layout) const;
    u32 vboId(LayoutId layout) const;
    u32 eboId(LayoutId layout) const;

private:
    struct Stream {
        u32 vbo = 0;
        u32 ebo = 0;
        u32 vao = 0;
        std::vector<u8> vertex_staging;
        std::vector<u16> index_staging;
        u32 vertex_write_pos = 0;
        u32 index_write_pos = 0;
        u32 vbo_capacity = 0;
        u32 ebo_capacity = 0;
    };

    void setupStream(LayoutId layout);
    void growVertexStaging(Stream& s, u32 requiredBytes);
    void growIndexStaging(Stream& s, u32 requiredCount);

    Stream& stream(LayoutId layout);
    const Stream& stream(LayoutId layout) const;

    GfxDevice& device_;
    std::array<Stream, LAYOUT_COUNT> streams_{};
    u32 initial_vertex_bytes_ = 0;
    u32 initial_index_count_ = 0;
    bool initialized_ = false;
};

}  // namespace esengine
