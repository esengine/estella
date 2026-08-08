// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    text_edit.cpp
 * @brief   The desktop editing model — see text_edit.hpp for why it exists.
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#include "media/text_edit.hpp"

#include <algorithm>

namespace eshost {
namespace {

constexpr char16_t kReplacement = 0xFFFD;

bool isHighSurrogate(char16_t c) { return c >= 0xD800 && c <= 0xDBFF; }
bool isLowSurrogate(char16_t c) { return c >= 0xDC00 && c <= 0xDFFF; }

void appendUtf8(std::string& out, char32_t cp) {
    if (cp < 0x80) {
        out.push_back(static_cast<char>(cp));
    } else if (cp < 0x800) {
        out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    } else if (cp < 0x10000) {
        out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    } else {
        out.push_back(static_cast<char>(0xF0 | (cp >> 18)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    }
}

/** A word boundary as every text field draws it: runs of non-space, so one
 *  Ctrl+Left crosses one word however it is punctuated. */
bool isWordChar(char16_t c) {
    return c != u' ' && c != u'\t' && c != u'\n' && c != u'\r';
}

}  // namespace

std::string utf16ToUtf8(const std::u16string& text) {
    std::string out;
    out.reserve(text.size());
    for (size_t i = 0; i < text.size(); ++i) {
        char32_t cp = text[i];
        if (isHighSurrogate(text[i]) && i + 1 < text.size() && isLowSurrogate(text[i + 1])) {
            cp = 0x10000 + ((static_cast<char32_t>(text[i]) - 0xD800) << 10)
                 + (static_cast<char32_t>(text[i + 1]) - 0xDC00);
            ++i;
        } else if (isHighSurrogate(text[i]) || isLowSurrogate(text[i])) {
            cp = kReplacement;   // a half of a pair that lost its other half
        }
        appendUtf8(out, cp);
    }
    return out;
}

std::u16string utf8ToUtf16(const std::string& text) {
    std::u16string out;
    out.reserve(text.size());
    size_t i = 0;
    while (i < text.size()) {
        const unsigned char lead = static_cast<unsigned char>(text[i]);
        int extra = 0;
        char32_t cp = 0;
        if (lead < 0x80) { cp = lead; extra = 0; }
        else if ((lead & 0xE0) == 0xC0) { cp = lead & 0x1F; extra = 1; }
        else if ((lead & 0xF0) == 0xE0) { cp = lead & 0x0F; extra = 2; }
        else if ((lead & 0xF8) == 0xF0) { cp = lead & 0x07; extra = 3; }
        else { out.push_back(kReplacement); ++i; continue; }

        if (i + static_cast<size_t>(extra) >= text.size()) { out.push_back(kReplacement); break; }
        bool ok = true;
        for (int n = 1; n <= extra; ++n) {
            const unsigned char cont = static_cast<unsigned char>(text[i + static_cast<size_t>(n)]);
            if ((cont & 0xC0) != 0x80) { ok = false; break; }
            cp = (cp << 6) | (cont & 0x3F);
        }
        if (!ok) { out.push_back(kReplacement); ++i; continue; }
        i += static_cast<size_t>(extra) + 1;

        if (cp > 0x10FFFF) cp = kReplacement;
        if (cp >= 0x10000) {
            cp -= 0x10000;
            out.push_back(static_cast<char16_t>(0xD800 + (cp >> 10)));
            out.push_back(static_cast<char16_t>(0xDC00 + (cp & 0x3FF)));
        } else {
            out.push_back(static_cast<char16_t>(cp));
        }
    }
    return out;
}

void TextEditModel::focus(const std::string& value, int selectionStart, int selectionEnd,
                          bool multiline, int maxLength, bool password) {
    focused_ = true;
    multiline_ = multiline;
    password_ = password;
    maxLength_ = maxLength > 0 ? maxLength : 0;
    write(value, selectionStart, selectionEnd);
}

void TextEditModel::blur() {
    focused_ = false;
    composition_.clear();
}

void TextEditModel::write(const std::string& value, int selectionStart, int selectionEnd) {
    text_ = utf8ToUtf16(value);
    composition_.clear();
    const int size = static_cast<int>(text_.size());
    anchor_ = std::clamp(selectionStart, 0, size);
    caret_ = std::clamp(selectionEnd, 0, size);
}

int TextEditModel::low() const { return std::min(anchor_, caret_); }
int TextEditModel::high() const { return std::max(anchor_, caret_); }

void TextEditModel::insert(const std::string& utf8) {
    composition_.clear();
    replaceSelection(utf8ToUtf16(utf8));
}

void TextEditModel::setComposition(const std::string& utf8) {
    // The caret before the preedit is where it goes, and it is captured only when
    // a composition STARTS: an IME edits its preedit in place, and re-reading the
    // caret each time would walk it across the text.
    if (composition_.empty()) compositionAt_ = low();
    composition_ = utf8ToUtf16(utf8);
}

void TextEditModel::replaceSelection(const std::u16string& with) {
    const int at = low();
    text_.erase(static_cast<size_t>(at), static_cast<size_t>(high() - at));
    std::u16string insert = with;
    if (maxLength_ > 0) {
        const int room = maxLength_ - static_cast<int>(text_.size());
        if (room <= 0) insert.clear();
        else if (static_cast<int>(insert.size()) > room) {
            // Truncated at a code-unit boundary would split a surrogate pair into
            // two lone halves, which is a character no font has.
            int keep = room;
            if (keep > 0 && isHighSurrogate(insert[static_cast<size_t>(keep) - 1])) --keep;
            insert.resize(static_cast<size_t>(keep));
        }
    }
    text_.insert(static_cast<size_t>(at), insert);
    anchor_ = caret_ = at + static_cast<int>(insert.size());
}

void TextEditModel::moveCaret(int to, bool select) {
    caret_ = std::clamp(to, 0, static_cast<int>(text_.size()));
    if (!select) anchor_ = caret_;
}

int TextEditModel::wordLeft() const {
    int at = caret_;
    while (at > 0 && !isWordChar(text_[static_cast<size_t>(at) - 1])) --at;
    while (at > 0 && isWordChar(text_[static_cast<size_t>(at) - 1])) --at;
    return at;
}

int TextEditModel::wordRight() const {
    const int size = static_cast<int>(text_.size());
    int at = caret_;
    while (at < size && !isWordChar(text_[static_cast<size_t>(at)])) ++at;
    while (at < size && isWordChar(text_[static_cast<size_t>(at)])) ++at;
    return at;
}

void TextEditModel::backspace() {
    if (composing()) { composition_.clear(); return; }
    if (anchor_ == caret_) {
        if (caret_ == 0) return;
        int to = caret_ - 1;
        // One character, not one code unit: deleting half a surrogate pair leaves
        // a lone half behind.
        if (to > 0 && isLowSurrogate(text_[static_cast<size_t>(to)])
            && isHighSurrogate(text_[static_cast<size_t>(to) - 1])) --to;
        anchor_ = to;
    }
    replaceSelection({});
}

void TextEditModel::deleteForward() {
    if (composing()) { composition_.clear(); return; }
    const int size = static_cast<int>(text_.size());
    if (anchor_ == caret_) {
        if (caret_ >= size) return;
        int to = caret_ + 1;
        if (to < size && isHighSurrogate(text_[static_cast<size_t>(caret_)])
            && isLowSurrogate(text_[static_cast<size_t>(to)])) ++to;
        anchor_ = to;
    }
    replaceSelection({});
}

void TextEditModel::moveLeft(bool select, bool word) {
    if (word) { moveCaret(wordLeft(), select); return; }
    // Without shift, a selection COLLAPSES to its near edge rather than stepping
    // one further — what every text field does, and what makes Left after a
    // select-all put the caret at 0 instead of at -1.
    if (!select && anchor_ != caret_) { moveCaret(low(), false); return; }
    int to = caret_ - 1;
    if (to > 0 && isLowSurrogate(text_[static_cast<size_t>(to)])
        && isHighSurrogate(text_[static_cast<size_t>(to) - 1])) --to;
    moveCaret(to, select);
}

void TextEditModel::moveRight(bool select, bool word) {
    if (word) { moveCaret(wordRight(), select); return; }
    if (!select && anchor_ != caret_) { moveCaret(high(), false); return; }
    const int size = static_cast<int>(text_.size());
    int to = caret_ + 1;
    if (to < size && isHighSurrogate(text_[static_cast<size_t>(caret_)])
        && isLowSurrogate(text_[static_cast<size_t>(to)])) ++to;
    moveCaret(to, select);
}

void TextEditModel::moveToStart(bool select) { moveCaret(0, select); }
void TextEditModel::moveToEnd(bool select) { moveCaret(static_cast<int>(text_.size()), select); }

void TextEditModel::selectAll() {
    anchor_ = 0;
    caret_ = static_cast<int>(text_.size());
}

std::string TextEditModel::selectedText() const {
    if (anchor_ == caret_) return {};
    return utf16ToUtf8(text_.substr(static_cast<size_t>(low()), static_cast<size_t>(high() - low())));
}

void TextEditModel::deleteSelection() {
    if (anchor_ == caret_) return;
    replaceSelection({});
}

std::string TextEditModel::value() const {
    if (composition_.empty()) return utf16ToUtf8(text_);
    std::u16string shown = text_;
    shown.insert(static_cast<size_t>(std::clamp(compositionAt_, 0, static_cast<int>(shown.size()))),
                 composition_);
    return utf16ToUtf8(shown);
}

int TextEditModel::selectionStart() const {
    // While an IME is up the caret sits after the preedit, which is where the
    // user is typing — a caret left behind it would draw in the middle of the
    // characters being composed.
    return composition_.empty() ? low() : compositionAt_ + static_cast<int>(composition_.size());
}

int TextEditModel::selectionEnd() const {
    return composition_.empty() ? high() : selectionStart();
}

}  // namespace eshost
