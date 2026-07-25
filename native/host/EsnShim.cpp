// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    EsnShim.cpp
 * @brief   The host side of esn_shim.hpp — what the GENERATED bindings call.
 * @details Both generated TUs (per-component accessors and the engine's binding
 *          entry points) are written against this handful of free functions: the
 *          engine singletons the host runs one of, entity round-tripping, and the
 *          JS value readers. Keeping them in one TU is what lets the generator
 *          stay ignorant of how this host stores its state.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#include "esn_shim.hpp"

#include "Runtime.hpp"
#include "heap.hpp"

#include <cstring>

using namespace esengine;

// — Engine singletons: the host runs exactly one of each, so a binding
//   declaration that takes one by reference consumes no JS argument. —

esengine::ecs::Registry& esn_reg() { return *eshost::host().registry; }

esengine::resource::ResourceManager& esn_rm() {
    return eshost::host().ctx->require<esengine::resource::ResourceManager>();
}

// — Entity ids cross the boundary as the native Entity's raw u32. —

esengine::Entity esn_entity(JSContext* ctx, JSValueConst v) {
    uint32_t raw = Entity::INVALID_RAW;
    JS_ToUint32(ctx, &raw, v);
    return Entity::fromRaw(raw);
}

// — Field readers the per-component marshalling is emitted against. —

bool esn_getnum(JSContext* ctx, JSValueConst obj, const char* key, double* out) {
    JSValue p = JS_GetPropertyStr(ctx, obj, key);
    bool ok = !JS_IsUndefined(p) && !JS_IsNull(p) && JS_ToFloat64(ctx, out, p) == 0;
    JS_FreeValue(ctx, p);
    return ok;
}

bool esn_getbool(JSContext* ctx, JSValueConst obj, const char* key, int* out) {
    JSValue p = JS_GetPropertyStr(ctx, obj, key);
    if (JS_IsUndefined(p) || JS_IsNull(p)) { JS_FreeValue(ctx, p); return false; }
    *out = JS_ToBool(ctx, p);
    JS_FreeValue(ctx, p);
    return true;
}

void esn_getvec(JSContext* ctx, JSValueConst obj, const char* key, float* dst, int n) {
    JSValue arr = JS_GetPropertyStr(ctx, obj, key);
    if (JS_IsArray(arr)) {
        for (int i = 0; i < n; ++i) {
            JSValue el = JS_GetPropertyUint32(ctx, arr, (uint32_t)i);
            double d = 0;
            JS_ToFloat64(ctx, &d, el);
            dst[i] = (float)d;
            JS_FreeValue(ctx, el);
        }
    }
    JS_FreeValue(ctx, arr);
}

void esn_bytes(JSContext* ctx, JSValueConst v, std::vector<esengine::u8>& out) {
    eshost::readByteSource(ctx, v, out);
}

// — The heap a `uintptr_t` argument addresses. A number IS the offset (the SDK
//   wrote through the shared ArrayBuffer); anything else is a buffer handed
//   straight across, which we copy into the arena so the binding still receives
//   memory inside the region BoundarySpan validates against. —

uint32_t esn_argOffset(JSContext* ctx, JSValueConst v) {
    if (JS_IsNumber(v)) {
        uint32_t offset = 0;
        JS_ToUint32(ctx, &offset, v);
        return offset;
    }
    std::vector<esengine::u8> bytes;
    eshost::readByteSource(ctx, v, bytes);
    if (bytes.empty()) return 0;
    const uint32_t offset = eshost::heapAlloc(bytes.size());
    void* dst = eshost::heapPtr(offset, bytes.size());
    if (!dst) return 0;
    std::memcpy(dst, bytes.data(), bytes.size());
    return offset;
}

void esn_argRelease(JSContext* ctx, JSValueConst v, uint32_t offset) {
    if (JS_IsNumber(v)) return;   // the caller owns it
    eshost::heapFree(offset);
}

uintptr_t esn_heapAddr(uint32_t offset) {
    return reinterpret_cast<uintptr_t>(eshost::heapPtr(offset, 0));
}

uint32_t esn_publish(EsnSlot& slot, const void* src, size_t bytes) {
    if (!src || bytes == 0) return 0;
    if (bytes > slot.capacity) {
        eshost::heapFree(slot.offset);
        slot.offset = eshost::heapAlloc(bytes);
        slot.capacity = slot.offset ? bytes : 0;
    }
    void* dst = eshost::heapPtr(slot.offset, bytes);
    if (!dst) return 0;
    std::memcpy(dst, src, bytes);
    return slot.offset;
}

JSValue esn_arraybuffer(JSContext* ctx, void* ptr, size_t size) {
    return JS_NewArrayBuffer(ctx, reinterpret_cast<uint8_t*>(ptr), size, nullptr, nullptr, false);
}
