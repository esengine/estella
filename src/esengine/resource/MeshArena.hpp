// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    MeshArena.hpp
 * @brief   Meshes of one vertex shape sharing a vertex buffer, an index buffer and a layout.
 *
 * @details A mesh realized with buffers of its own is drawn with a vertex array of its own, and a scene of five hundred meshes
 *          switched vertex arrays five hundred times a frame (and pipelines with them, since a layout is part of a pipeline's
 *          key) though most of them have the same few shapes of vertex. Here the meshes of one shape take ranges of the same
 *          page: one layout, one vertex buffer, one index buffer, so a run of them is drawn without switching any of the three.
 *
 *          Indices are rebased when a mesh is placed (an index names a vertex of the page, not of the mesh): WebGL2 has no
 *          base vertex. Which is why a mesh that reads its own vertex number (a morph target's deltas are looked up by
 *          gl_VertexID) is not placed here, and keeps buffers of its own.
 *
 *          Pages belong to the device generation they were made on. After a loss, every page is owed, so every mesh in it is
 *          owed; its source rebuilds it, and the rebuild places it in a page of the new generation. A page whose last mesh has
 *          left is deleted.
 */
#pragma once

#include "../core/Types.hpp"
#include "../renderer/rhi/GfxDevice.hpp"
#include "../renderer/rhi/GfxEnums.hpp"
#include "../renderer/rhi/GfxContent.hpp"

#include <algorithm>
#include <cstring>
#include <vector>

namespace esengine::resource {

class MeshArena {
public:
    /** Where a placed mesh is. page is 1 + the page's index; 0 = not placed. */
    struct Slot {
        u32 page = 0;
        u32 firstVertex = 0;
        u32 vertexCount = 0;
        u32 firstIndex = 0;
        u32 indexCount = 0;
    };

    /** What a placed mesh draws through. */
    struct Binding {
        BufferHandle vertexBuffer = BufferHandle::Invalid;
        BufferHandle indexBuffer = BufferHandle::Invalid;
        VertexLayoutHandle layout = VertexLayoutHandle::Invalid;
    };

    /// The first page of a shape holds this much, and each one after it twice the last, up to kMaxPageBytes: a game with one
    /// small model does not pay for a page sized for a city.
    static constexpr u32 kFirstPageBytes = 1u << 20;
    static constexpr u32 kMaxPageBytes = 32u << 20;

    void init(GfxDevice& device) { device_ = &device; }

    /** Deletes every page. The meshes in them are gone already, or are about to be. */
    void shutdown() {
        for (Page& page : pages_) destroy(page);
        pages_.clear();
        device_ = nullptr;
    }

    /**
     * @brief Places a mesh: its vertices copied into a page of its shape, its indices rebased onto the page's.
     * @return false when it is not placed (bigger than a page may be, or the device refused a page); the caller then gives
     *         the mesh buffers of its own.
     */
    bool place(const VertexLayoutDesc& layout, GfxContent content, ConstSpan<u8> vertexBytes, u32 stride,
               ConstSpan<u32> indices, Slot& slot, Binding& binding) {
        if (!device_ || stride == 0 || vertexBytes.empty() || indices.empty()) return false;
        // A page is filled by writes into its middle, which a device that is not standing does not keep: what is made while it
        // is lost gets buffers of its own, made whole with their bytes.
        if (!device_->isDeviceUsable()) return false;
        const u64 vertexCount = vertexBytes.size() / stride;
        const u64 indexBytes = static_cast<u64>(indices.size()) * sizeof(u32);
        if (vertexBytes.size() > kMaxPageBytes / 2 || indexBytes > kMaxPageBytes / 2) return false;
        const u64 generation = device_->deviceGeneration();

        u32 pageIndex = 0;
        u32 firstVertex = 0, firstIndex = 0;
        bool found = false;
        u32 largest = 0;
        for (u32 i = 0; i < pages_.size() && !found; ++i) {
            Page& page = pages_[i];
            if (!page.alive || page.generation != generation || page.stride != stride || !sameLayout(page.layout, layout)) continue;
            largest = std::max(largest, page.vertexBytes);
            u32 v = 0, x = 0;
            if (!page.vertices.take(static_cast<u32>(vertexCount), v)) continue;
            if (!page.indices.take(static_cast<u32>(indices.size()), x)) { page.vertices.give(v, static_cast<u32>(vertexCount)); continue; }
            pageIndex = i;
            firstVertex = v;
            firstIndex = x;
            found = true;
        }
        if (!found) {
            u32 bytes = largest == 0 ? kFirstPageBytes : std::min(largest * 2, kMaxPageBytes);
            while (bytes < vertexBytes.size() * 2 || bytes < indexBytes * 2) bytes *= 2;
            if (!makePage(layout, content, stride, bytes, generation, pageIndex)) return false;
            Page& page = pages_[pageIndex];
            if (!page.vertices.take(static_cast<u32>(vertexCount), firstVertex)
                || !page.indices.take(static_cast<u32>(indices.size()), firstIndex)) {
                return false;
            }
        }

        Page& page = pages_[pageIndex];
        device_->updateBuffer(page.vb, firstVertex * stride, vertexBytes.data(), static_cast<u32>(vertexBytes.size()));
        rebased_.resize(indices.size());
        for (usize i = 0; i < indices.size(); ++i) rebased_[i] = indices[i] + firstVertex;
        device_->updateBuffer(page.ib, firstIndex * static_cast<u32>(sizeof(u32)), rebased_.data(),
                              static_cast<u32>(indexBytes));
        ++page.live;

        slot.page = pageIndex + 1;
        slot.firstVertex = firstVertex;
        slot.vertexCount = static_cast<u32>(vertexCount);
        slot.firstIndex = firstIndex;
        slot.indexCount = static_cast<u32>(indices.size());
        binding.vertexBuffer = page.vb;
        binding.indexBuffer = page.ib;
        binding.layout = page.layoutHandle;
        return true;
    }

    /** Gives a placed mesh's ranges back; a page left empty is deleted. */
    void free(const Slot& slot) {
        if (slot.page == 0 || slot.page > pages_.size()) return;
        Page& page = pages_[slot.page - 1];
        if (!page.alive) return;
        page.vertices.give(slot.firstVertex, slot.vertexCount);
        page.indices.give(slot.firstIndex, slot.indexCount);
        if (page.live > 0) --page.live;
        if (page.live == 0) destroy(page);
    }

    /** Pages standing, for a profiler: how many and the bytes they hold on the GPU. */
    u32 pageCount() const {
        u32 n = 0;
        for (const Page& page : pages_) n += page.alive ? 1u : 0u;
        return n;
    }
    u64 pageBytes() const {
        u64 n = 0;
        for (const Page& page : pages_) if (page.alive) n += static_cast<u64>(page.vertexBytes) + page.indexBytes;
        return n;
    }

    static bool sameLayout(const VertexLayoutDesc& a, const VertexLayoutDesc& b) {
        if (a.attributeCount != b.attributeCount) return false;
        for (u32 i = 0; i < a.attributeCount; ++i) {
            const GfxVertexAttribute& x = a.attributes[i];
            const GfxVertexAttribute& y = b.attributes[i];
            if (x.location != y.location || x.components != y.components || x.type != y.type
                || x.normalized != y.normalized || x.offset != y.offset || x.bufferSlot != y.bufferSlot) return false;
        }
        for (u32 s = 0; s < MAX_VERTEX_BUFFER_SLOTS; ++s) {
            if (a.strides[s] != b.strides[s] || a.instanceStep[s] != b.instanceStep[s]) return false;
        }
        return true;
    }

private:
    /** First-fit free ranges, in elements, kept sorted and merged. */
    struct FreeList {
        std::vector<std::pair<u32, u32>> ranges;  // at, size
        bool take(u32 n, u32& at) {
            for (usize i = 0; i < ranges.size(); ++i) {
                if (ranges[i].second < n) continue;
                at = ranges[i].first;
                ranges[i].first += n;
                ranges[i].second -= n;
                if (ranges[i].second == 0) ranges.erase(ranges.begin() + static_cast<std::ptrdiff_t>(i));
                return true;
            }
            return false;
        }
        void give(u32 at, u32 n) {
            if (n == 0) return;
            auto it = std::lower_bound(ranges.begin(), ranges.end(), std::make_pair(at, 0u));
            it = ranges.insert(it, {at, n});
            // Merge with the next, then with the previous.
            auto next = it + 1;
            if (next != ranges.end() && it->first + it->second == next->first) {
                it->second += next->second;
                ranges.erase(next);
            }
            if (it != ranges.begin()) {
                auto prev = it - 1;
                if (prev->first + prev->second == it->first) {
                    prev->second += it->second;
                    ranges.erase(it);
                }
            }
        }
    };

    struct Page {
        VertexLayoutDesc layout{};
        VertexLayoutHandle layoutHandle = VertexLayoutHandle::Invalid;
        BufferHandle vb = BufferHandle::Invalid;
        BufferHandle ib = BufferHandle::Invalid;
        u32 stride = 0;
        u32 vertexBytes = 0;
        u32 indexBytes = 0;
        FreeList vertices;
        FreeList indices;
        u64 generation = 0;
        u32 live = 0;
        bool alive = false;
    };

    bool makePage(const VertexLayoutDesc& layout, GfxContent content, u32 stride, u32 bytes, u64 generation, u32& index) {
        Page page;
        page.layout = layout;
        page.stride = stride;
        page.vertexBytes = (bytes / stride) * stride;
        page.indexBytes = bytes;
        page.generation = generation;
        page.vb = device_->createBuffer({GfxBufferUsage::Vertex, page.vertexBytes, false}, content, nullptr);
        page.ib = device_->createBuffer({GfxBufferUsage::Index, page.indexBytes, false}, content, nullptr);
        page.layoutHandle = device_->createVertexLayout(layout);
        if (page.vb == BufferHandle::Invalid || page.ib == BufferHandle::Invalid || page.layoutHandle == VertexLayoutHandle::Invalid) {
            destroy(page);
            return false;
        }
        page.vertices.ranges.push_back({0u, page.vertexBytes / stride});
        page.indices.ranges.push_back({0u, page.indexBytes / static_cast<u32>(sizeof(u32))});
        page.alive = true;
        // A dead page's place is reused rather than grown past: a slot names its page by index.
        for (u32 i = 0; i < pages_.size(); ++i) {
            if (!pages_[i].alive && pages_[i].vb == BufferHandle::Invalid) {
                pages_[i] = std::move(page);
                index = i;
                return true;
            }
        }
        pages_.push_back(std::move(page));
        index = static_cast<u32>(pages_.size() - 1);
        return true;
    }

    void destroy(Page& page) {
        if (device_) {
            if (page.vb != BufferHandle::Invalid) device_->deleteBuffer(page.vb);
            if (page.ib != BufferHandle::Invalid) device_->deleteBuffer(page.ib);
            if (page.layoutHandle != VertexLayoutHandle::Invalid) device_->deleteVertexLayout(page.layoutHandle);
        }
        page = Page{};
    }

    GfxDevice* device_ = nullptr;
    std::vector<Page> pages_;
    std::vector<u32> rebased_;
};

}  // namespace esengine::resource
