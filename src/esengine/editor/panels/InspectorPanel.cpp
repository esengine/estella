/**
 * @file    InspectorPanel.cpp
 * @brief   Inspector panel implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "InspectorPanel.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../ecs/components/Common.hpp"
#include "../../math/Math.hpp"
#include "../../events/Sink.hpp"
#include "../../core/Log.hpp"
#include "../../ui/UIContext.hpp"
#include "../../ui/layout/StackLayout.hpp"
#include "../../ui/icons/Icons.hpp"
#include "../../ui/rendering/UIBatchRenderer.hpp"

#if ES_FEATURE_SDF_FONT
#include "../../ui/font/MSDFFont.hpp"
#endif

namespace esengine::editor {

// =============================================================================
// Constructor
// =============================================================================

InspectorPanel::InspectorPanel(ecs::Registry& registry,
                               EntitySelection& selection,
                               CommandHistory& history)
    : DockPanel(ui::WidgetId("inspector_panel"), "Inspector"),
      registry_(registry),
      selection_(selection),
      history_(history) {

    setPanelType("Inspector");
    setClosable(false);
    setMinSize(glm::vec2(250.0f, 200.0f));

    buildUI();

    selectionListenerId_ = selection_.addListener(
        [this](const std::vector<Entity>&, const std::vector<Entity>&) {
            refresh();
        });

    refresh();
}

InspectorPanel::~InspectorPanel() {
    if (selectionListenerId_ != 0) {
        selection_.removeListener(selectionListenerId_);
    }
}

// =============================================================================
// UI Building
// =============================================================================

void InspectorPanel::buildUI() {
    constexpr glm::vec4 panelBg{0.145f, 0.145f, 0.149f, 1.0f};          // #252526
    constexpr glm::vec4 headerBg{0.176f, 0.176f, 0.188f, 1.0f};         // #2d2d30
    constexpr glm::vec4 mainBg{0.118f, 0.118f, 0.118f, 1.0f};           // #1e1e1e
    constexpr glm::vec4 borderColor{0.235f, 0.235f, 0.235f, 1.0f};      // #3c3c3c
    constexpr glm::vec4 textColor{0.878f, 0.878f, 0.878f, 1.0f};        // #e0e0e0

    auto rootPanel = makeUnique<ui::Panel>(ui::WidgetId(getId().path + "_root"));
    rootPanel->setLayout(makeUnique<ui::StackLayout>(ui::StackDirection::Vertical, 0.0f));
    rootPanel->setDrawBackground(true);
    rootPanel->setBackgroundColor(mainBg);

    auto headerPanel = makeUnique<ui::Panel>(ui::WidgetId(getId().path + "_header"));
    headerPanel->setHeight(ui::SizeValue::px(38.0f));
    headerPanel->setWidth(ui::SizeValue::flex(1.0f));
    headerPanel->setPadding(ui::Insets(8.0f, 12.0f, 8.0f, 12.0f));
    headerPanel->setDrawBackground(true);
    headerPanel->setBackgroundColor(headerBg);
    headerPanel->setBorderColor(borderColor);
    headerPanel->setBorderWidth(ui::BorderWidth(0.0f, 0.0f, 1.0f, 0.0f));

    auto entityNameLabel = makeUnique<ui::Label>(ui::WidgetId(getId().path + "_entity_name"));
    entityNameLabel->setText("No Selection");
    entityNameLabel->setFontSize(14.0f);
    entityNameLabel->setColor(textColor);
    entityNameLabel_ = entityNameLabel.get();
    headerPanel->addChild(std::move(entityNameLabel));

    headerPanel_ = headerPanel.get();
    rootPanel->addChild(std::move(headerPanel));

    auto scrollView = makeUnique<ui::ScrollView>(ui::WidgetId(getId().path + "_scroll"));
    scrollView->setScrollDirection(ui::ScrollDirection::Vertical);
    scrollView->setWidth(ui::SizeValue::flex(1.0f));
    scrollView->setHeight(ui::SizeValue::flex(1.0f));
    scrollView_ = scrollView.get();

    auto contentPanel = makeUnique<ui::Panel>(ui::WidgetId(getId().path + "_content"));
    contentPanel->setLayout(makeUnique<ui::StackLayout>(ui::StackDirection::Vertical, 0.0f));
    contentPanel->setWidth(ui::SizeValue::flex(1.0f));
    contentPanel->setHeight(ui::SizeValue::autoSize());
    contentPanel->setPadding(ui::Insets(8.0f, 0.0f, 8.0f, 0.0f));
    contentPanel_ = contentPanel.get();

    scrollView->setContent(std::move(contentPanel));
    rootPanel->addChild(std::move(scrollView));

    rootPanel_ = rootPanel.get();
    setContent(std::move(rootPanel));
}

ui::Panel* InspectorPanel::createComponentSection(const std::string& name, const std::string& icon) {
    constexpr glm::vec4 sectionHeaderBg{0.176f, 0.176f, 0.188f, 1.0f};   // #2d2d30
    constexpr glm::vec4 sectionBg{0.145f, 0.145f, 0.149f, 1.0f};         // #252526
    constexpr glm::vec4 borderColor{0.235f, 0.235f, 0.235f, 1.0f};       // #3c3c3c
    constexpr glm::vec4 textColor{0.878f, 0.878f, 0.878f, 1.0f};         // #e0e0e0

    auto section = makeUnique<ui::Panel>(ui::WidgetId(contentPanel_->getId().path + "_" + name));
    section->setLayout(makeUnique<ui::StackLayout>(ui::StackDirection::Vertical, 0.0f));
    section->setWidth(ui::SizeValue::flex(1.0f));
    section->setHeight(ui::SizeValue::autoSize());
    section->setDrawBackground(true);
    section->setBackgroundColor(sectionBg);
    section->setBorderColor(borderColor);
    section->setBorderWidth(ui::BorderWidth(0.0f, 0.0f, 1.0f, 0.0f));

    auto header = makeUnique<ui::Panel>(ui::WidgetId(section->getId().path + "_header"));
    header->setHeight(ui::SizeValue::px(28.0f));
    header->setWidth(ui::SizeValue::flex(1.0f));
    header->setPadding(ui::Insets(4.0f, 8.0f, 4.0f, 8.0f));
    header->setDrawBackground(true);
    header->setBackgroundColor(sectionHeaderBg);

    auto headerLabel = makeUnique<ui::Label>(ui::WidgetId(header->getId().path + "_label"));
    headerLabel->setText(name);
    headerLabel->setFontSize(12.0f);
    headerLabel->setColor(textColor);
    header->addChild(std::move(headerLabel));

    section->addChild(std::move(header));

    ui::Panel* sectionPtr = section.get();
    contentPanel_->addChild(std::move(section));
    return sectionPtr;
}

void InspectorPanel::toggleSection(const std::string& name) {
    if (collapsedSections_.count(name) > 0) {
        collapsedSections_.erase(name);
    } else {
        collapsedSections_.insert(name);
    }
    rebuildInspector();
}

// =============================================================================
// Public Interface
// =============================================================================

void InspectorPanel::refresh() {
    Entity selected = selection_.getFirst();

    if (selected != currentEntity_) {
        currentEntity_ = selected;
        rebuildInspector();
    }
}

// =============================================================================
// Widget Interface
// =============================================================================

void InspectorPanel::render(ui::UIBatchRenderer& renderer) {
    if (rootPanel_) {
        if (rootPanel_->getContext() != getContext()) {
            rootPanel_->setContext(getContext());
        }
        rootPanel_->layout(getBounds());
        rootPanel_->renderTree(renderer);
    }
}

// =============================================================================
// Private Methods
// =============================================================================

void InspectorPanel::rebuildInspector() {
    clearInspector();

    constexpr glm::vec4 dimTextColor{0.533f, 0.533f, 0.533f, 1.0f};  // #888

    if (currentEntity_ == INVALID_ENTITY || !registry_.valid(currentEntity_)) {
        if (entityNameLabel_) {
            entityNameLabel_->setText("No Selection");
            entityNameLabel_->setColor(dimTextColor);
        }

        auto noSelectionLabel = makeUnique<ui::Label>(
            ui::WidgetId(contentPanel_->getId().path + "_no_selection"));
        noSelectionLabel->setText("Select an entity to view properties");
        noSelectionLabel->setFontSize(12.0f);
        noSelectionLabel->setColor(dimTextColor);
        contentPanel_->addChild(std::move(noSelectionLabel));
        return;
    }

    constexpr glm::vec4 textColor{0.878f, 0.878f, 0.878f, 1.0f};  // #e0e0e0
    if (entityNameLabel_) {
        std::string displayName = "Entity " + std::to_string(currentEntity_);
        if (registry_.has<ecs::Name>(currentEntity_)) {
            displayName = registry_.get<ecs::Name>(currentEntity_).value;
        }
        entityNameLabel_->setText(displayName);
        entityNameLabel_->setColor(textColor);
    }

    if (registry_.has<ecs::Name>(currentEntity_)) {
        addNameEditor(currentEntity_);
    }

    if (registry_.has<ecs::LocalTransform>(currentEntity_)) {
        addLocalTransformEditor(currentEntity_);
    }
}

void InspectorPanel::clearInspector() {
    if (contentPanel_) {
        contentPanel_->clearChildren();
    }
    editorConnections_.disconnectAll();
}

void InspectorPanel::addNameEditor(Entity entity) {
    constexpr glm::vec4 sectionBg{0.145f, 0.145f, 0.149f, 1.0f};
    constexpr glm::vec4 labelColor{0.686f, 0.686f, 0.686f, 1.0f};  // #afafaf
    constexpr glm::vec4 valueColor{0.878f, 0.878f, 0.878f, 1.0f};  // #e0e0e0

    auto section = createComponentSection("Name", ui::icons::User);
    auto& name = registry_.get<ecs::Name>(entity);

    auto row = makeUnique<ui::Panel>(ui::WidgetId(section->getId().path + "_row"));
    row->setHeight(ui::SizeValue::px(26.0f));
    row->setWidth(ui::SizeValue::flex(1.0f));
    row->setPadding(ui::Insets(4.0f, 12.0f, 4.0f, 12.0f));

    auto valueLabel = makeUnique<ui::Label>(ui::WidgetId(row->getId().path + "_value"));
    valueLabel->setText(name.value);
    valueLabel->setFontSize(12.0f);
    valueLabel->setColor(valueColor);
    row->addChild(std::move(valueLabel));

    section->addChild(std::move(row));
}

void InspectorPanel::addLocalTransformEditor(Entity entity) {
    auto section = createComponentSection("Transform", ui::icons::Move3d);
    auto& transform = registry_.get<ecs::LocalTransform>(entity);

    auto content = makeUnique<ui::Panel>(ui::WidgetId(section->getId().path + "_content"));
    content->setLayout(makeUnique<ui::StackLayout>(ui::StackDirection::Vertical, 4.0f));
    content->setWidth(ui::SizeValue::flex(1.0f));
    content->setHeight(ui::SizeValue::autoSize());
    content->setPadding(ui::Insets(8.0f, 12.0f, 8.0f, 12.0f));

    auto positionEditor = makeUnique<Vector3Editor>(
        ui::WidgetId(content->getId().path + "_position"),
        "position");
    positionEditor->setLabel("Position");
    positionEditor->setValue(transform.position);
    positionEditor->setCommandHistory(&history_);

    editorConnections_.add(sink(positionEditor->onValueChanged).connect(
        [this, entity](const std::any& value) {
            if (registry_.valid(entity) && registry_.has<ecs::LocalTransform>(entity)) {
                auto& t = registry_.get<ecs::LocalTransform>(entity);
                try {
                    t.position = std::any_cast<glm::vec3>(value);
                } catch (const std::bad_any_cast&) {
                    ES_LOG_ERROR("Failed to cast position value");
                }
            }
        }
    ));

    content->addChild(std::move(positionEditor));

    glm::vec3 eulerAngles = math::quatToEulerDegrees(transform.rotation);

    auto rotationEditor = makeUnique<Vector3Editor>(
        ui::WidgetId(content->getId().path + "_rotation"),
        "rotation");
    rotationEditor->setLabel("Rotation");
    rotationEditor->setValue(eulerAngles);
    rotationEditor->setCommandHistory(&history_);

    editorConnections_.add(sink(rotationEditor->onValueChanged).connect(
        [this, entity](const std::any& value) {
            if (registry_.valid(entity) && registry_.has<ecs::LocalTransform>(entity)) {
                auto& t = registry_.get<ecs::LocalTransform>(entity);
                try {
                    glm::vec3 euler = std::any_cast<glm::vec3>(value);
                    t.rotation = math::eulerDegreesToQuat(euler);
                } catch (const std::bad_any_cast&) {
                    ES_LOG_ERROR("Failed to cast rotation value");
                }
            }
        }
    ));

    content->addChild(std::move(rotationEditor));

    auto scaleEditor = makeUnique<Vector3Editor>(
        ui::WidgetId(content->getId().path + "_scale"),
        "scale");
    scaleEditor->setLabel("Scale");
    scaleEditor->setValue(transform.scale);
    scaleEditor->setCommandHistory(&history_);

    editorConnections_.add(sink(scaleEditor->onValueChanged).connect(
        [this, entity](const std::any& value) {
            if (registry_.valid(entity) && registry_.has<ecs::LocalTransform>(entity)) {
                auto& t = registry_.get<ecs::LocalTransform>(entity);
                try {
                    t.scale = std::any_cast<glm::vec3>(value);
                } catch (const std::bad_any_cast&) {
                    ES_LOG_ERROR("Failed to cast scale value");
                }
            }
        }
    ));

    content->addChild(std::move(scaleEditor));

    section->addChild(std::move(content));
}

}  // namespace esengine::editor
