// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The native touch stream: one id per finger, alive from its start to its
 *        end. Both mobile hosts collapsed every finger onto id 0, so a second
 *        button press released the first — two buttons could never be held at
 *        once. The decoding is here rather than in the platform files because
 *        neither of those can be built off-device.
 */
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include "doctest.h"

#include "platform/touch_stream.hpp"

using namespace eshost::input;

/** A raw MotionEvent action word: the pointer a POINTER_DOWN/UP names is packed
 *  in beside the action, which is what makes reading the masked action alone a
 *  report about the wrong finger. */
static int32_t rawAction(int32_t action, int pointerIndex) {
    return action | (pointerIndex << kMotionPointerIndexShift);
}

TEST_CASE("a MotionEvent names the pointer it is about") {
    SUBCASE("the first finger down") {
        const MotionAction a = decodeMotion(kMotionActionDown);
        CHECK(a.handled);
        CHECK(a.phase == kTouchStart);
        CHECK_FALSE(a.allPointers);
        CHECK(a.index == 0);
    }
    SUBCASE("a second finger down names its own index") {
        const MotionAction a = decodeMotion(rawAction(kMotionActionPointerDown, 1));
        CHECK(a.handled);
        CHECK(a.phase == kTouchStart);
        CHECK(a.index == 1);
    }
    SUBCASE("a second finger up names its own index") {
        const MotionAction a = decodeMotion(rawAction(kMotionActionPointerUp, 2));
        CHECK(a.handled);
        CHECK(a.phase == kTouchEnd);
        CHECK(a.index == 2);
    }
    SUBCASE("a move is about every finger on the screen") {
        const MotionAction a = decodeMotion(kMotionActionMove);
        CHECK(a.phase == kTouchMove);
        CHECK(a.allPointers);
    }
    SUBCASE("a cancel releases every finger") {
        const MotionAction a = decodeMotion(kMotionActionCancel);
        CHECK(a.phase == kTouchCancel);
        CHECK(a.allPointers);
    }
    SUBCASE("anything else is not a touch") {
        CHECK_FALSE(decodeMotion(7 /* HOVER_MOVE */).handled);
        CHECK_FALSE(decodeMotion(4 /* OUTSIDE */).handled);
    }
}

TEST_CASE("a pointer-identified finger keeps one id for its whole life") {
    TouchIdTable ids;
    int a = 1, b = 2, c = 3;

    const int first = ids.acquire(&a);
    const int second = ids.acquire(&b);
    CHECK(first == 0);
    CHECK(second == 1);
    CHECK(first != second);
    // Moving is not a new finger.
    CHECK(ids.acquire(&a) == first);
    CHECK(ids.live() == 2);

    // Ending the SECOND must not disturb the first — the bug this file exists for.
    CHECK(ids.release(&b) == second);
    CHECK(ids.find(&a) == first);
    CHECK(ids.live() == 1);

    // A freed id is reused, and only after its finger ended.
    CHECK(ids.acquire(&c) == second);
    CHECK(ids.release(&c) == second);

    // An end for a finger that never started is not an end for someone else's.
    CHECK(ids.release(&c) == -1);

    ids.clear();
    CHECK(ids.live() == 0);
}

TEST_CASE("a full table drops the extra finger rather than aliasing a live one") {
    TouchIdTable ids;
    int keys[kMaxTouches + 1] = {};
    for (int i = 0; i < kMaxTouches; ++i) CHECK(ids.acquire(&keys[i]) == i);
    CHECK(ids.acquire(&keys[kMaxTouches]) == -1);
    CHECK(ids.live() == kMaxTouches);
}
