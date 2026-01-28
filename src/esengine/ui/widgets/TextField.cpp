/**
 * @file    TextField.cpp
 * @brief   Single-line text input widget implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "TextField.hpp"
#include "../UIContext.hpp"
#include "../rendering/UIBatchRenderer.hpp"
#include "../../core/Log.hpp"
#include "../../math/Math.hpp"

#if ES_FEATURE_SDF_FONT
#include "../font/MSDFFont.hpp"
#endif

#if ES_FEATURE_BITMAP_FONT
#include "../font/BitmapFont.hpp"
#endif

#include <algorithm>

namespace esengine::ui {

// =============================================================================
// Constructor
// =============================================================================

TextField::TextField(const WidgetId& id) : Widget(id) {}

// =============================================================================
// Text Management
// =============================================================================

void TextField::setText(const std::string& text) {
    if (text_ == text) {
        return;
    }

    text_ = text;
    cursorPos_ = text_.size();
    clearSelection();
    clampCursor();

    onTextChanged.publish(text_);
}

void TextField::setPlaceholder(const std::string& placeholder) {
    placeholder_ = placeholder;
}

// =============================================================================
// Cursor & Selection
// =============================================================================

void TextField::setCursorPosition(usize position) {
    cursorPos_ = glm::min(position, text_.size());
    clearSelection();
}

void TextField::setSelection(usize start, usize end) {
    selectionStart_ = glm::min(start, text_.size());
    selectionEnd_ = glm::min(end, text_.size());

    if (selectionStart_ > selectionEnd_) {
        std::swap(selectionStart_, selectionEnd_);
    }

    cursorPos_ = selectionEnd_;
}

void TextField::clearSelection() {
    selectionStart_ = cursorPos_;
    selectionEnd_ = cursorPos_;
}

std::string TextField::getSelectedText() const {
    if (!hasSelection()) {
        return "";
    }

    usize start = glm::min(selectionStart_, selectionEnd_);
    usize end = glm::max(selectionStart_, selectionEnd_);

    return text_.substr(start, end - start);
}

// =============================================================================
// Widget Interface
// =============================================================================

glm::vec2 TextField::measure(f32 availableWidth, f32 availableHeight) {
    f32 fontSize = 14.0f;
    if (getContext()) {
        fontSize = getContext()->getTheme().typography.fontSizeNormal;
    }

    f32 contentHeight = fontSize + TEXT_PADDING * 2.0f;

    f32 width = getWidth().resolve(availableWidth, availableWidth);
    f32 height = getHeight().resolve(availableHeight, contentHeight);

    const SizeConstraints& constraints = getConstraints();
    width = constraints.constrainWidth(width);
    height = constraints.constrainHeight(height);

    return glm::vec2(width, height);
}

void TextField::render(UIBatchRenderer& renderer) {
    const Rect& bounds = getBounds();
    const Insets& padding = getPadding();

    WidgetStyle style;
    if (getContext()) {
        style = getContext()->getTheme().getTextInputStyle();
    }

    WidgetState state{
        .hovered = isHovered(),
        .pressed = false,
        .focused = isFocused(),
        .disabled = !isEnabled(),
        .visible = true
    };

    glm::vec4 bgColor = style.getBackgroundColor(state);
    glm::vec4 borderColor = style.getBorderColor(state);
    glm::vec4 textColor = style.getTextColor(state);

    renderer.drawRect(bounds, bgColor);

    if (style.borderWidth > 0.0f) {
        renderer.drawRoundedRectOutline(bounds, borderColor, style.cornerRadii, style.borderWidth);
    }

    f32 fontSize = style.fontSize;
    if (getContext()) {
        fontSize = getContext()->getTheme().typography.fontSizeNormal;
    }

    f32 textX = bounds.x + padding.left + TEXT_PADDING - textOffsetX_;
    f32 textY = bounds.y + (bounds.height - fontSize) * 0.5f;

    if (text_.empty() && !isFocused() && !placeholder_.empty()) {
        glm::vec4 placeholderColor = textColor;
        placeholderColor.a *= 0.5f;

#if ES_FEATURE_SDF_FONT
        if (getContext() && getContext()->getDefaultMSDFFont()) {
            renderer.drawText(placeholder_, glm::vec2(textX, textY),
                            *getContext()->getDefaultMSDFFont(), fontSize, placeholderColor);
        }
#elif ES_FEATURE_BITMAP_FONT
        if (getContext() && getContext()->getDefaultBitmapFont()) {
            renderer.drawText(placeholder_, glm::vec2(textX, textY),
                            *getContext()->getDefaultBitmapFont(), fontSize, placeholderColor);
        }
#endif
    } else if (!text_.empty()) {
        if (hasSelection()) {
            usize start = glm::min(selectionStart_, selectionEnd_);
            usize end = glm::max(selectionStart_, selectionEnd_);

            f32 selStartX = getXForCharIndex(start);
            f32 selEndX = getXForCharIndex(end);

            glm::vec4 selectionColor = glm::vec4(0.3f, 0.5f, 0.8f, 0.4f);
            if (getContext()) {
                selectionColor = getContext()->getTheme().colors.selection;
            }

            Rect selRect{
                bounds.x + padding.left + TEXT_PADDING + selStartX - textOffsetX_,
                bounds.y + padding.top,
                selEndX - selStartX,
                bounds.height - padding.top - padding.bottom
            };
            renderer.drawRect(selRect, selectionColor);
        }

#if ES_FEATURE_SDF_FONT
        if (getContext() && getContext()->getDefaultMSDFFont()) {
            renderer.drawText(text_, glm::vec2(textX, textY),
                            *getContext()->getDefaultMSDFFont(), fontSize, textColor);
        }
#elif ES_FEATURE_BITMAP_FONT
        if (getContext() && getContext()->getDefaultBitmapFont()) {
            renderer.drawText(text_, glm::vec2(textX, textY),
                            *getContext()->getDefaultBitmapFont(), fontSize, textColor);
        }
#endif
    }

    if (isFocused()) {
        f32 cursorX = getXForCharIndex(cursorPos_);
        cursorX = bounds.x + padding.left + TEXT_PADDING + cursorX - textOffsetX_;

        Rect cursorRect{
            cursorX,
            bounds.y + padding.top + 2.0f,
            CURSOR_WIDTH,
            bounds.height - padding.top - padding.bottom - 4.0f
        };

        renderer.drawRect(cursorRect, textColor);
    }
}

bool TextField::onMouseDown(const MouseButtonEvent& event) {
    if (event.button != MouseButton::Left) {
        return false;
    }

    const Rect& bounds = getBounds();
    if (!bounds.contains(event.x, event.y)) {
        return false;
    }

    usize clickPos = getCharIndexAtX(event.x);
    cursorPos_ = clickPos;

    if (!event.shift) {
        clearSelection();
        dragStartPos_ = cursorPos_;
    } else {
        selectionEnd_ = cursorPos_;
    }

    isDragging_ = true;

    return true;
}

bool TextField::onMouseMove(const MouseMoveEvent& event) {
    if (!isDragging_) {
        return false;
    }

    usize movePos = getCharIndexAtX(event.x);
    cursorPos_ = movePos;

    selectionStart_ = glm::min(dragStartPos_, cursorPos_);
    selectionEnd_ = glm::max(dragStartPos_, cursorPos_);

    return true;
}

bool TextField::onMouseUp(const MouseButtonEvent& event) {
    if (event.button != MouseButton::Left) {
        return false;
    }

    isDragging_ = false;
    return true;
}

bool TextField::onKeyDown(const KeyEvent& event) {
    if (!isFocused()) {
        return false;
    }

    bool ctrl = event.ctrl;
    bool shift = event.shift;

    switch (event.key) {
        case KeyCode::Left:
            if (ctrl) {
                moveCursorByWord(false, shift);
            } else {
                moveCursor(-1, shift);
            }
            return true;

        case KeyCode::Right:
            if (ctrl) {
                moveCursorByWord(true, shift);
            } else {
                moveCursor(1, shift);
            }
            return true;

        case KeyCode::Home:
            moveCursorToLineEdge(false, shift);
            return true;

        case KeyCode::End:
            moveCursorToLineEdge(true, shift);
            return true;

        case KeyCode::Backspace:
            deleteText(false);
            return true;

        case KeyCode::Delete:
            deleteText(true);
            return true;

        case KeyCode::Enter:
            onSubmit.publish(text_);
            return true;

        case KeyCode::A:
            if (ctrl) {
                setSelection(0, text_.size());
                return true;
            }
            break;

        case KeyCode::C:
            if (ctrl) {
                copyToClipboard();
                return true;
            }
            break;

        case KeyCode::V:
            if (ctrl) {
                pasteFromClipboard();
                return true;
            }
            break;

        case KeyCode::X:
            if (ctrl) {
                cutToClipboard();
                return true;
            }
            break;

        default:
            break;
    }

    return false;
}

bool TextField::onTextInput(const TextInputEvent& event) {
    if (!isFocused()) {
        return false;
    }

    insertText(event.text);
    return true;
}

// =============================================================================
// Internal Methods
// =============================================================================

void TextField::insertText(const std::string& text) {
    if (text.empty()) {
        return;
    }

    if (hasSelection()) {
        usize start = glm::min(selectionStart_, selectionEnd_);
        usize end = glm::max(selectionStart_, selectionEnd_);

        text_.erase(start, end - start);
        cursorPos_ = start;
        clearSelection();
    }

    text_.insert(cursorPos_, text);
    cursorPos_ += text.size();

    onTextChanged.publish(text_);
}

void TextField::deleteText(bool deleteForward) {
    if (hasSelection()) {
        usize start = glm::min(selectionStart_, selectionEnd_);
        usize end = glm::max(selectionStart_, selectionEnd_);

        text_.erase(start, end - start);
        cursorPos_ = start;
        clearSelection();

        onTextChanged.publish(text_);
        return;
    }

    if (deleteForward) {
        if (cursorPos_ < text_.size()) {
            text_.erase(cursorPos_, 1);
            onTextChanged.publish(text_);
        }
    } else {
        if (cursorPos_ > 0) {
            text_.erase(cursorPos_ - 1, 1);
            cursorPos_--;
            onTextChanged.publish(text_);
        }
    }
}

void TextField::moveCursor(i32 offset, bool extendSelection) {
    if (!extendSelection && hasSelection() && offset != 0) {
        if (offset < 0) {
            cursorPos_ = glm::min(selectionStart_, selectionEnd_);
        } else {
            cursorPos_ = glm::max(selectionStart_, selectionEnd_);
        }
        clearSelection();
        return;
    }

    usize oldPos = cursorPos_;

    if (offset < 0) {
        usize absOffset = static_cast<usize>(-offset);
        if (cursorPos_ >= absOffset) {
            cursorPos_ -= absOffset;
        } else {
            cursorPos_ = 0;
        }
    } else {
        cursorPos_ += static_cast<usize>(offset);
    }

    clampCursor();

    if (extendSelection) {
        if (!hasSelection()) {
            selectionStart_ = oldPos;
        }
        selectionEnd_ = cursorPos_;
    } else {
        clearSelection();
    }
}

void TextField::moveCursorByWord(bool forward, bool extendSelection) {
    if (text_.empty()) {
        return;
    }

    usize oldPos = cursorPos_;

    if (forward) {
        while (cursorPos_ < text_.size() && std::isspace(text_[cursorPos_])) {
            cursorPos_++;
        }

        while (cursorPos_ < text_.size() && !std::isspace(text_[cursorPos_])) {
            cursorPos_++;
        }
    } else {
        if (cursorPos_ > 0) {
            cursorPos_--;
        }

        while (cursorPos_ > 0 && std::isspace(text_[cursorPos_])) {
            cursorPos_--;
        }

        while (cursorPos_ > 0 && !std::isspace(text_[cursorPos_ - 1])) {
            cursorPos_--;
        }
    }

    if (extendSelection) {
        if (!hasSelection()) {
            selectionStart_ = oldPos;
        }
        selectionEnd_ = cursorPos_;
    } else {
        clearSelection();
    }
}

void TextField::moveCursorToLineEdge(bool toEnd, bool extendSelection) {
    usize oldPos = cursorPos_;

    cursorPos_ = toEnd ? text_.size() : 0;

    if (extendSelection) {
        if (!hasSelection()) {
            selectionStart_ = oldPos;
        }
        selectionEnd_ = cursorPos_;
    } else {
        clearSelection();
    }
}

void TextField::copyToClipboard() {
    if (!hasSelection()) {
        return;
    }

    std::string selectedText = getSelectedText();
    if (getContext()) {
        getContext()->setClipboardText(selectedText);
    }
}

void TextField::pasteFromClipboard() {
    if (!getContext()) {
        return;
    }

    std::string clipboardText = getContext()->getClipboardText();
    if (!clipboardText.empty()) {
        insertText(clipboardText);
    }
}

void TextField::cutToClipboard() {
    if (!hasSelection()) {
        return;
    }

    copyToClipboard();
    deleteText(true);
}

usize TextField::getCharIndexAtX(f32 x) const {
    if (!getContext()) {
        return 0;
    }

    const Rect& bounds = getBounds();
    const Insets& padding = getPadding();

    f32 relativeX = x - bounds.x - padding.left - TEXT_PADDING + textOffsetX_;

    if (relativeX <= 0.0f) {
        return 0;
    }

    f32 fontSize = getContext()->getTheme().typography.fontSizeNormal;

    f32 currentX = 0.0f;
    for (usize i = 0; i < text_.size(); ++i) {
        f32 charWidth = fontSize * 0.6f;
#if ES_FEATURE_SDF_FONT
        MSDFFont* font = getContext()->getDefaultMSDFFont();
        if (font) {
            charWidth = font->getCharWidth(static_cast<u32>(text_[i]), fontSize);
        }
#elif ES_FEATURE_BITMAP_FONT
        BitmapFont* font = getContext()->getDefaultBitmapFont();
        if (font) {
            charWidth = font->getCharWidth(static_cast<u32>(text_[i]), fontSize);
        }
#endif

        if (relativeX < currentX + charWidth * 0.5f) {
            return i;
        }

        currentX += charWidth;
    }

    return text_.size();
}

f32 TextField::getXForCharIndex(usize index) const {
    if (index == 0 || !getContext()) {
        return 0.0f;
    }

    f32 fontSize = getContext()->getTheme().typography.fontSizeNormal;

#if ES_FEATURE_SDF_FONT
    MSDFFont* font = getContext()->getDefaultMSDFFont();
    if (font) {
        f32 currentX = 0.0f;
        for (usize i = 0; i < index && i < text_.size(); ++i) {
            currentX += font->getCharWidth(static_cast<u32>(text_[i]), fontSize);
        }
        return currentX;
    }
#elif ES_FEATURE_BITMAP_FONT
    BitmapFont* font = getContext()->getDefaultBitmapFont();
    if (font) {
        f32 currentX = 0.0f;
        for (usize i = 0; i < index && i < text_.size(); ++i) {
            currentX += font->getCharWidth(static_cast<u32>(text_[i]), fontSize);
        }
        return currentX;
    }
#endif

    f32 charWidth = fontSize * 0.6f;
    return static_cast<f32>(index) * charWidth;
}

void TextField::clampCursor() {
    cursorPos_ = glm::min(cursorPos_, text_.size());
}

void TextField::updateSelectionAnchor() {
    if (!hasSelection()) {
        selectionStart_ = cursorPos_;
    }
}

}  // namespace esengine::ui
