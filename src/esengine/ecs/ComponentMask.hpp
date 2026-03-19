/**
 * @file    ComponentMask.hpp
 * @brief   Dynamic bitset for tracking entity component membership
 * @details Uses small-buffer optimization with 128 bits stored inline.
 *          Heap allocation occurs only when component type IDs exceed 128.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

#include "../core/Types.hpp"

#ifdef _MSC_VER
#include <intrin.h>
#endif
#include <vector>

namespace esengine::ecs {

// =============================================================================
// ComponentMask Class
// =============================================================================

/**
 * @brief Dynamic bitset for tracking which components an entity has
 *
 * @details The first 128 bits are stored inline as two u64 words.
 *          An overflow vector is allocated only when type IDs exceed 128.
 */
class ComponentMask {
public:
    static constexpr u32 INLINE_WORDS = 2;
    static constexpr u32 BITS_PER_WORD = 64;
    static constexpr u32 INLINE_BITS = INLINE_WORDS * BITS_PER_WORD;

    ComponentMask() = default;

    /** @brief Sets the given bit */
    void set(u32 bit) {
        if (bit < INLINE_BITS) {
            inline_[bit / BITS_PER_WORD] |= (u64{1} << (bit % BITS_PER_WORD));
        } else {
            u32 idx = (bit - INLINE_BITS) / BITS_PER_WORD;
            if (idx >= overflow_.size()) {
                overflow_.resize(idx + 1, 0);
            }
            overflow_[idx] |= (u64{1} << ((bit - INLINE_BITS) % BITS_PER_WORD));
        }
    }

    /** @brief Clears the given bit */
    void clear(u32 bit) {
        if (bit < INLINE_BITS) {
            inline_[bit / BITS_PER_WORD] &= ~(u64{1} << (bit % BITS_PER_WORD));
        } else {
            u32 idx = (bit - INLINE_BITS) / BITS_PER_WORD;
            if (idx < overflow_.size()) {
                overflow_[idx] &= ~(u64{1} << ((bit - INLINE_BITS) % BITS_PER_WORD));
            }
        }
    }

    /** @brief Tests the given bit */
    [[nodiscard]] bool test(u32 bit) const {
        if (bit < INLINE_BITS) {
            return (inline_[bit / BITS_PER_WORD] & (u64{1} << (bit % BITS_PER_WORD))) != 0;
        }
        u32 idx = (bit - INLINE_BITS) / BITS_PER_WORD;
        if (idx >= overflow_.size()) return false;
        return (overflow_[idx] & (u64{1} << ((bit - INLINE_BITS) % BITS_PER_WORD))) != 0;
    }

    /** @brief Clears all bits */
    void reset() {
        inline_[0] = 0;
        inline_[1] = 0;
        overflow_.clear();
    }

    /** @brief Returns true if no bits are set */
    [[nodiscard]] bool none() const {
        if (inline_[0] != 0 || inline_[1] != 0) return false;
        for (auto w : overflow_) {
            if (w != 0) return false;
        }
        return true;
    }

    /**
     * @brief Iterates all set bits, calling fn(bitIndex) for each
     * @tparam Func Callable accepting u32
     */
    template<typename Func>
    void forEachSet(Func&& fn) const {
        for (u32 w = 0; w < INLINE_WORDS; ++w) {
            u64 word = inline_[w];
            while (word != 0) {
                u32 bit = ctz64(word);
                fn(w * BITS_PER_WORD + bit);
                word &= word - 1;
            }
        }
        for (u32 i = 0; i < overflow_.size(); ++i) {
            u64 word = overflow_[i];
            while (word != 0) {
                u32 bit = ctz64(word);
                fn(INLINE_BITS + i * BITS_PER_WORD + bit);
                word &= word - 1;
            }
        }
    }

private:
    /** @brief Count trailing zeros; val must be non-zero */
    static u32 ctz64(u64 val) {
        ES_ASSERT(val != 0, "ctz64 undefined for zero");
#if defined(__GNUC__) || defined(__clang__)
        return static_cast<u32>(__builtin_ctzll(val));
#elif defined(_MSC_VER)
        unsigned long idx;
        _BitScanForward64(&idx, val);
        return static_cast<u32>(idx);
#else
        u32 count = 0;
        while ((val & 1) == 0) { val >>= 1; ++count; }
        return count;
#endif
    }

    u64 inline_[INLINE_WORDS] = {0, 0};
    std::vector<u64> overflow_;
};

}  // namespace esengine::ecs
