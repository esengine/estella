// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Boundary-span validation (RC3): every JS-supplied pointer+length pair crosses
// through boundarySpan, which must reject null pointers, overflowing byte sizes,
// and spans that leave the wasm heap — ALWAYS ON, independent of ES_ASSERT.
// Built with emscripten, so the heap-range checks here exercise the real
// emscripten_get_heap_size() bound.
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>

#include "esengine/bindings/BoundarySpan.hpp"

#include <cstdint>
#include <vector>

using namespace esengine;

TEST_CASE("valid span inside the heap passes through typed") {
    std::vector<f32> buf(64, 1.5f);
    auto ptr = reinterpret_cast<uintptr_t>(buf.data());

    const f32* span = boundarySpan<f32>(ptr, 64, "test.valid");
    REQUIRE(span != nullptr);
    CHECK(span == buf.data());
    CHECK(span[63] == 1.5f);
}

TEST_CASE("zero count with a valid pointer is allowed") {
    std::vector<u8> buf(4);
    CHECK(boundarySpan<u8>(reinterpret_cast<uintptr_t>(buf.data()), 0, "test.zero") != nullptr);
}

TEST_CASE("null pointer is rejected") {
    CHECK(boundarySpan<f32>(0, 16, "test.null") == nullptr);
    CHECK(boundarySpanMut<u16>(0, 1, "test.nullMut") == nullptr);
}

TEST_CASE("byte-size overflow is rejected") {
    std::vector<u8> buf(4);
    auto ptr = reinterpret_cast<uintptr_t>(buf.data());
    // count * sizeof(u32) wraps u64.
    CHECK(boundarySpan<u32>(ptr, UINT64_MAX / 2, "test.overflow") == nullptr);
}

TEST_CASE("span exceeding the wasm heap is rejected") {
#ifdef __EMSCRIPTEN__
    const u64 heap = emscripten_get_heap_size();
    // A pointer near the end of linear memory with a span that runs past it.
    CHECK(boundarySpan<f32>(static_cast<uintptr_t>(heap - 8), 100, "test.pastEnd") == nullptr);
    // A pointer entirely beyond the heap.
    CHECK(boundarySpan<u8>(static_cast<uintptr_t>(heap + 1024), 1, "test.beyond") == nullptr);
#else
    // Native builds have no linear-memory bound; null/overflow checks still hold.
    CHECK(true);
#endif
}

TEST_CASE("mutable variant validates identically and allows writes") {
    std::vector<u16> buf(8, 0);
    auto ptr = reinterpret_cast<uintptr_t>(buf.data());

    u16* span = boundarySpanMut<u16>(ptr, 8, "test.mut");
    REQUIRE(span != nullptr);
    span[7] = 42;
    CHECK(buf[7] == 42);
}
