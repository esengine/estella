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
inline usize boundaryHeapSize() {
#ifdef __EMSCRIPTEN__
    return emscripten_get_heap_size();
#else
    // Native builds have no single linear-memory bound; null/overflow checks still apply.
    return SIZE_MAX;
#endif
}
}  // namespace detail

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
    const u64 heap = static_cast<u64>(detail::boundaryHeapSize());
    if (static_cast<u64>(ptr) > heap || bytes > heap - static_cast<u64>(ptr)) {
        std::fprintf(stderr,
                     "[boundary] %s: span [%llu + %llu bytes] exceeds the wasm heap (%llu); rejected\n",
                     what, static_cast<unsigned long long>(ptr),
                     static_cast<unsigned long long>(bytes),
                     static_cast<unsigned long long>(heap));
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
