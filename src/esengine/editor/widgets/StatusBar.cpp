/**
 * @file    StatusBar.cpp
 * @brief   Editor status bar implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "StatusBar.hpp"
#include "../../ui/UIContext.hpp"
#include "../../ui/rendering/UIBatchRenderer.hpp"
#include "../../ui/icons/Icons.hpp"
#include "../../core/Log.hpp"

#if ES_FEATURE_SDF_FONT
#include "../../ui/font/MSDFFont.hpp"
#endif

#include "../../ui/font/SystemFont.hpp"

namespace esengine::editor {

// =============================================================================
// Constructor
// =============================================================================

StatusBar::StatusBar(const ui::WidgetId& id) : Widget(id) {
    setHeight(ui::SizeValue::px(HEIGHT));
    setWidth(ui::SizeValue::flex(1.0f));
}

// =============================================================================
// Layout
// =============================================================================

glm::vec2 StatusBar::measure(f32 availableWidth, f32 availableHeight) {
    (void)availableHeight;
    return {availableWidth, HEIGHT};
}

// =============================================================================
// Rendering
// =============================================================================

void StatusBar::render(ui::UIBatchRenderer& renderer) {
    ui::UIContext* ctx = getContext();
    if (!ctx) return;

    const ui::Rect& bounds = getBounds();

    constexpr glm::vec4 bgColor{0.176f, 0.176f, 0.176f, 1.0f};         // #2d2d2d
    constexpr glm::vec4 borderColor{0.102f, 0.102f, 0.102f, 1.0f};     // #1a1a1a
    constexpr glm::vec4 dividerColor{0.267f, 0.267f, 0.267f, 1.0f};    // #444
    constexpr glm::vec4 textColor{0.533f, 0.533f, 0.533f, 1.0f};       // #888
    constexpr glm::vec4 textHoverColor{0.8f, 0.8f, 0.8f, 1.0f};        // #ccc
    constexpr glm::vec4 activeColor{1.0f, 1.0f, 1.0f, 1.0f};           // #fff
    constexpr glm::vec4 activeBg{0.294f, 0.294f, 0.294f, 1.0f};        // #4a4a4a
    constexpr glm::vec4 activeIndicator{0.0f, 0.471f, 0.831f, 1.0f};   // #0078d4
    constexpr glm::vec4 hoverBg{1.0f, 1.0f, 1.0f, 0.05f};
    constexpr glm::vec4 assetsBtnBg{0.227f, 0.227f, 0.227f, 1.0f};     // #3a3a3a

    renderer.drawRect(bounds, bgColor);

    ui::Rect topBorder{bounds.x, bounds.y, bounds.width, 1.0f};
    renderer.drawRect(topBorder, borderColor);

    updateButtonRects();

#if ES_FEATURE_SDF_FONT
    ui::MSDFFont* iconFont = ctx->getIconMSDFFont();
    ui::MSDFFont* textFont = ctx->getDefaultMSDFFont();
#else
    ui::SystemFont* iconFont = ctx->getIconSystemFont();
    ui::SystemFont* textFont = ctx->getDefaultSystemFont();
#endif

    if (assetsButton_.bounds.width > 0) {
        glm::vec4 btnBg = assetsDrawerOpen_ ? activeBg : assetsBtnBg;
        glm::vec4 btnText = assetsDrawerOpen_ ? activeColor : textHoverColor;

        if (assetsButton_.hovered && !assetsDrawerOpen_) {
            btnBg = glm::vec4(0.267f, 0.267f, 0.267f, 1.0f);
        }

        renderer.drawRect(assetsButton_.bounds, btnBg);

        ui::Rect rightBorder{
            assetsButton_.bounds.x + assetsButton_.bounds.width - 1.0f,
            assetsButton_.bounds.y,
            1.0f,
            assetsButton_.bounds.height
        };
        renderer.drawRect(rightBorder, borderColor);

        if (assetsDrawerOpen_) {
            ui::Rect indicator{
                assetsButton_.bounds.x,
                assetsButton_.bounds.y + assetsButton_.bounds.height - 2.0f,
                assetsButton_.bounds.width,
                2.0f
            };
            renderer.drawRect(indicator, activeIndicator);
        }

        f32 iconX = assetsButton_.bounds.x + 10.0f;
        f32 centerY = assetsButton_.bounds.y + assetsButton_.bounds.height * 0.5f;

        if (iconFont) {
            ui::Rect iconBounds{iconX, centerY - 7.0f, 14.0f, 14.0f};
            renderer.drawTextInBounds(ui::icons::FolderOpen, iconBounds, *iconFont, 14.0f, btnText,
                                      ui::HAlign::Center, ui::VAlign::Center);
        }

        if (textFont) {
            f32 textX = iconX + 20.0f;
            ui::Rect textBounds{textX, centerY - 6.0f, 50.0f, 12.0f};
            renderer.drawTextInBounds("Assets", textBounds, *textFont, 11.0f, btnText,
                                      ui::HAlign::Left, ui::VAlign::Center);
        }

        if (iconFont) {
            const char* chevron = assetsDrawerOpen_ ? ui::icons::ChevronDown : ui::icons::ChevronUp;
            ui::Rect chevronBounds{assetsButton_.bounds.x + assetsButton_.bounds.width - 18.0f,
                                   centerY - 6.0f, 12.0f, 12.0f};
            renderer.drawTextInBounds(chevron, chevronBounds, *iconFont, 12.0f, btnText,
                                      ui::HAlign::Center, ui::VAlign::Center);
        }
    }

    f32 dividerX = assetsButton_.bounds.x + assetsButton_.bounds.width + 2.0f;
    ui::Rect divider1{dividerX, bounds.y + 5.0f, 1.0f, 14.0f};
    renderer.drawRect(divider1, dividerColor);

    if (outputButton_.bounds.width > 0) {
        glm::vec4 btnBg = outputDrawerOpen_ ? activeBg : glm::vec4(0.0f);
        glm::vec4 btnText = outputDrawerOpen_ ? activeColor : textColor;

        if (outputButton_.hovered && !outputDrawerOpen_) {
            btnBg = hoverBg;
            btnText = textHoverColor;
        }

        if (btnBg.a > 0.0f) {
            renderer.drawRect(outputButton_.bounds, btnBg);
        }

        if (outputDrawerOpen_) {
            ui::Rect indicator{
                outputButton_.bounds.x,
                outputButton_.bounds.y + outputButton_.bounds.height - 2.0f,
                outputButton_.bounds.width,
                2.0f
            };
            renderer.drawRect(indicator, activeIndicator);
        }

        f32 centerY = outputButton_.bounds.y + outputButton_.bounds.height * 0.5f;

        if (iconFont) {
            ui::Rect iconBounds{outputButton_.bounds.x + 8.0f, centerY - 6.0f, 12.0f, 12.0f};
            renderer.drawTextInBounds(ui::icons::FileText, iconBounds, *iconFont, 12.0f, btnText,
                                      ui::HAlign::Center, ui::VAlign::Center);
        }

        if (textFont) {
            ui::Rect textBounds{outputButton_.bounds.x + 24.0f, centerY - 6.0f, 50.0f, 12.0f};
            renderer.drawTextInBounds("Output", textBounds, *textFont, 11.0f, btnText,
                                      ui::HAlign::Left, ui::VAlign::Center);
        }
    }

    if (layoutButton_.bounds.width > 0 && iconFont) {
        glm::vec4 btnText = layoutButton_.hovered ? textHoverColor : textColor;
        glm::vec4 btnBg = layoutButton_.hovered ? hoverBg : glm::vec4(0.0f);

        if (btnBg.a > 0.0f) {
            renderer.drawRect(layoutButton_.bounds, btnBg);
        }

        f32 centerY = layoutButton_.bounds.y + layoutButton_.bounds.height * 0.5f;
        ui::Rect iconBounds{layoutButton_.bounds.x + 5.0f, centerY - 7.0f, 14.0f, 14.0f};
        renderer.drawTextInBounds(ui::icons::LayoutGrid, iconBounds, *iconFont, 14.0f, btnText,
                                  ui::HAlign::Center, ui::VAlign::Center);
    }

    if (textFont) {
        constexpr glm::vec4 saveIconColor{0.29f, 0.87f, 0.5f, 1.0f};  // #4ade80
        f32 rightX = bounds.x + bounds.width - 10.0f;
        f32 centerY = bounds.y + bounds.height * 0.5f;

        if (iconFont) {
            ui::Rect saveIconBounds{rightX - 80.0f, centerY - 6.0f, 12.0f, 12.0f};
            renderer.drawTextInBounds(ui::icons::Save, saveIconBounds, *iconFont, 12.0f, saveIconColor,
                                      ui::HAlign::Center, ui::VAlign::Center);
        }

        ui::Rect saveTextBounds{rightX - 65.0f, centerY - 6.0f, 60.0f, 12.0f};
        renderer.drawTextInBounds("Saved", saveTextBounds, *textFont, 11.0f, textColor,
                                  ui::HAlign::Left, ui::VAlign::Center);
    }
}

// =============================================================================
// Event Handling
// =============================================================================

bool StatusBar::onMouseDown(const ui::MouseButtonEvent& event) {
    ES_LOG_DEBUG("StatusBar::onMouseDown at ({}, {})", event.x, event.y);
    ES_LOG_DEBUG("  StatusBar bounds: ({}, {}, {}, {})",
                 getBounds().x, getBounds().y, getBounds().width, getBounds().height);
    ES_LOG_DEBUG("  AssetsButton bounds: ({}, {}, {}, {})",
                 assetsButton_.bounds.x, assetsButton_.bounds.y,
                 assetsButton_.bounds.width, assetsButton_.bounds.height);

    if (event.button != ui::MouseButton::Left) {
        return false;
    }

    if (assetsButton_.bounds.contains(event.x, event.y)) {
        ES_LOG_INFO("StatusBar: Assets button clicked!");
        onAssetsToggle.publish();
        return true;
    }

    if (outputButton_.bounds.contains(event.x, event.y)) {
        ES_LOG_INFO("StatusBar: Output button clicked!");
        onOutputToggle.publish();
        return true;
    }

    if (layoutButton_.bounds.contains(event.x, event.y)) {
        ES_LOG_INFO("StatusBar: Layout button clicked!");
        onResetLayout.publish();
        return true;
    }

    return false;
}

// =============================================================================
// Private Methods
// =============================================================================

void StatusBar::updateButtonRects() {
    const ui::Rect& bounds = getBounds();

    constexpr f32 ASSETS_BTN_WIDTH = 100.0f;
    constexpr f32 OUTPUT_BTN_WIDTH = 70.0f;
    constexpr f32 LAYOUT_BTN_WIDTH = 24.0f;

    assetsButton_.bounds = ui::Rect{
        bounds.x,
        bounds.y,
        ASSETS_BTN_WIDTH,
        bounds.height
    };

    outputButton_.bounds = ui::Rect{
        bounds.x + ASSETS_BTN_WIDTH + 5.0f,
        bounds.y,
        OUTPUT_BTN_WIDTH,
        bounds.height
    };

    layoutButton_.bounds = ui::Rect{
        bounds.x + bounds.width - LAYOUT_BTN_WIDTH - 100.0f,
        bounds.y,
        LAYOUT_BTN_WIDTH,
        bounds.height
    };
}

}  // namespace esengine::editor
