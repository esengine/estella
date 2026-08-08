// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  test_text_edit.cpp
 * @brief The desktop text-editing model.
 *
 * It is the engine's ONLY implementation of caret and selection behaviour — the
 * web has a textarea, the phones have the OS keyboard — so nothing else can catch
 * a rule that is wrong here, and a wrong rule reads as "typing does something
 * odd", never as an error. Pure by construction (no SDL, no host), which is what
 * makes this a unit test rather than something you check by typing into a window.
 */
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include "doctest.h"

#include "media/text_edit.hpp"

using eshost::TextEditModel;
using eshost::utf16ToUtf8;
using eshost::utf8ToUtf16;

namespace {

TextEditModel field(const char* value = "", int start = 0, int end = -1) {
    TextEditModel m;
    const int at = end < 0 ? start : end;
    m.focus(value, start, at, false, 0, false);
    return m;
}

/** value + caret, the two things every case is about. */
std::string shown(const TextEditModel& m) {
    std::string out = m.value();
    out += "|";
    out += std::to_string(m.selectionStart());
    out += ",";
    out += std::to_string(m.selectionEnd());
    return out;
}

}  // namespace

TEST_CASE("UTF-8 and UTF-16 round trip, including what is outside the BMP") {
    for (const char* s : {"", "abc", "héllo", "日本語", "🎮 game", "a🎮b"}) {
        CHECK(utf16ToUtf8(utf8ToUtf16(s)) == std::string(s));
    }
    // An emoji is ONE character and TWO code units — which is exactly the case
    // every index rule below has to get right.
    CHECK(utf8ToUtf16("🎮").size() == 2);
    CHECK(utf8ToUtf16("abc").size() == 3);
}

TEST_CASE("malformed input is replaced, not dropped") {
    // Dropping would shorten the string under indices the caller already holds.
    CHECK(utf8ToUtf16("\xC3").size() == 1);            // truncated sequence
    CHECK(utf8ToUtf16("a\x80\x62").size() == 3);       // a stray continuation byte
    std::u16string lone;
    lone.push_back(0xD800);
    CHECK(utf16ToUtf8(lone) == "�");
}

TEST_CASE("typing replaces the selection") {
    TextEditModel m = field("hello", 1, 4);
    m.insert("i");
    CHECK(shown(m) == "hio|2,2");
}

TEST_CASE("backspace deletes a character, not a code unit") {
    TextEditModel m = field("a🎮");
    m.moveToEnd(false);
    m.backspace();
    // Deleting one code unit would leave half a surrogate pair — a character no
    // font has, and a string that no longer round-trips.
    CHECK(shown(m) == "a|1,1");
}

TEST_CASE("delete forward mirrors it") {
    TextEditModel m = field("🎮b", 0);
    m.deleteForward();
    CHECK(shown(m) == "b|0,0");
}

TEST_CASE("backspace with a selection deletes the selection, not one more") {
    TextEditModel m = field("hello", 1, 3);
    m.backspace();
    CHECK(shown(m) == "hlo|1,1");
}

TEST_CASE("arrows collapse a selection rather than moving from its edge") {
    TextEditModel m = field("hello", 1, 4);
    m.moveLeft(false, false);
    CHECK(shown(m) == "hello|1,1");
    m = field("hello", 1, 4);
    m.moveRight(false, false);
    CHECK(shown(m) == "hello|4,4");
}

TEST_CASE("shift+arrow extends from the anchor, in both directions") {
    TextEditModel m = field("hello", 2);
    m.moveRight(true, false);
    m.moveRight(true, false);
    CHECK(shown(m) == "hello|2,4");
    // And back: the anchor stays put while the moving end walks over it.
    m.moveLeft(true, false);
    CHECK(shown(m) == "hello|2,3");
}

TEST_CASE("word movement crosses one word however it is punctuated") {
    TextEditModel m = field("one  two three");
    m.moveToEnd(false);
    m.moveLeft(false, true);
    CHECK(shown(m) == "one  two three|9,9");
    m.moveLeft(false, true);
    CHECK(shown(m) == "one  two three|5,5");
    m.moveRight(false, true);
    CHECK(shown(m) == "one  two three|8,8");
}

TEST_CASE("an IME's preedit is shown but not committed") {
    TextEditModel m = field("ab", 1);
    m.setComposition("に");
    // Inside the value, which is the seam's contract: a field that hid it would
    // show nothing at all while a CJK user types.
    CHECK(m.value() == "aにb");
    CHECK(m.composing());
    // The caret sits AFTER the preedit — where the typing is going.
    CHECK(m.selectionStart() == 2);
    CHECK(m.selectionEnd() == 2);

    // The IME rewrites its preedit in place; the anchor must not walk.
    m.setComposition("にほん");
    CHECK(m.value() == "aにほんb");
    CHECK(m.selectionStart() == 4);
    m.insert("日本");
    CHECK(shown(m) == "a日本b|3,3");
    CHECK_FALSE(m.composing());
}

TEST_CASE("escape from a composition drops the preedit, not the text") {
    TextEditModel m = field("ab", 1);
    m.setComposition("に");
    m.backspace();
    CHECK(shown(m) == "ab|1,1");
    CHECK_FALSE(m.composing());
}

TEST_CASE("maxLength truncates the insertion, never mid-character") {
    TextEditModel m;
    m.focus("ab", 2, 2, false, 4, false);
    m.insert("c🎮d");
    // Two code units of room: 'c' takes one, the emoji needs two, so neither the
    // emoji nor 'd' fits — and half an emoji must not be what fits instead.
    CHECK(m.value() == "abc");
    // And with one unit of room the emoji is refused rather than halved.
    TextEditModel n;
    n.focus("abc", 3, 3, false, 4, false);
    n.insert("🎮");
    CHECK(n.value() == "abc");
}

TEST_CASE("select all, copy and cut work on characters") {
    TextEditModel m = field("a🎮b");
    m.selectAll();
    CHECK(m.selectedText() == "a🎮b");
    m.deleteSelection();
    CHECK(shown(m) == "|0,0");
}

TEST_CASE("the app's own write replaces everything, including a preedit") {
    TextEditModel m = field("abc", 1);
    m.setComposition("に");
    m.write("xyz", 3, 3);
    CHECK(shown(m) == "xyz|3,3");
    CHECK_FALSE(m.composing());
}

TEST_CASE("a selection given backwards is the same selection") {
    // No platform seam reports a selection's direction, so carrying one would be
    // a state that can never be refreshed.
    TextEditModel m = field("hello", 4, 1);
    CHECK(shown(m) == "hello|1,4");
}

TEST_CASE("indices outside the value are clamped rather than trusted") {
    TextEditModel m = field("hi", 99, 99);
    CHECK(shown(m) == "hi|2,2");
    m.write("hi", -5, 1);
    CHECK(shown(m) == "hi|0,1");
}
