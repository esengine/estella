/**
 * @file    OutputLogPanel.cpp
 * @brief   Output log panel implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "OutputLogPanel.hpp"
#include "../../ui/UIContext.hpp"
#include "../../ui/rendering/UIBatchRenderer.hpp"
#include "../../ui/icons/Icons.hpp"
#include "../../math/Math.hpp"

#if ES_FEATURE_SDF_FONT
#include "../../ui/font/MSDFFont.hpp"
#endif

namespace esengine::editor {

// =============================================================================
// Constructor / Destructor
// =============================================================================

OutputLogPanel::OutputLogPanel(const ui::WidgetId& id)
    : Widget(id) {

    logSinkId_ = Log::addSink([this](const LogEntry& entry) {
        onLogEntry(entry);
    });
}

OutputLogPanel::~OutputLogPanel() {
    if (logSinkId_ != 0) {
        Log::removeSink(logSinkId_);
    }
}

// =============================================================================
// Public Methods
// =============================================================================

void OutputLogPanel::clear() {
    std::lock_guard<std::mutex> lock(entriesMutex_);
    entries_.clear();
    scrollOffset_ = 0.0f;
}

// =============================================================================
// Layout
// =============================================================================

glm::vec2 OutputLogPanel::measure(f32 availableWidth, f32 availableHeight) {
    return {availableWidth, availableHeight};
}

void OutputLogPanel::layout(const ui::Rect& bounds) {
    Widget::layout(bounds);

    clearButtonBounds_ = ui::Rect{
        bounds.x + bounds.width - 64.0f,
        bounds.y + 4.0f,
        24.0f,
        24.0f
    };

    autoScrollButtonBounds_ = ui::Rect{
        bounds.x + bounds.width - 36.0f,
        bounds.y + 4.0f,
        24.0f,
        24.0f
    };
}

// =============================================================================
// Rendering
// =============================================================================

void OutputLogPanel::render(ui::UIBatchRenderer& renderer) {
    ui::UIContext* ctx = getContext();
    if (!ctx) return;

    const ui::Rect& bounds = getBounds();

    constexpr glm::vec4 bgColor{0.118f, 0.118f, 0.118f, 1.0f};          // #1e1e1e
    constexpr glm::vec4 toolbarBg{0.145f, 0.145f, 0.149f, 1.0f};        // #252526
    constexpr glm::vec4 borderColor{0.235f, 0.235f, 0.235f, 1.0f};      // #3c3c3c
    constexpr glm::vec4 textColor{0.878f, 0.878f, 0.878f, 1.0f};        // #e0e0e0
    constexpr glm::vec4 iconColor{0.533f, 0.533f, 0.533f, 1.0f};        // #888
    constexpr glm::vec4 iconHoverColor{0.878f, 0.878f, 0.878f, 1.0f};   // #e0e0e0
    constexpr glm::vec4 activeColor{0.231f, 0.510f, 0.965f, 1.0f};      // #3b82f6
    constexpr glm::vec4 buttonHoverBg{0.235f, 0.235f, 0.235f, 1.0f};    // #3c3c3c

    renderer.drawRect(bounds, bgColor);

    ui::Rect toolbarBounds{bounds.x, bounds.y, bounds.width, TOOLBAR_HEIGHT};
    renderer.drawRect(toolbarBounds, toolbarBg);

    ui::Rect bottomBorder{bounds.x, bounds.y + TOOLBAR_HEIGHT - 1.0f, bounds.width, 1.0f};
    renderer.drawRect(bottomBorder, borderColor);

#if ES_FEATURE_SDF_FONT
    ui::MSDFFont* iconFont = ctx->getIconMSDFFont();
    ui::MSDFFont* textFont = ctx->getDefaultMSDFFont();

    if (iconFont) {
        if (clearHovered_) {
            renderer.drawRoundedRect(clearButtonBounds_, buttonHoverBg, ui::CornerRadii::all(3.0f));
        }
        renderer.drawTextInBounds(ui::icons::Trash2, clearButtonBounds_, *iconFont, 14.0f,
                                  clearHovered_ ? iconHoverColor : iconColor,
                                  ui::HAlign::Center, ui::VAlign::Center);

        if (autoScrollHovered_) {
            renderer.drawRoundedRect(autoScrollButtonBounds_, buttonHoverBg, ui::CornerRadii::all(3.0f));
        }
        renderer.drawTextInBounds(ui::icons::ChevronsDown, autoScrollButtonBounds_, *iconFont, 14.0f,
                                  autoScroll_ ? activeColor : (autoScrollHovered_ ? iconHoverColor : iconColor),
                                  ui::HAlign::Center, ui::VAlign::Center);
    }

    if (textFont) {
        ui::Rect logArea{
            bounds.x,
            bounds.y + TOOLBAR_HEIGHT,
            bounds.width,
            bounds.height - TOOLBAR_HEIGHT
        };

        renderer.pushClipRect(logArea);

        std::lock_guard<std::mutex> lock(entriesMutex_);

        f32 y = logArea.y - scrollOffset_;
        usize visibleCount = 0;

        for (const auto& entry : entries_) {
            if (!shouldShowEntry(entry.level)) continue;

            f32 lineY = y + visibleCount * LINE_HEIGHT;

            if (lineY + LINE_HEIGHT < logArea.y) {
                visibleCount++;
                continue;
            }
            if (lineY > logArea.y + logArea.height) {
                break;
            }

            glm::vec4 levelColor = getColorForLevel(entry.level);
            const char* prefix = getLevelPrefix(entry.level);

            ui::Rect prefixBounds{logArea.x + 8.0f, lineY, 60.0f, LINE_HEIGHT};
            renderer.drawTextInBounds(prefix, prefixBounds, *textFont, 12.0f, levelColor,
                                      ui::HAlign::Left, ui::VAlign::Center);

            ui::Rect msgBounds{logArea.x + 72.0f, lineY, logArea.width - 80.0f, LINE_HEIGHT};
            renderer.drawTextInBounds(entry.message, msgBounds, *textFont, 12.0f, textColor,
                                      ui::HAlign::Left, ui::VAlign::Center);

            visibleCount++;
        }

        f32 totalHeight = static_cast<f32>(visibleCount) * LINE_HEIGHT;
        maxScroll_ = glm::max(0.0f, totalHeight - logArea.height);

        renderer.popClipRect();
    }
#endif
}

// =============================================================================
// Event Handling
// =============================================================================

bool OutputLogPanel::onScroll(const ui::ScrollEvent& event) {
    const ui::Rect& bounds = getBounds();
    if (!bounds.contains(event.x, event.y)) {
        return false;
    }

    scrollOffset_ -= event.deltaY * 40.0f;
    scrollOffset_ = glm::clamp(scrollOffset_, 0.0f, maxScroll_);
    autoScroll_ = false;
    return true;
}

bool OutputLogPanel::onMouseDown(const ui::MouseButtonEvent& event) {
    if (event.button != ui::MouseButton::Left) {
        return false;
    }

    if (clearButtonBounds_.contains(event.x, event.y)) {
        clear();
        return true;
    }

    if (autoScrollButtonBounds_.contains(event.x, event.y)) {
        autoScroll_ = !autoScroll_;
        if (autoScroll_) {
            scrollOffset_ = maxScroll_;
        }
        return true;
    }

    return false;
}

bool OutputLogPanel::onMouseMove(const ui::MouseMoveEvent& event) {
    clearHovered_ = clearButtonBounds_.contains(event.x, event.y);
    autoScrollHovered_ = autoScrollButtonBounds_.contains(event.x, event.y);
    return false;
}

// =============================================================================
// Private Methods
// =============================================================================

void OutputLogPanel::onLogEntry(const LogEntry& entry) {
    std::lock_guard<std::mutex> lock(entriesMutex_);

    entries_.push_back(entry);

    while (entries_.size() > MAX_LOG_ENTRIES) {
        entries_.pop_front();
    }

    if (autoScroll_) {
        usize visibleCount = 0;
        for (const auto& e : entries_) {
            if (shouldShowEntry(e.level)) visibleCount++;
        }
        f32 totalHeight = static_cast<f32>(visibleCount) * LINE_HEIGHT;
        const ui::Rect& bounds = getBounds();
        f32 logAreaHeight = bounds.height - TOOLBAR_HEIGHT;
        maxScroll_ = glm::max(0.0f, totalHeight - logAreaHeight);
        scrollOffset_ = maxScroll_;
    }
}

bool OutputLogPanel::shouldShowEntry(LogLevel level) const {
    switch (level) {
        case LogLevel::Trace: return showTrace_;
        case LogLevel::Debug: return showDebug_;
        case LogLevel::Info:  return showInfo_;
        case LogLevel::Warn:  return showWarn_;
        case LogLevel::Error:
        case LogLevel::Fatal: return showError_;
        default: return true;
    }
}

glm::vec4 OutputLogPanel::getColorForLevel(LogLevel level) const {
    switch (level) {
        case LogLevel::Trace: return {0.533f, 0.533f, 0.533f, 1.0f};   // gray
        case LogLevel::Debug: return {0.533f, 0.533f, 0.533f, 1.0f};   // gray
        case LogLevel::Info:  return {0.231f, 0.510f, 0.965f, 1.0f};   // blue
        case LogLevel::Warn:  return {0.902f, 0.667f, 0.157f, 1.0f};   // yellow/orange
        case LogLevel::Error:
        case LogLevel::Fatal: return {0.937f, 0.325f, 0.314f, 1.0f};   // red
        default: return {0.878f, 0.878f, 0.878f, 1.0f};
    }
}

const char* OutputLogPanel::getLevelPrefix(LogLevel level) const {
    switch (level) {
        case LogLevel::Trace: return "[TRACE]";
        case LogLevel::Debug: return "[DEBUG]";
        case LogLevel::Info:  return "[INFO]";
        case LogLevel::Warn:  return "[WARN]";
        case LogLevel::Error: return "[ERROR]";
        case LogLevel::Fatal: return "[FATAL]";
        default: return "[???]";
    }
}

}  // namespace esengine::editor
