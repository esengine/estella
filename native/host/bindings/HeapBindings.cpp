// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    HeapBindings.cpp
 * @brief   The linear heap a `uintptr_t` argument addresses on a device.
 * @details See heap.hpp for why this exists. The allocator is a plain implicit
 *          block list with first fit and lazy coalescing — the traffic is a
 *          handful of scratch buffers per frame (tile arrays, polygon vertices,
 *          the readback slots), not a general-purpose workload, and being simple
 *          enough to audit matters more here than fitting a pathological pattern:
 *          a wrong offset is memory corruption on the wrong side of the boundary.
 *
 *          Registering the arena with `BoundarySpan` is the point of having ONE
 *          region: a JS-supplied span is range-checked on a device exactly as it
 *          is against wasm's linear memory, instead of degrading to a null check.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#include "Bindings.hpp"
#include "heap.hpp"
#include "esn_shim.hpp"

#include "esengine/bindings/BoundarySpan.hpp"

#include <cstdlib>
#include <cstring>

namespace eshost {
namespace {

// 32 MiB of address space. It has to hold the largest single buffer any
// subsystem marshals — a full tilemap layer's tile array is the big one — and
// pages that are never written never become resident, so the reservation is
// cheap. Exhaustion is logged, never silent.
constexpr size_t kHeapBytes = 32u * 1024u * 1024u;

// Payload alignment. 8 keeps a Float64Array view valid at any allocated offset,
// which is also what emscripten's malloc guarantees.
constexpr uint32_t kAlign = 8;

/** Block header. `size` is the payload size; the payload follows immediately, so
 *  the next header sits at `header + 8 + size`. */
struct Block {
    uint32_t size;
    uint32_t used;
};

uint8_t* g_base = nullptr;
size_t g_highWater = 0;
bool g_failed = false;

Block* blockAt(uint32_t headerOffset) {
    return reinterpret_cast<Block*>(g_base + headerOffset);
}

uint32_t roundUp(size_t n) {
    return static_cast<uint32_t>((n + kAlign - 1) & ~static_cast<size_t>(kAlign - 1));
}

}  // namespace

uint8_t* heapBase() {
    if (g_base || g_failed) return g_base;
    g_base = static_cast<uint8_t*>(std::malloc(kHeapBytes));
    if (!g_base) {
        g_failed = true;
        ESHOST_LOGE("heap: could not reserve %zu bytes — subsystems that marshal buffers "
                    "(physics, tilemaps, spine) will not run", kHeapBytes);
        return nullptr;
    }
    // One free block spanning everything. Offset 0 is the first header, so no
    // payload can ever live there and 0 keeps its null meaning.
    Block* first = blockAt(0);
    first->size = static_cast<uint32_t>(kHeapBytes - sizeof(Block));
    first->used = 0;
    // Same guarantee as the sandbox: a span from JS must land inside this region.
    esengine::setBoundaryRegion(reinterpret_cast<uintptr_t>(g_base), kHeapBytes);
    ESHOST_LOGI("heap: %zu KiB arena at %p (JS sees it as one ArrayBuffer)",
                kHeapBytes / 1024, static_cast<void*>(g_base));
    return g_base;
}

size_t heapSize() { return kHeapBytes; }

size_t heapHighWater() { return g_highWater; }

uint32_t heapAlloc(size_t bytes) {
    if (bytes == 0 || !heapBase()) return 0;
    const uint32_t want = roundUp(bytes);
    if (want > kHeapBytes) return 0;

    uint32_t offset = 0;
    while (offset + sizeof(Block) <= kHeapBytes) {
        Block* block = blockAt(offset);
        if (!block->used) {
            // Coalesce free neighbours as we pass them, which is the only
            // defragmentation this allocator does — enough for scratch traffic
            // that frees what it allocates.
            for (;;) {
                const uint32_t nextHeader = offset + static_cast<uint32_t>(sizeof(Block)) + block->size;
                if (nextHeader + sizeof(Block) > kHeapBytes) break;
                Block* next = blockAt(nextHeader);
                if (next->used) break;
                block->size += static_cast<uint32_t>(sizeof(Block)) + next->size;
            }
            if (block->size >= want) {
                // Split when the tail can still hold a header plus one aligned unit.
                if (block->size - want >= sizeof(Block) + kAlign) {
                    const uint32_t tail = offset + static_cast<uint32_t>(sizeof(Block)) + want;
                    Block* rest = blockAt(tail);
                    rest->size = block->size - want - static_cast<uint32_t>(sizeof(Block));
                    rest->used = 0;
                    block->size = want;
                }
                block->used = 1;
                const uint32_t payload = offset + static_cast<uint32_t>(sizeof(Block));
                if (payload + block->size > g_highWater) g_highWater = payload + block->size;
                return payload;
            }
        }
        offset += static_cast<uint32_t>(sizeof(Block)) + block->size;
    }
    ESHOST_LOGE("heap: out of memory (wanted %u bytes, arena is %zu KiB, high water %zu KiB)",
                want, kHeapBytes / 1024, g_highWater / 1024);
    return 0;
}

void heapFree(uint32_t offset) {
    if (offset == 0 || !g_base) return;
    if (offset < sizeof(Block) || offset >= kHeapBytes || (offset % kAlign) != 0) {
        ESHOST_LOGE("heap: free(%u) is not an allocated offset", offset);
        return;
    }
    Block* block = blockAt(offset - static_cast<uint32_t>(sizeof(Block)));
    if (!block->used) {
        ESHOST_LOGE("heap: double free at offset %u", offset);
        return;
    }
    block->used = 0;
}

void* heapPtr(uint32_t offset, size_t bytes) {
    if (offset == 0 || !g_base) return nullptr;
    if (offset >= kHeapBytes || bytes > kHeapBytes - offset) {
        ESHOST_LOGE("heap: offset %u (+%zu bytes) is outside the arena", offset, bytes);
        return nullptr;
    }
    return g_base + offset;
}

namespace {

// es_heap() -> ArrayBuffer over the whole arena. The SDK builds its typed-array
// views on this once (`createNativeHeap`); the arena never moves, so unlike a
// growable wasm heap the views stay valid for the process lifetime.
JSValue js_heap(JSContext* ctx, JSValueConst, int, JSValueConst*) {
    uint8_t* base = heapBase();
    if (!base) return JS_NULL;
    return esn_arraybuffer(ctx, base, heapSize());
}

// es_malloc(bytes) -> offset (0 when full, which reads as null like _malloc).
JSValue js_malloc(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (argc < 1) return JS_NewUint32(ctx, 0);
    int64_t bytes = 0;
    JS_ToInt64(ctx, &bytes, argv[0]);
    if (bytes <= 0) return JS_NewUint32(ctx, 0);
    return JS_NewUint32(ctx, heapAlloc(static_cast<size_t>(bytes)));
}

// es_free(offset).
JSValue js_free(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (argc < 1) return JS_UNDEFINED;
    uint32_t offset = 0;
    JS_ToUint32(ctx, &offset, argv[0]);
    heapFree(offset);
    return JS_UNDEFINED;
}

}  // namespace

void registerHeapBindings(HostState& h, JSValue global) {
    JS_SetPropertyStr(h.js, global, "es_heap", JS_NewCFunction(h.js, js_heap, "es_heap", 0));
    JS_SetPropertyStr(h.js, global, "es_malloc", JS_NewCFunction(h.js, js_malloc, "es_malloc", 1));
    JS_SetPropertyStr(h.js, global, "es_free", JS_NewCFunction(h.js, js_free, "es_free", 1));
}

}  // namespace eshost
