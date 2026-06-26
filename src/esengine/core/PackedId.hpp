// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    PackedId.hpp
 * @brief   Single source of truth for index+generation bit-packing.
 *
 * @details Both the ECS @ref esengine::Entity and the resource
 *          @ref esengine::resource::Handle pack a slot index plus a reuse
 *          generation into one integer. They used to each copy-paste the
 *          masks/shifts (three independent packings drifted apart — see the
 *          RC re-architecture's "multiple sources of truth" root cause). This
 *          template is the one definition both delegate to; the bit split is a
 *          parameter.
 *
 *          The u32 storage is deliberate and **structurally enforced** by the
 *          static_assert below: a packed id must fit in 32 bits so that
 *            - Entity stays 4 bytes (cache-friendly ECS dense arrays, cheap FFI),
 *            - the value is a JS safe integer (< 2^53) and crosses embind as a
 *              plain `number`,
 *            - it fits box2d's 32-bit wasm32 body user-data.
 *          Widening to a 64-bit id is therefore a deliberate, ABI-versioned
 *          change, not something a bit-split tweak can do by accident.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include <cstdint>

namespace esengine {

/**
 * @brief Index+generation packing into a u32, parameterized by the bit split.
 * @tparam IndexBits Number of low bits holding the slot index.
 * @tparam GenBits   Number of high bits holding the reuse generation.
 */
template <std::uint32_t IndexBits, std::uint32_t GenBits>
struct PackedId {
    static_assert(IndexBits + GenBits <= 32,
                  "PackedId index+generation must fit in a u32 (keeps the id 4 bytes, "
                  "a JS safe integer, and within box2d's 32-bit wasm32 user-data). "
                  "Widen the storage as a deliberate, ABI-versioned change instead.");
    static_assert(IndexBits > 0 && GenBits > 0, "both fields need at least one bit");

    static constexpr std::uint32_t INDEX_BITS = IndexBits;
    static constexpr std::uint32_t GEN_BITS = GenBits;
    static constexpr std::uint32_t INDEX_MASK = (std::uint32_t{1} << IndexBits) - 1;
    static constexpr std::uint32_t GEN_MASK = (std::uint32_t{1} << GenBits) - 1;

    /** @brief Largest representable slot index. */
    static constexpr std::uint32_t maxIndex() { return INDEX_MASK; }
    /** @brief Largest representable generation before it wraps. */
    static constexpr std::uint32_t maxGeneration() { return GEN_MASK; }

    /** @brief Extract the slot index from a packed value. */
    static constexpr std::uint32_t indexOf(std::uint32_t raw) { return raw & INDEX_MASK; }
    /** @brief Extract the generation from a packed value. */
    static constexpr std::uint32_t generationOf(std::uint32_t raw) {
        return (raw >> IndexBits) & GEN_MASK;
    }
    /**
     * @brief Pack an index + generation. Out-of-range inputs are masked, not
     *        trusted — callers that mint ids from runtime values must
     *        range-check the index first (e.g. Registry::activateIndex's
     *        ES_VERIFY), which is the structural home for that guard.
     */
    static constexpr std::uint32_t pack(std::uint32_t index, std::uint32_t generation) {
        return ((generation & GEN_MASK) << IndexBits) | (index & INDEX_MASK);
    }
};

}  // namespace esengine
