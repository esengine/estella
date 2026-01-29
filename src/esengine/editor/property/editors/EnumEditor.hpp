/**
 * @file    EnumEditor.hpp
 * @brief   Property editor for enum values using dropdown
 * @details A dropdown-based editor for selecting from a list of enum options.
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
#include "../../../ui/widgets/Dropdown.hpp"
#include "../../../ui/widgets/Label.hpp"
#include "../../../events/Connection.hpp"

#include <vector>

namespace esengine::editor {

// =============================================================================
// EnumOption
// =============================================================================

struct EnumOption {
    i32 value = 0;
    std::string label;

    static EnumOption create(i32 value, const std::string& label) {
        return EnumOption{value, label};
    }
};

// =============================================================================
// EnumEditor Class
// =============================================================================

/**
 * @brief Property editor for enum values
 *
 * @details Displays a dropdown with labeled options for enum selection.
 *          Uses i32 values internally to support any enum type.
 *
 * @code
 * auto editor = makeUnique<EnumEditor>(WidgetId("projType"), "Projection Type");
 * editor->addOption(EnumOption::create(0, "Perspective"));
 * editor->addOption(EnumOption::create(1, "Orthographic"));
 * editor->setValue(static_cast<i32>(camera.projectionType));
 * @endcode
 */
class EnumEditor : public PropertyEditor {
public:
    static constexpr f32 LABEL_WIDTH = 80.0f;
    static constexpr f32 DROPDOWN_WIDTH = 100.0f;
    static constexpr f32 SPACING = 8.0f;

    EnumEditor(const ui::WidgetId& id, const std::string& propertyName);

    // =========================================================================
    // Options
    // =========================================================================

    void addOption(const EnumOption& option);
    void addOptions(const std::vector<EnumOption>& options);
    void clearOptions();

    const std::vector<EnumOption>& getOptions() const { return options_; }

    // =========================================================================
    // PropertyEditor Interface
    // =========================================================================

    void setValue(const std::any& value) override;
    std::any getValue() const override;

    // =========================================================================
    // Widget Interface
    // =========================================================================

    glm::vec2 measure(f32 availableWidth, f32 availableHeight) override;
    void layout(const ui::Rect& bounds) override;
    void render(ui::UIBatchRenderer& renderer) override;

protected:
    Unique<Command> createCommand(const std::any& oldValue,
                                  const std::any& newValue) override;

private:
    void onDropdownChanged(i32 value);
    void rebuildDropdown();

    i32 value_ = 0;
    std::vector<EnumOption> options_;

    ui::Label* labelWidget_ = nullptr;
    ui::Dropdown* dropdown_ = nullptr;

    ConnectionHolder connections_;

    bool updatingFromExternal_ = false;
};

}  // namespace esengine::editor
