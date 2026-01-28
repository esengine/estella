/**
 * @file    IntEditor.hpp
 * @brief   Property editor for integer values
 * @details Uses a TextField for input with optional slider.
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
#include "../../../ui/widgets/TextField.hpp"
#include "../../../ui/widgets/Slider.hpp"
#include "../../../ui/widgets/Label.hpp"
#include "../../../events/Connection.hpp"

namespace esengine::editor {

// =============================================================================
// IntEditor Class
// =============================================================================

class IntEditor : public PropertyEditor {
public:
    explicit IntEditor(const ui::WidgetId& id, const std::string& propertyName);
    ~IntEditor() override = default;

    void setValue(const std::any& value) override;
    std::any getValue() const override;

    void setRange(i32 min, i32 max);
    i32 getMin() const { return min_; }
    i32 getMax() const { return max_; }

    void setShowSlider(bool show);
    bool getShowSlider() const { return showSlider_; }

    glm::vec2 measure(f32 availableWidth, f32 availableHeight) override;
    void render(ui::UIBatchRenderer& renderer) override;

protected:
    Unique<Command> createCommand(const std::any& oldValue,
                                  const std::any& newValue) override;

private:
    void onTextChanged(const std::string& text);
    void onSliderChanged(f32 value);
    void updateTextFromValue();
    void updateSliderFromValue();

    i32 value_ = 0;
    i32 min_ = 0;
    i32 max_ = 100;

    bool showSlider_ = false;
    bool updatingFromText_ = false;
    bool updatingFromSlider_ = false;

    ui::Label* labelWidget_ = nullptr;
    ui::TextField* textField_ = nullptr;
    ui::Slider* slider_ = nullptr;
    ConnectionHolder connections_;

    static constexpr f32 LABEL_WIDTH = 60.0f;
    static constexpr f32 TEXTFIELD_WIDTH = 60.0f;
    static constexpr f32 SPACING = 8.0f;
};

}  // namespace esengine::editor
