// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    BoundarySpan.hpp
 * @brief   Always-on validation for JS-supplied pointer+length pairs at the WASM boundary.
 * @details A `uintptr_t` + count from JS is a bare claim about linear memory. Trusting it
 *          blindly lets a wrong count (or a 0 from a failed malloc / an undefined that
 *          coerced) read garbage or — on write paths — silently corrupt unrelated engine
 *          state inside the sandbox. These helpers are the single boundary gate:
 *          null-checked, overflow-checked, and range-checked against the actual wasm
 *          heap size. They are ALWAYS ON (never compiled out in release); on failure they
 *          log and return nullptr so the entry point degrades instead of hitting UB.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "../core/Types.hpp"

#ifdef __EMSCRIPTEN__
#include <emscripten/heap.h>
#endif

#include <cstdint>
#include <cstdio>

namespace esengine {

namespace detail {
#ifndef __EMSCRIPTEN__
// The bounded region a native host marshals JS buffers through (its heap arena).
// Zero until the host registers one, and then this gate is as strict on a device
// as it is in the sandbox.
inline uintptr_t g_boundaryBase = 0;
inline usize g_boundarySize = 0;
#endif

/** Whether [ptr, ptr+bytes) is inside the memory JS can legitimately address.
 *  Reports the region it checked against, so a rejection names what it compared. */
inline bool boundaryContains(uintptr_t ptr, u64 bytes, uintptr_t* base, u64* size) {
#ifdef __EMSCRIPTEN__
    // wasm: linear memory, addressed from 0.
    *base = 0;
    *size = static_cast<u64>(emscripten_get_heap_size());
#else
    *base = g_boundaryBase;
    *size = static_cast<u64>(g_boundarySize);
    if (*size == 0) {
        // No host region registered: a pointer here came from C++, not from JS
        // (or the host predates the arena). Null/overflow checks still applied.
        return true;
    }
#endif
    if (static_cast<u64>(ptr) < static_cast<u64>(*base)) return false;
    const u64 offset = static_cast<u64>(ptr) - static_cast<u64>(*base);
    return offset <= *size && bytes <= *size - offset;
}
}  // namespace detail

#ifndef __EMSCRIPTEN__
/**
 * @brief Declare the region a native host lets JS address (its heap arena).
 * @details Called once, when the host reserves the arena. Until then a native
 *          build only null/overflow-checks, since there is no bound to check.
 */
inline void setBoundaryRegion(uintptr_t base, usize size) {
    detail::g_boundaryBase = base;
    detail::g_boundarySize = size;
}
#endif

/**
 * @brief Validates a JS-supplied pointer to @p count elements of T and returns it typed.
 * @return The typed pointer, or nullptr (after an always-on error log) when the pointer
 *         is null, the byte size overflows, or the span leaves the wasm heap.
 * @note Errors go straight to stderr (→ the module's printErr → console), not the
 *       engine Log: this gate is shared by side modules (physics) that do not link
 *       the Log implementation, so the header must stay dependency-free.
 */
template <typename T>
inline const T* boundarySpan(uintptr_t ptr, u64 count, const char* what) {
    if (ptr == 0) {
        std::fprintf(stderr, "[boundary] %s: null buffer pointer; rejected\n", what);
        return nullptr;
    }
    const u64 bytes = count * static_cast<u64>(sizeof(T));
    if (count != 0 && bytes / count != sizeof(T)) {
        std::fprintf(stderr, "[boundary] %s: byte size overflows (count %llu); rejected\n",
                     what, static_cast<unsigned long long>(count));
        return nullptr;
    }
    uintptr_t base = 0;
    u64 size = 0;
    if (!detail::boundaryContains(ptr, bytes, &base, &size)) {
        std::fprintf(stderr,
                     "[boundary] %s: span [%llu + %llu bytes] leaves the heap "
                     "(%llu bytes at %llu); rejected\n",
                     what, static_cast<unsigned long long>(ptr),
                     static_cast<unsigned long long>(bytes),
                     static_cast<unsigned long long>(size),
                     static_cast<unsigned long long>(base));
        return nullptr;
    }
    return reinterpret_cast<const T*>(ptr);
}

/** @brief Mutable variant of boundarySpan, for entry points that WRITE into a JS buffer. */
template <typename T>
inline T* boundarySpanMut(uintptr_t ptr, u64 count, const char* what) {
    return const_cast<T*>(boundarySpan<T>(ptr, count, what));
}

}  // namespace esengine
