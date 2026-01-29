/**
 * @file    ColorEditor.hpp
 * @brief   Property editor for RGBA color values
 * @details Combines four FloatEditors (R, G, B, A) for editing glm::vec4.
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

#include "../PropertyEditor.hpp"
#include "FloatEditor.hpp"
#include "../../../ui/widgets/Label.hpp"
#include "../../../ui/widgets/Panel.hpp"
#include "../../../events/Connection.hpp"

#include <glm/glm.hpp>

namespace esengine::editor {

// =============================================================================
// ColorEditor Class
// =============================================================================

class ColorEditor : public PropertyEditor {
public:
    explicit ColorEditor(const ui::WidgetId& id, const std::string& propertyName);
    ~ColorEditor() override = default;

    void setValue(const std::any& value) override;
    std::any getValue() const override;

    glm::vec2 measure(f32 availableWidth, f32 availableHeight) override;
    void layout(const ui::Rect& bounds) override;
    void render(ui::UIBatchRenderer& renderer) override;

protected:
    Unique<Command> createCommand(const std::any& oldValue,
                                  const std::any& newValue) override;

private:
    void onComponentChanged();

    glm::vec4 value_{1.0f};
    bool updatingFromValue_ = false;

    ui::Label* mainLabel_ = nullptr;
    ui::Panel* colorPreview_ = nullptr;
    ui::Label* rLabel_ = nullptr;
    ui::Label* gLabel_ = nullptr;
    ui::Label* bLabel_ = nullptr;
    ui::Label* aLabel_ = nullptr;

    FloatEditor* rEditor_ = nullptr;
    FloatEditor* gEditor_ = nullptr;
    FloatEditor* bEditor_ = nullptr;
    FloatEditor* aEditor_ = nullptr;
    ConnectionHolder connections_;

    static constexpr f32 MAIN_LABEL_WIDTH = 60.0f;
    static constexpr f32 COLOR_PREVIEW_SIZE = 20.0f;
    static constexpr f32 COMPONENT_LABEL_WIDTH = 10.0f;
    static constexpr f32 FLOAT_EDITOR_WIDTH = 40.0f;
    static constexpr f32 SPACING = 4.0f;
    static constexpr f32 ROW_HEIGHT = 20.0f;
};

}  // namespace esengine::editor
