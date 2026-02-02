/**
 * @file    OutputLogPanel.hpp
 * @brief   Output log panel for displaying engine log messages
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

#include "../../ui/widgets/Widget.hpp"
#include "../../core/Log.hpp"

#include <deque>
#include <mutex>

namespace esengine::editor {

// =============================================================================
// OutputLogPanel Class
// =============================================================================

class OutputLogPanel : public ui::Widget {
public:
    static constexpr usize MAX_LOG_ENTRIES = 1000;
    static constexpr f32 LINE_HEIGHT = 18.0f;
    static constexpr f32 TOOLBAR_HEIGHT = 32.0f;

    explicit OutputLogPanel(const ui::WidgetId& id);
    ~OutputLogPanel() override;

    void clear();

    void setShowTrace(bool show) { showTrace_ = show; }
    void setShowDebug(bool show) { showDebug_ = show; }
    void setShowInfo(bool show) { showInfo_ = show; }
    void setShowWarn(bool show) { showWarn_ = show; }
    void setShowError(bool show) { showError_ = show; }

    bool isShowTrace() const { return showTrace_; }
    bool isShowDebug() const { return showDebug_; }
    bool isShowInfo() const { return showInfo_; }
    bool isShowWarn() const { return showWarn_; }
    bool isShowError() const { return showError_; }

    glm::vec2 measure(f32 availableWidth, f32 availableHeight) override;
    void render(ui::UIBatchRenderer& renderer) override;
    bool onScroll(const ui::ScrollEvent& event) override;
    bool onMouseDown(const ui::MouseButtonEvent& event) override;
    bool onMouseMove(const ui::MouseMoveEvent& event) override;

protected:
    void layoutChildren(const ui::Rect& contentBounds) override;

private:
    void onLogEntry(const LogEntry& entry);
    bool shouldShowEntry(LogLevel level) const;
    glm::vec4 getColorForLevel(LogLevel level) const;
    const char* getLevelPrefix(LogLevel level) const;

    std::deque<LogEntry> entries_;
    std::mutex entriesMutex_;
    u32 logSinkId_ = 0;

    f32 scrollOffset_ = 0.0f;
    f32 maxScroll_ = 0.0f;
    bool autoScroll_ = true;

    bool showTrace_ = true;
    bool showDebug_ = true;
    bool showInfo_ = true;
    bool showWarn_ = true;
    bool showError_ = true;

    ui::Rect clearButtonBounds_;
    ui::Rect autoScrollButtonBounds_;
    bool clearHovered_ = false;
    bool autoScrollHovered_ = false;
};

}  // namespace esengine::editor
