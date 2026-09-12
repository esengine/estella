// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    touch_stream.hpp
 * @brief   The touch stream every native platform feeds `eshost::touch` with.
 *
 *          One finger is one id, alive from its start to its end or cancel, and
 *          two fingers down at once are two live ids. The engine, the web
 *          adapter and the mini-game adapter have always worked that way; a
 *          host that collapses every finger onto id 0 makes the second press
 *          release the first, so two on-screen buttons can never be held
 *          together.
 *
 *          Platform-free on purpose: UIKit identifies a finger by the UITouch
 *          pointer and Android numbers its own, so what they share is the
 *          contract, and this is where it is stated and tested.
 */
#pragma once

#include <cstddef>
#include <cstdint>

namespace eshost::input {

/** Touch phases, valued as the `type` argument `eshost::touch` takes. */
enum Phase : int {
    kTouchStart = 0,
    kTouchMove = 1,
    kTouchEnd = 2,
    kTouchCancel = 3,
};

/** How many fingers a host tracks at once. Ten is every finger a person has;
 *  past that the extra touch is dropped rather than aliased onto a live id. */
inline constexpr int kMaxTouches = 10;

/**
 * Stable engine ids for a host that identifies a finger by a pointer (UIKit's
 * UITouch*). Ids are the smallest free slot, so an ordinary two-finger gesture
 * is 0 and 1, and a released id is reused only after its finger has ended.
 *
 * The pointer is a key, never dereferenced: it is only compared.
 */
class TouchIdTable {
public:
    /** This key's id, allocating one on first sight. -1 when full. */
    int acquire(const void* key) {
        const int existing = find(key);
        if (existing >= 0) return existing;
        for (int i = 0; i < kMaxTouches; ++i) {
            if (keys_[i] == nullptr) {
                keys_[i] = key;
                return i;
            }
        }
        return -1;
    }

    /** This key's id, or -1 when it holds none. */
    int find(const void* key) const {
        for (int i = 0; i < kMaxTouches; ++i) {
            if (keys_[i] == key) return i;
        }
        return -1;
    }

    /** Free this key's id and answer it, or -1 when it held none. */
    int release(const void* key) {
        const int id = find(key);
        if (id >= 0) keys_[id] = nullptr;
        return id;
    }

    /** Drop every id — a host tearing its surface down owes no ends. */
    void clear() {
        for (int i = 0; i < kMaxTouches; ++i) keys_[i] = nullptr;
    }

    int live() const {
        int n = 0;
        for (int i = 0; i < kMaxTouches; ++i) {
            if (keys_[i] != nullptr) ++n;
        }
        return n;
    }

private:
    const void* keys_[kMaxTouches] = {};
};

// Android MotionEvent action constants. Fixed by the platform ABI; android.cpp
// static_asserts these against the NDK's own so the two cannot drift.
inline constexpr int32_t kMotionActionMask = 0xff;
inline constexpr int32_t kMotionPointerIndexMask = 0xff00;
inline constexpr int32_t kMotionPointerIndexShift = 8;
inline constexpr int32_t kMotionActionDown = 0;
inline constexpr int32_t kMotionActionUp = 1;
inline constexpr int32_t kMotionActionMove = 2;
inline constexpr int32_t kMotionActionCancel = 3;
inline constexpr int32_t kMotionActionPointerDown = 5;
inline constexpr int32_t kMotionActionPointerUp = 6;

/** What one MotionEvent is about. `index` is the pointer it names, or every
 *  pointer in the event when `allPointers`; `handled` is false for an action
 *  that is not a touch at all (hover, scroll, outside). */
struct MotionAction {
    bool handled = false;
    Phase phase = kTouchCancel;
    bool allPointers = false;
    int index = 0;
};

/**
 * Decode a RAW `AMotionEvent_getAction` value — raw because the pointer a
 * POINTER_DOWN/UP names is packed into the same word as the action, and reading
 * only the masked action is exactly how a host ends up reporting every finger as
 * the first one.
 */
inline MotionAction decodeMotion(int32_t action) {
    MotionAction out;
    const int32_t masked = action & kMotionActionMask;
    const int index = static_cast<int>((action & kMotionPointerIndexMask) >> kMotionPointerIndexShift);
    switch (masked) {
        case kMotionActionDown:         return { true, kTouchStart, false, 0 };
        case kMotionActionPointerDown:  return { true, kTouchStart, false, index };
        case kMotionActionMove:         return { true, kTouchMove, true, 0 };
        case kMotionActionUp:           return { true, kTouchEnd, false, 0 };
        case kMotionActionPointerUp:    return { true, kTouchEnd, false, index };
        case kMotionActionCancel:       return { true, kTouchCancel, true, 0 };
        default:                        return out;
    }
}

} // namespace eshost::input
