/**
 * @file    TextField.hpp
 * @brief   Single-line text input widget
 * @details Provides text editing with cursor, selection, and clipboard support.
 *          Features:
 *          - Cursor positioning with blinking animation
 *          - Text selection via mouse drag or Shift+arrows
 *          - Clipboard operations (Ctrl+C/V/X)
 *          - Cursor navigation (arrows, Home/End, Ctrl+left/right)
 *          - Placeholder text for empty state
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

#include "Widget.hpp"
#include "../events/UIEvent.hpp"
#include "../../events/Signal.hpp"

#include <string>

namespace esengine::ui {

// =============================================================================
// TextField Class
// =============================================================================

/**
 * @brief Single-line text input widget
 *
 * @details TextField provides a complete text editing experience with:
 *          - Visual cursor with blinking animation (0.5s interval)
 *          - Text selection (mouse drag or keyboard)
 *          - Clipboard integration (copy/paste/cut)
 *          - Keyboard navigation
 *          - Placeholder text when empty
 *
 * @code
 * auto textField = makeUnique<TextField>(WidgetId("username"));
 * textField->setPlaceholder("Enter username...");
 * textField->onTextChanged.connect([](const std::string& text) {
 *     ES_LOG_INFO("Text changed: {}", text);
 * });
 * textField->onSubmit.connect([](const std::string& text) {
 *     ES_LOG_INFO("Submitted: {}", text);
 * });
 * @endcode
 */
class TextField : public Widget {
public:
    /**
     * @brief Constructs a text field widget
     * @param id Unique widget identifier
     */
    explicit TextField(const WidgetId& id);

    ~TextField() override = default;

    // =========================================================================
    // Text Management
    // =========================================================================

    /**
     * @brief Sets the text content
     * @param text New text value
     */
    void setText(const std::string& text);

    /**
     * @brief Gets the current text content
     * @return Current text value
     */
    const std::string& getText() const { return text_; }

    /**
     * @brief Sets the placeholder text shown when empty
     * @param placeholder Placeholder text
     */
    void setPlaceholder(const std::string& placeholder);

    /**
     * @brief Gets the placeholder text
     * @return Placeholder text
     */
    const std::string& getPlaceholder() const { return placeholder_; }

    // =========================================================================
    // Cursor & Selection
    // =========================================================================

    /**
     * @brief Sets the cursor position
     * @param position Character index (0-based)
     */
    void setCursorPosition(usize position);

    /**
     * @brief Gets the cursor position
     * @return Cursor character index
     */
    usize getCursorPosition() const { return cursorPos_; }

    /**
     * @brief Selects a range of text
     * @param start Start index (inclusive)
     * @param end End index (exclusive)
     */
    void setSelection(usize start, usize end);

    /**
     * @brief Clears the current selection
     */
    void clearSelection();

    /**
     * @brief Checks if there is a text selection
     * @return True if text is selected
     */
    bool hasSelection() const { return selectionStart_ != selectionEnd_; }

    /**
     * @brief Gets the selected text
     * @return Selected text or empty string if no selection
     */
    std::string getSelectedText() const;

    // =========================================================================
    // Widget Interface
    // =========================================================================

    glm::vec2 measure(f32 availableWidth, f32 availableHeight) override;
    void render(class UIBatchRenderer& renderer) override;

    bool isFocusable() const override { return true; }

    bool onMouseDown(const MouseButtonEvent& event) override;
    bool onMouseMove(const MouseMoveEvent& event) override;
    bool onMouseUp(const MouseButtonEvent& event) override;
    bool onKeyDown(const KeyEvent& event) override;
    bool onTextInput(const TextInputEvent& event) override;

    // =========================================================================
    // Signals
    // =========================================================================

    /**
     * @brief Emitted when text content changes
     */
    Signal<void(const std::string&)> onTextChanged;

    /**
     * @brief Emitted when Enter key is pressed
     */
    Signal<void(const std::string&)> onSubmit;

private:
    // =========================================================================
    // Internal Methods
    // =========================================================================

    /**
     * @brief Inserts text at cursor position
     * @param text Text to insert
     */
    void insertText(const std::string& text);

    /**
     * @brief Deletes selected text or character at cursor
     * @param deleteForward True to delete forward, false for backspace
     */
    void deleteText(bool deleteForward);

    /**
     * @brief Moves cursor by offset
     * @param offset Character offset (negative = left, positive = right)
     * @param extendSelection True to extend selection
     */
    void moveCursor(i32 offset, bool extendSelection);

    /**
     * @brief Moves cursor to word boundary
     * @param forward True to move forward, false for backward
     * @param extendSelection True to extend selection
     */
    void moveCursorByWord(bool forward, bool extendSelection);

    /**
     * @brief Moves cursor to line start or end
     * @param toEnd True to move to end, false for start
     * @param extendSelection True to extend selection
     */
    void moveCursorToLineEdge(bool toEnd, bool extendSelection);

    /**
     * @brief Copies selected text to clipboard
     */
    void copyToClipboard();

    /**
     * @brief Pastes text from clipboard
     */
    void pasteFromClipboard();

    /**
     * @brief Cuts selected text to clipboard
     */
    void cutToClipboard();

    /**
     * @brief Gets character index at screen position
     * @param x Screen X coordinate
     * @return Character index
     */
    usize getCharIndexAtX(f32 x) const;

    /**
     * @brief Gets screen X position for character index
     * @param index Character index
     * @return Screen X coordinate
     */
    f32 getXForCharIndex(usize index) const;

    /**
     * @brief Clamps cursor position to valid range
     */
    void clampCursor();

    /**
     * @brief Updates selection anchor when extending selection
     */
    void updateSelectionAnchor();

    // =========================================================================
    // Member Variables
    // =========================================================================

    std::string text_;
    std::string placeholder_;

    usize cursorPos_ = 0;
    usize selectionStart_ = 0;
    usize selectionEnd_ = 0;

    bool isDragging_ = false;
    usize dragStartPos_ = 0;

    f32 textOffsetX_ = 0.0f;  // Horizontal scroll offset
    static constexpr f32 TEXT_PADDING = 8.0f;
    static constexpr f32 CURSOR_WIDTH = 1.0f;
};

}  // namespace esengine::ui
