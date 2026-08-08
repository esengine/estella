// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    text_edit.hpp
 * @brief   The editing surface a desktop host has to BE, because no desktop OS
 *          supplies one.
 * @details The platform seam (Host.hpp) hands the value and the selection to an
 *          OS editing surface: a UITextView on iOS, an EditText on Android, a
 *          hidden textarea on the web. Desktop has no such thing — the OS gives
 *          committed text and an IME's preedit, and every native app owns the
 *          caret, the selection and the editing keys itself. So this is that
 *          model, and it is the only implementation of it anywhere in the engine.
 *
 *          Deliberately free of SDL and of the host: the clipboard and the events
 *          are the caller's, so the rules below can be tested as what they are —
 *          a pure function of keystrokes.
 *
 *          Text is held as UTF-16 because that is the unit the seam's selection
 *          indices are in (a textarea's, an EditText's, an NSString's), and UTF-8
 *          only at the boundary where the value crosses into JS. Storing UTF-8 and
 *          converting indices would put a conversion in every operation instead of
 *          one at each edge.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include <string>

namespace eshost {

/** UTF-8 ⇄ UTF-16 at the boundary. Lone surrogates and truncated sequences are
 *  replaced rather than dropped, so a round trip never changes a string's length
 *  in a way the caller's indices did not account for. */
std::string utf16ToUtf8(const std::u16string& text);
std::u16string utf8ToUtf16(const std::string& text);

/**
 * One text field being edited: its content, its selection, and an IME's preedit.
 *
 * The reported selection is [start, end) in UTF-16 code units, ordered: no
 * platform seam reports a selection's direction, so neither does this.
 */
class TextEditModel {
  public:
    /** Begin editing @p value. Options that outlive one keystroke are held here
     *  because every key has to be judged against them. */
    void focus(const std::string& value, int selectionStart, int selectionEnd,
               bool multiline, int maxLength, bool password);
    void blur();
    bool focused() const { return focused_; }
    bool multiline() const { return multiline_; }
    bool password() const { return password_; }

    /** The app's own edit, which replaces everything — the seam's `write`. */
    void write(const std::string& value, int selectionStart, int selectionEnd);

    /** Committed text from the OS (SDL_EVENT_TEXT_INPUT): replaces the selection.
     *  Ends any composition, since the OS commits before it sends this. */
    void insert(const std::string& utf8);

    /**
     * The IME's in-progress text (SDL_EVENT_TEXT_EDITING), not committed.
     *
     * Reported inside {@link value}, as the seam declares: a field that hid it
     * would show nothing while a CJK user types. Empty ends the composition.
     */
    void setComposition(const std::string& utf8);
    bool composing() const { return !composition_.empty(); }

    // Editing keys. `select` extends the selection instead of collapsing it;
    // `word` moves by word rather than by code unit.
    void backspace();
    void deleteForward();
    void moveLeft(bool select, bool word);
    void moveRight(bool select, bool word);
    void moveToStart(bool select);
    void moveToEnd(bool select);
    void selectAll();

    /** The selected text, for a copy or a cut. Empty when nothing is selected. */
    std::string selectedText() const;
    /** Drop the selection's contents, for a cut. */
    void deleteSelection();

    /** What the seam reports: the value WITH any preedit in it, and where the
     *  caret sits inside that. */
    std::string value() const;
    int selectionStart() const;
    int selectionEnd() const;

  private:
    void replaceSelection(const std::u16string& with);
    void moveCaret(int to, bool select);
    int low() const;
    int high() const;
    int wordLeft() const;
    int wordRight() const;

    std::u16string text_;
    std::u16string composition_;
    /**
     * Anchor and caret, NOT start and end.
     *
     * Which end MOVES is state shift+arrow cannot do without: after extending
     * rightwards, shrinking walks the right end back, and a model holding only
     * {start, end} walks the left one instead.
     */
    int anchor_ = 0;
    int caret_ = 0;
    /** Where the preedit sits — the caret at the moment composition began, kept
     *  because the caret is reported AFTER the preedit while it is up. */
    int compositionAt_ = 0;
    bool focused_ = false;
    bool multiline_ = false;
    bool password_ = false;
    /** 0 = no limit, matching the seam's `maxLength`. */
    int maxLength_ = 0;
};

}  // namespace eshost
