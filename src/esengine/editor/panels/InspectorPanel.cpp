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
#include "../../ecs/components/Camera.hpp"
#include "../../ecs/components/Sprite.hpp"
#include "../../math/Math.hpp"
#include "../../events/Sink.hpp"
#include "../../core/Log.hpp"
#include "../../ui/UIContext.hpp"
#include "../../ui/layout/StackLayout.hpp"
#include "../../ui/icons/Icons.hpp"
#include "../../ui/widgets/Button.hpp"
#include "../../ui/widgets/ClickablePanel.hpp"
#include "../../ui/rendering/UIBatchRenderer.hpp"

#include "../../ui/font/SystemFont.hpp"

namespace esengine::editor {

// =============================================================================
// Constructor
// =============================================================================

InspectorPanel::InspectorPanel(ecs::Registry& registry,
                               EntitySelection& selection,
                               CommandHistory& history,
                               ScriptComponentRegistry* scriptRegistry)
    : DockPanel(ui::WidgetId("inspector_panel"), "Inspector"),
      registry_(registry),
      selection_(selection),
      history_(history),
      scriptRegistry_(scriptRegistry) {

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
    constexpr glm::vec4 toolbarBg{0.2f, 0.2f, 0.2f, 1.0f};              // #333333
    constexpr glm::vec4 mainBg{0.165f, 0.165f, 0.165f, 1.0f};           // #2a2a2a
    constexpr glm::vec4 headerBg{0.176f, 0.176f, 0.188f, 1.0f};         // #2d2d30
    constexpr glm::vec4 borderColor{0.102f, 0.102f, 0.102f, 1.0f};      // #1a1a1a
    constexpr glm::vec4 textColor{0.878f, 0.878f, 0.878f, 1.0f};        // #e0e0e0
    constexpr glm::vec4 dimTextColor{0.6f, 0.6f, 0.6f, 1.0f};           // #999999

    auto rootPanel = makeUnique<ui::Panel>(ui::WidgetId(getId().path + "_root"));
    rootPanel->setLayout(makeUnique<ui::StackLayout>(ui::StackDirection::Vertical, 0.0f));
    rootPanel->setDrawBackground(true);
    rootPanel->setBackgroundColor(mainBg);

    // =========================================================================
    // Toolbar
    // =========================================================================
    auto toolbar = makeUnique<ui::Panel>(ui::WidgetId(getId().path + "_toolbar"));
    toolbar->setLayout(makeUnique<ui::StackLayout>(ui::StackDirection::Horizontal, 4.0f));
    toolbar->setHeight(ui::SizeValue::px(34.0f));
    toolbar->setWidth(ui::SizeValue::flex(1.0f));
    toolbar->setPadding(ui::Insets(4.0f, 8.0f, 4.0f, 8.0f));
    toolbar->setDrawBackground(true);
    toolbar->setBackgroundColor(toolbarBg);
    toolbar->setBorderColor(borderColor);
    toolbar->setBorderWidth(ui::BorderWidth(0.0f, 0.0f, 1.0f, 0.0f));

    auto lockButton = makeUnique<ui::Button>(ui::WidgetId(getId().path + "_lock_btn"), ui::icons::Lock);
    lockButton->setButtonStyle(ui::ButtonStyle::Ghost);
    lockButton->setWidth(ui::SizeValue::px(26.0f));
    lockButton->setHeight(ui::SizeValue::px(26.0f));
    lockButton->setCornerRadii(ui::CornerRadii::all(3.0f));
    toolbar->addChild(std::move(lockButton));

    auto debugButton = makeUnique<ui::Button>(ui::WidgetId(getId().path + "_debug_btn"), ui::icons::Bug);
    debugButton->setButtonStyle(ui::ButtonStyle::Ghost);
    debugButton->setWidth(ui::SizeValue::px(26.0f));
    debugButton->setHeight(ui::SizeValue::px(26.0f));
    debugButton->setCornerRadii(ui::CornerRadii::all(3.0f));
    toolbar->addChild(std::move(debugButton));

    auto spacer = makeUnique<ui::Panel>(ui::WidgetId(getId().path + "_spacer"));
    spacer->setWidth(ui::SizeValue::flex(1.0f));
    spacer->setHeight(ui::SizeValue::px(26.0f));
    spacer->setDrawBackground(false);
    toolbar->addChild(std::move(spacer));

    auto addComponentButton = makeUnique<ui::Button>(ui::WidgetId(getId().path + "_add_btn"), ui::icons::Plus);
    addComponentButton->setButtonStyle(ui::ButtonStyle::Ghost);
    addComponentButton->setWidth(ui::SizeValue::px(26.0f));
    addComponentButton->setHeight(ui::SizeValue::px(26.0f));
    addComponentButton->setCornerRadii(ui::CornerRadii::all(3.0f));
    toolbar->addChild(std::move(addComponentButton));

    auto settingsButton = makeUnique<ui::Button>(ui::WidgetId(getId().path + "_settings_btn"), ui::icons::Settings);
    settingsButton->setButtonStyle(ui::ButtonStyle::Ghost);
    settingsButton->setWidth(ui::SizeValue::px(26.0f));
    settingsButton->setHeight(ui::SizeValue::px(26.0f));
    settingsButton->setCornerRadii(ui::CornerRadii::all(3.0f));
    toolbar->addChild(std::move(settingsButton));

    rootPanel->addChild(std::move(toolbar));

    // =========================================================================
    // Entity Header
    // =========================================================================
    auto headerPanel = makeUnique<ui::Panel>(ui::WidgetId(getId().path + "_header"));
    headerPanel->setLayout(makeUnique<ui::StackLayout>(ui::StackDirection::Horizontal, 8.0f));
    headerPanel->setHeight(ui::SizeValue::px(32.0f));
    headerPanel->setWidth(ui::SizeValue::flex(1.0f));
    headerPanel->setPadding(ui::Insets(6.0f, 12.0f, 6.0f, 12.0f));
    headerPanel->setDrawBackground(true);
    headerPanel->setBackgroundColor(headerBg);
    headerPanel->setBorderColor(borderColor);
    headerPanel->setBorderWidth(ui::BorderWidth(0.0f, 0.0f, 1.0f, 0.0f));

    auto entityIconLabel = makeUnique<ui::Label>(ui::WidgetId(getId().path + "_entity_icon"), ui::icons::Box);
    entityIconLabel->setFontSize(14.0f);
    entityIconLabel->setColor(dimTextColor);
    entityIconLabel->setIsIconFont(true);
    entityIconLabel_ = entityIconLabel.get();
    headerPanel->addChild(std::move(entityIconLabel));

    auto entityNameLabel = makeUnique<ui::Label>(ui::WidgetId(getId().path + "_entity_name"));
    entityNameLabel->setText("No Selection");
    entityNameLabel->setFontSize(13.0f);
    entityNameLabel->setColor(textColor);
    entityNameLabel->setWidth(ui::SizeValue::flex(1.0f));
    entityNameLabel_ = entityNameLabel.get();
    headerPanel->addChild(std::move(entityNameLabel));

    auto entityIdLabel = makeUnique<ui::Label>(ui::WidgetId(getId().path + "_entity_id"));
    entityIdLabel->setText("");
    entityIdLabel->setFontSize(11.0f);
    entityIdLabel->setColor(dimTextColor);
    entityIdLabel_ = entityIdLabel.get();
    headerPanel->addChild(std::move(entityIdLabel));

    headerPanel_ = headerPanel.get();
    rootPanel->addChild(std::move(headerPanel));

    // =========================================================================
    // Scroll Content
    // =========================================================================
    auto scrollView = makeUnique<ui::ScrollView>(ui::WidgetId(getId().path + "_scroll"));
    scrollView->setScrollDirection(ui::ScrollDirection::Vertical);
    scrollView->setWidth(ui::SizeValue::flex(1.0f));
    scrollView->setHeight(ui::SizeValue::flex(1.0f));
    scrollView_ = scrollView.get();

    auto contentPanel = makeUnique<ui::Panel>(ui::WidgetId(getId().path + "_content"));
    contentPanel->setLayout(makeUnique<ui::StackLayout>(ui::StackDirection::Vertical, 0.0f));
    contentPanel->setWidth(ui::SizeValue::flex(1.0f));
    contentPanel->setHeight(ui::SizeValue::autoSize());
    contentPanel->setPadding(ui::Insets(4.0f, 0.0f, 4.0f, 0.0f));
    contentPanel_ = contentPanel.get();

    scrollView->setContent(std::move(contentPanel));
    rootPanel->addChild(std::move(scrollView));

    // =========================================================================
    // Status Bar
    // =========================================================================
    auto statusBar = makeUnique<ui::Panel>(ui::WidgetId(getId().path + "_status"));
    statusBar->setHeight(ui::SizeValue::px(24.0f));
    statusBar->setWidth(ui::SizeValue::flex(1.0f));
    statusBar->setPadding(ui::Insets(4.0f, 12.0f, 4.0f, 12.0f));
    statusBar->setDrawBackground(true);
    statusBar->setBackgroundColor(toolbarBg);
    statusBar->setBorderColor(borderColor);
    statusBar->setBorderWidth(ui::BorderWidth(1.0f, 0.0f, 0.0f, 0.0f));

    auto componentCountLabel = makeUnique<ui::Label>(ui::WidgetId(getId().path + "_count"), "0 components");
    componentCountLabel->setFontSize(11.0f);
    componentCountLabel->setColor(dimTextColor);
    componentCountLabel_ = componentCountLabel.get();
    statusBar->addChild(std::move(componentCountLabel));

    rootPanel->addChild(std::move(statusBar));

    rootPanel_ = rootPanel.get();
    setContent(std::move(rootPanel));
}

InspectorPanel::SectionWidgets InspectorPanel::createComponentSection(const std::string& name, const std::string& icon) {
    constexpr glm::vec4 sectionHeaderBg{0.2f, 0.2f, 0.2f, 1.0f};          // #333333
    constexpr glm::vec4 sectionBg{0.165f, 0.165f, 0.165f, 1.0f};          // #2a2a2a
    constexpr glm::vec4 borderColor{0.102f, 0.102f, 0.102f, 1.0f};        // #1a1a1a
    constexpr glm::vec4 textColor{0.878f, 0.878f, 0.878f, 1.0f};          // #e0e0e0
    constexpr glm::vec4 iconColor{0.6f, 0.6f, 0.6f, 1.0f};                // #999999

    SectionWidgets widgets;

    auto section = makeUnique<ui::Panel>(ui::WidgetId(contentPanel_->getId().path + "_" + name));
    section->setLayout(makeUnique<ui::StackLayout>(ui::StackDirection::Vertical, 0.0f));
    section->setWidth(ui::SizeValue::flex(1.0f));
    section->setHeight(ui::SizeValue::autoSize());
    section->setDrawBackground(true);
    section->setBackgroundColor(sectionBg);
    section->setBorderColor(borderColor);
    section->setBorderWidth(ui::BorderWidth(0.0f, 0.0f, 1.0f, 0.0f));
    widgets.section = section.get();

    auto header = makeUnique<ui::ClickablePanel>(ui::WidgetId(section->getId().path + "_header"));
    header->setLayout(makeUnique<ui::StackLayout>(ui::StackDirection::Horizontal, 6.0f));
    header->setHeight(ui::SizeValue::px(26.0f));
    header->setWidth(ui::SizeValue::flex(1.0f));
    header->setPadding(ui::Insets(4.0f, 8.0f, 4.0f, 8.0f));
    header->setDrawBackground(true);
    header->setBackgroundColor(sectionHeaderBg);

    bool isCollapsed = collapsedSections_.count(name) > 0;
    std::string chevronIcon = isCollapsed ? ui::icons::ChevronRight : ui::icons::ChevronDown;

    auto chevronLabel = makeUnique<ui::Label>(ui::WidgetId(header->getId().path + "_chevron"), chevronIcon);
    chevronLabel->setFontSize(10.0f);
    chevronLabel->setColor(iconColor);
    chevronLabel->setIsIconFont(true);
    widgets.chevron = chevronLabel.get();
    header->addChild(std::move(chevronLabel));

    auto iconLabel = makeUnique<ui::Label>(ui::WidgetId(header->getId().path + "_icon"), icon);
    iconLabel->setFontSize(12.0f);
    iconLabel->setColor(iconColor);
    iconLabel->setIsIconFont(true);
    header->addChild(std::move(iconLabel));

    auto headerLabel = makeUnique<ui::Label>(ui::WidgetId(header->getId().path + "_label"));
    headerLabel->setText(name);
    headerLabel->setFontSize(12.0f);
    headerLabel->setColor(textColor);
    headerLabel->setWidth(ui::SizeValue::flex(1.0f));
    header->addChild(std::move(headerLabel));

    auto removeButton = makeUnique<ui::Button>(ui::WidgetId(header->getId().path + "_remove"), ui::icons::X);
    removeButton->setButtonStyle(ui::ButtonStyle::Ghost);
    removeButton->setWidth(ui::SizeValue::px(18.0f));
    removeButton->setHeight(ui::SizeValue::px(18.0f));
    removeButton->setCornerRadii(ui::CornerRadii::all(2.0f));
    header->addChild(std::move(removeButton));

    ui::ClickablePanel* headerPtr = header.get();
    section->addChild(std::move(header));

    auto content = makeUnique<ui::Panel>(ui::WidgetId(section->getId().path + "_content"));
    content->setLayout(makeUnique<ui::StackLayout>(ui::StackDirection::Vertical, 4.0f));
    content->setWidth(ui::SizeValue::flex(1.0f));
    content->setHeight(ui::SizeValue::autoSize());
    content->setPadding(ui::Insets(8.0f, 12.0f, 8.0f, 12.0f));
    content->setVisible(!isCollapsed);
    widgets.content = content.get();
    section->addChild(std::move(content));

    editorConnections_.add(sink(headerPtr->onClick).connect(
        [this, name](const ui::MouseButtonEvent& event) {
            if (event.button == ui::MouseButton::Left) {
                toggleSection(name);
            }
        }
    ));

    sectionWidgets_[name] = widgets;
    contentPanel_->addChild(std::move(section));
    return widgets;
}

void InspectorPanel::toggleSection(const std::string& name) {
    if (collapsedSections_.count(name) > 0) {
        collapsedSections_.erase(name);
    } else {
        collapsedSections_.insert(name);
    }

    auto it = sectionWidgets_.find(name);
    if (it != sectionWidgets_.end()) {
        updateSectionVisibility(name, it->second);
    }
}

void InspectorPanel::updateSectionVisibility(const std::string& name, SectionWidgets& widgets) {
    bool isCollapsed = collapsedSections_.count(name) > 0;

    if (widgets.content) {
        widgets.content->setVisible(!isCollapsed);
    }

    if (widgets.chevron) {
        widgets.chevron->setText(isCollapsed ? ui::icons::ChevronRight : ui::icons::ChevronDown);
    }

    if (scrollView_) {
        scrollView_->invalidateLayout();
    }
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
    syncEditorValues();

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
    constexpr glm::vec4 textColor{0.878f, 0.878f, 0.878f, 1.0f};     // #e0e0e0

    if (currentEntity_ == INVALID_ENTITY || !registry_.valid(currentEntity_)) {
        if (entityIconLabel_) {
            entityIconLabel_->setText(ui::icons::Box);
            entityIconLabel_->setColor(dimTextColor);
        }
        if (entityNameLabel_) {
            entityNameLabel_->setText("No Selection");
            entityNameLabel_->setColor(dimTextColor);
        }
        if (entityIdLabel_) {
            entityIdLabel_->setText("");
        }
        if (componentCountLabel_) {
            componentCountLabel_->setText("0 components");
        }

        auto noSelectionLabel = makeUnique<ui::Label>(
            ui::WidgetId(contentPanel_->getId().path + "_no_selection"));
        noSelectionLabel->setText("Select an entity to view properties");
        noSelectionLabel->setFontSize(12.0f);
        noSelectionLabel->setColor(dimTextColor);
        contentPanel_->addChild(std::move(noSelectionLabel));
        return;
    }

    std::string displayName = "Entity " + std::to_string(currentEntity_);
    std::string entityIcon = ui::icons::Box;

    if (registry_.has<ecs::Name>(currentEntity_)) {
        displayName = registry_.get<ecs::Name>(currentEntity_).value;
    }
    if (registry_.has<ecs::Camera>(currentEntity_)) {
        entityIcon = ui::icons::Camera;
    } else if (registry_.has<ecs::Sprite>(currentEntity_)) {
        entityIcon = ui::icons::Image;
    }

    if (entityIconLabel_) {
        entityIconLabel_->setText(entityIcon);
        entityIconLabel_->setColor(textColor);
    }
    if (entityNameLabel_) {
        entityNameLabel_->setText(displayName);
        entityNameLabel_->setColor(textColor);
    }
    if (entityIdLabel_) {
        entityIdLabel_->setText("ID: " + std::to_string(currentEntity_));
    }

    i32 componentCount = 0;

    addTagsEditor(currentEntity_);
    componentCount++;

    if (registry_.has<ecs::Name>(currentEntity_)) {
        addNameEditor(currentEntity_);
        componentCount++;
    }

    if (registry_.has<ecs::LocalTransform>(currentEntity_)) {
        addLocalTransformEditor(currentEntity_);
        componentCount++;
    }

    if (registry_.has<ecs::Camera>(currentEntity_)) {
        addCameraEditor(currentEntity_);
        componentCount++;
    }

    if (registry_.has<ecs::Sprite>(currentEntity_)) {
        addSpriteEditor(currentEntity_);
        componentCount++;
    }

    // Script components
    if (registry_.has<ecs::Scripts>(currentEntity_)) {
        addScriptComponentEditors(currentEntity_);
        componentCount += static_cast<i32>(registry_.get<ecs::Scripts>(currentEntity_).instances.size());
    }

    if (componentCountLabel_) {
        std::string countText = std::to_string(componentCount) +
            (componentCount == 1 ? " component" : " components");
        componentCountLabel_->setText(countText);
    }
}

void InspectorPanel::clearInspector() {
    editorConnections_.disconnectAll();
    sectionWidgets_.clear();
    positionEditor_ = nullptr;
    rotationEditor_ = nullptr;
    scaleEditor_ = nullptr;
    if (contentPanel_) {
        contentPanel_->clearChildren();
    }
}

void InspectorPanel::syncEditorValues() {
    if (currentEntity_ == INVALID_ENTITY || !registry_.valid(currentEntity_)) {
        return;
    }

    if (registry_.has<ecs::LocalTransform>(currentEntity_)) {
        const auto& transform = registry_.get<ecs::LocalTransform>(currentEntity_);

        if (positionEditor_) {
            positionEditor_->setValue(transform.position);
        }
        if (rotationEditor_) {
            glm::vec3 eulerAngles = math::quatToEulerDegrees(transform.rotation);
            rotationEditor_->setValue(eulerAngles);
        }
        if (scaleEditor_) {
            scaleEditor_->setValue(transform.scale);
        }
    }
}

void InspectorPanel::addNameEditor(Entity entity) {
    auto widgets = createComponentSection("Name", ui::icons::User);
    auto& name = registry_.get<ecs::Name>(entity);

    auto nameEditor = makeUnique<StringEditor>(
        ui::WidgetId(widgets.content->getId().path + "_name"),
        "name");
    nameEditor->setLabel("Name");
    nameEditor->setValue(name.value);
    nameEditor->setCommandHistory(&history_);

    editorConnections_.add(sink(nameEditor->onValueChanged).connect(
        [this, entity](const std::any& value) {
            if (registry_.valid(entity) && registry_.has<ecs::Name>(entity)) {
                auto& n = registry_.get<ecs::Name>(entity);
                try {
                    n.value = std::any_cast<std::string>(value);
                    if (entityNameLabel_) {
                        entityNameLabel_->setText(n.value);
                    }
                } catch (const std::bad_any_cast&) {
                    ES_LOG_ERROR("Failed to cast name value");
                }
            }
        }
    ));

    widgets.content->addChild(std::move(nameEditor));
}

void InspectorPanel::addLocalTransformEditor(Entity entity) {
    auto widgets = createComponentSection("Transform", ui::icons::Move3d);
    auto& transform = registry_.get<ecs::LocalTransform>(entity);

    auto positionEditor = makeUnique<Vector3Editor>(
        ui::WidgetId(widgets.content->getId().path + "_position"),
        "position");
    positionEditor->setLabel("Position");
    positionEditor->setValue(transform.position);
    positionEditor->setCommandHistory(&history_);
    positionEditor_ = positionEditor.get();

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

    widgets.content->addChild(std::move(positionEditor));

    glm::vec3 eulerAngles = math::quatToEulerDegrees(transform.rotation);

    auto rotationEditor = makeUnique<Vector3Editor>(
        ui::WidgetId(widgets.content->getId().path + "_rotation"),
        "rotation");
    rotationEditor->setLabel("Rotation");
    rotationEditor->setValue(eulerAngles);
    rotationEditor->setCommandHistory(&history_);
    rotationEditor_ = rotationEditor.get();

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

    widgets.content->addChild(std::move(rotationEditor));

    auto scaleEditor = makeUnique<Vector3Editor>(
        ui::WidgetId(widgets.content->getId().path + "_scale"),
        "scale");
    scaleEditor->setLabel("Scale");
    scaleEditor->setValue(transform.scale);
    scaleEditor->setCommandHistory(&history_);
    scaleEditor_ = scaleEditor.get();

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

    widgets.content->addChild(std::move(scaleEditor));
}

void InspectorPanel::addCameraEditor(Entity entity) {
    auto widgets = createComponentSection("Camera", ui::icons::Camera);
    auto& camera = registry_.get<ecs::Camera>(entity);

    auto projTypeEditor = makeUnique<EnumEditor>(
        ui::WidgetId(widgets.content->getId().path + "_projType"),
        "projectionType");
    projTypeEditor->setLabel("Projection");
    projTypeEditor->addOption(EnumOption::create(
        static_cast<i32>(ecs::ProjectionType::Perspective), "Perspective"));
    projTypeEditor->addOption(EnumOption::create(
        static_cast<i32>(ecs::ProjectionType::Orthographic), "Orthographic"));
    projTypeEditor->setValue(static_cast<i32>(camera.projectionType));
    projTypeEditor->setCommandHistory(&history_);

    editorConnections_.add(sink(projTypeEditor->onValueChanged).connect(
        [this, entity](const std::any& value) {
            if (registry_.valid(entity) && registry_.has<ecs::Camera>(entity)) {
                auto& c = registry_.get<ecs::Camera>(entity);
                try {
                    c.projectionType = static_cast<ecs::ProjectionType>(std::any_cast<i32>(value));
                } catch (const std::bad_any_cast&) {
                    ES_LOG_ERROR("Failed to cast projectionType value");
                }
            }
        }
    ));

    widgets.content->addChild(std::move(projTypeEditor));

    auto fovEditor = makeUnique<FloatEditor>(
        ui::WidgetId(widgets.content->getId().path + "_fov"),
        "fov");
    fovEditor->setLabel("FOV");
    fovEditor->setValue(camera.fov);
    fovEditor->setRange(1.0f, 180.0f);
    fovEditor->setCommandHistory(&history_);

    editorConnections_.add(sink(fovEditor->onValueChanged).connect(
        [this, entity](const std::any& value) {
            if (registry_.valid(entity) && registry_.has<ecs::Camera>(entity)) {
                auto& c = registry_.get<ecs::Camera>(entity);
                try {
                    c.fov = std::any_cast<f32>(value);
                } catch (const std::bad_any_cast&) {
                    ES_LOG_ERROR("Failed to cast fov value");
                }
            }
        }
    ));

    widgets.content->addChild(std::move(fovEditor));

    auto orthoSizeEditor = makeUnique<FloatEditor>(
        ui::WidgetId(widgets.content->getId().path + "_orthoSize"),
        "orthoSize");
    orthoSizeEditor->setLabel("Ortho Size");
    orthoSizeEditor->setValue(camera.orthoSize);
    orthoSizeEditor->setRange(0.1f, 100.0f);
    orthoSizeEditor->setCommandHistory(&history_);

    editorConnections_.add(sink(orthoSizeEditor->onValueChanged).connect(
        [this, entity](const std::any& value) {
            if (registry_.valid(entity) && registry_.has<ecs::Camera>(entity)) {
                auto& c = registry_.get<ecs::Camera>(entity);
                try {
                    c.orthoSize = std::any_cast<f32>(value);
                } catch (const std::bad_any_cast&) {
                    ES_LOG_ERROR("Failed to cast orthoSize value");
                }
            }
        }
    ));

    widgets.content->addChild(std::move(orthoSizeEditor));

    auto nearEditor = makeUnique<FloatEditor>(
        ui::WidgetId(widgets.content->getId().path + "_near"),
        "nearPlane");
    nearEditor->setLabel("Near");
    nearEditor->setValue(camera.nearPlane);
    nearEditor->setCommandHistory(&history_);

    editorConnections_.add(sink(nearEditor->onValueChanged).connect(
        [this, entity](const std::any& value) {
            if (registry_.valid(entity) && registry_.has<ecs::Camera>(entity)) {
                auto& c = registry_.get<ecs::Camera>(entity);
                try {
                    c.nearPlane = std::any_cast<f32>(value);
                } catch (const std::bad_any_cast&) {
                    ES_LOG_ERROR("Failed to cast nearPlane value");
                }
            }
        }
    ));

    widgets.content->addChild(std::move(nearEditor));

    auto farEditor = makeUnique<FloatEditor>(
        ui::WidgetId(widgets.content->getId().path + "_far"),
        "farPlane");
    farEditor->setLabel("Far");
    farEditor->setValue(camera.farPlane);
    farEditor->setCommandHistory(&history_);

    editorConnections_.add(sink(farEditor->onValueChanged).connect(
        [this, entity](const std::any& value) {
            if (registry_.valid(entity) && registry_.has<ecs::Camera>(entity)) {
                auto& c = registry_.get<ecs::Camera>(entity);
                try {
                    c.farPlane = std::any_cast<f32>(value);
                } catch (const std::bad_any_cast&) {
                    ES_LOG_ERROR("Failed to cast farPlane value");
                }
            }
        }
    ));

    widgets.content->addChild(std::move(farEditor));

    auto aspectEditor = makeUnique<FloatEditor>(
        ui::WidgetId(widgets.content->getId().path + "_aspect"),
        "aspectRatio");
    aspectEditor->setLabel("Aspect");
    aspectEditor->setValue(camera.aspectRatio);
    aspectEditor->setRange(0.0f, 4.0f);
    aspectEditor->setCommandHistory(&history_);

    editorConnections_.add(sink(aspectEditor->onValueChanged).connect(
        [this, entity](const std::any& value) {
            if (registry_.valid(entity) && registry_.has<ecs::Camera>(entity)) {
                auto& c = registry_.get<ecs::Camera>(entity);
                try {
                    c.aspectRatio = std::any_cast<f32>(value);
                } catch (const std::bad_any_cast&) {
                    ES_LOG_ERROR("Failed to cast aspectRatio value");
                }
            }
        }
    ));

    widgets.content->addChild(std::move(aspectEditor));

    auto activeEditor = makeUnique<BoolEditor>(
        ui::WidgetId(widgets.content->getId().path + "_active"),
        "isActive");
    activeEditor->setLabel("Active");
    activeEditor->setValue(camera.isActive);
    activeEditor->setCommandHistory(&history_);

    editorConnections_.add(sink(activeEditor->onValueChanged).connect(
        [this, entity](const std::any& value) {
            if (registry_.valid(entity) && registry_.has<ecs::Camera>(entity)) {
                auto& c = registry_.get<ecs::Camera>(entity);
                try {
                    c.isActive = std::any_cast<bool>(value);
                } catch (const std::bad_any_cast&) {
                    ES_LOG_ERROR("Failed to cast isActive value");
                }
            }
        }
    ));

    widgets.content->addChild(std::move(activeEditor));

    auto priorityEditor = makeUnique<IntEditor>(
        ui::WidgetId(widgets.content->getId().path + "_priority"),
        "priority");
    priorityEditor->setLabel("Priority");
    priorityEditor->setValue(camera.priority);
    priorityEditor->setRange(-100, 100);
    priorityEditor->setCommandHistory(&history_);

    editorConnections_.add(sink(priorityEditor->onValueChanged).connect(
        [this, entity](const std::any& value) {
            if (registry_.valid(entity) && registry_.has<ecs::Camera>(entity)) {
                auto& c = registry_.get<ecs::Camera>(entity);
                try {
                    c.priority = std::any_cast<i32>(value);
                } catch (const std::bad_any_cast&) {
                    ES_LOG_ERROR("Failed to cast priority value");
                }
            }
        }
    ));

    widgets.content->addChild(std::move(priorityEditor));
}

void InspectorPanel::addSpriteEditor(Entity entity) {
    auto widgets = createComponentSection("Sprite", ui::icons::Image);
    auto& sprite = registry_.get<ecs::Sprite>(entity);

    auto colorEditor = makeUnique<ColorEditor>(
        ui::WidgetId(widgets.content->getId().path + "_color"),
        "color");
    colorEditor->setLabel("Color");
    colorEditor->setValue(sprite.color);
    colorEditor->setCommandHistory(&history_);

    editorConnections_.add(sink(colorEditor->onValueChanged).connect(
        [this, entity](const std::any& value) {
            if (registry_.valid(entity) && registry_.has<ecs::Sprite>(entity)) {
                auto& s = registry_.get<ecs::Sprite>(entity);
                try {
                    s.color = std::any_cast<glm::vec4>(value);
                } catch (const std::bad_any_cast&) {
                    ES_LOG_ERROR("Failed to cast color value");
                }
            }
        }
    ));

    widgets.content->addChild(std::move(colorEditor));

    auto sizeEditor = makeUnique<Vector2Editor>(
        ui::WidgetId(widgets.content->getId().path + "_size"),
        "size");
    sizeEditor->setLabel("Size");
    sizeEditor->setValue(sprite.size);
    sizeEditor->setCommandHistory(&history_);

    editorConnections_.add(sink(sizeEditor->onValueChanged).connect(
        [this, entity](const std::any& value) {
            if (registry_.valid(entity) && registry_.has<ecs::Sprite>(entity)) {
                auto& s = registry_.get<ecs::Sprite>(entity);
                try {
                    s.size = std::any_cast<glm::vec2>(value);
                } catch (const std::bad_any_cast&) {
                    ES_LOG_ERROR("Failed to cast size value");
                }
            }
        }
    ));

    widgets.content->addChild(std::move(sizeEditor));

    auto uvOffsetEditor = makeUnique<Vector2Editor>(
        ui::WidgetId(widgets.content->getId().path + "_uvOffset"),
        "uvOffset");
    uvOffsetEditor->setLabel("UV Offset");
    uvOffsetEditor->setValue(sprite.uvOffset);
    uvOffsetEditor->setCommandHistory(&history_);

    editorConnections_.add(sink(uvOffsetEditor->onValueChanged).connect(
        [this, entity](const std::any& value) {
            if (registry_.valid(entity) && registry_.has<ecs::Sprite>(entity)) {
                auto& s = registry_.get<ecs::Sprite>(entity);
                try {
                    s.uvOffset = std::any_cast<glm::vec2>(value);
                } catch (const std::bad_any_cast&) {
                    ES_LOG_ERROR("Failed to cast uvOffset value");
                }
            }
        }
    ));

    widgets.content->addChild(std::move(uvOffsetEditor));

    auto uvScaleEditor = makeUnique<Vector2Editor>(
        ui::WidgetId(widgets.content->getId().path + "_uvScale"),
        "uvScale");
    uvScaleEditor->setLabel("UV Scale");
    uvScaleEditor->setValue(sprite.uvScale);
    uvScaleEditor->setCommandHistory(&history_);

    editorConnections_.add(sink(uvScaleEditor->onValueChanged).connect(
        [this, entity](const std::any& value) {
            if (registry_.valid(entity) && registry_.has<ecs::Sprite>(entity)) {
                auto& s = registry_.get<ecs::Sprite>(entity);
                try {
                    s.uvScale = std::any_cast<glm::vec2>(value);
                } catch (const std::bad_any_cast&) {
                    ES_LOG_ERROR("Failed to cast uvScale value");
                }
            }
        }
    ));

    widgets.content->addChild(std::move(uvScaleEditor));

    auto layerEditor = makeUnique<IntEditor>(
        ui::WidgetId(widgets.content->getId().path + "_layer"),
        "layer");
    layerEditor->setLabel("Layer");
    layerEditor->setValue(sprite.layer);
    layerEditor->setRange(-1000, 1000);
    layerEditor->setCommandHistory(&history_);

    editorConnections_.add(sink(layerEditor->onValueChanged).connect(
        [this, entity](const std::any& value) {
            if (registry_.valid(entity) && registry_.has<ecs::Sprite>(entity)) {
                auto& s = registry_.get<ecs::Sprite>(entity);
                try {
                    s.layer = std::any_cast<i32>(value);
                } catch (const std::bad_any_cast&) {
                    ES_LOG_ERROR("Failed to cast layer value");
                }
            }
        }
    ));

    widgets.content->addChild(std::move(layerEditor));

    auto flipXEditor = makeUnique<BoolEditor>(
        ui::WidgetId(widgets.content->getId().path + "_flipX"),
        "flipX");
    flipXEditor->setLabel("Flip X");
    flipXEditor->setValue(sprite.flipX);
    flipXEditor->setCommandHistory(&history_);

    editorConnections_.add(sink(flipXEditor->onValueChanged).connect(
        [this, entity](const std::any& value) {
            if (registry_.valid(entity) && registry_.has<ecs::Sprite>(entity)) {
                auto& s = registry_.get<ecs::Sprite>(entity);
                try {
                    s.flipX = std::any_cast<bool>(value);
                } catch (const std::bad_any_cast&) {
                    ES_LOG_ERROR("Failed to cast flipX value");
                }
            }
        }
    ));

    widgets.content->addChild(std::move(flipXEditor));

    auto flipYEditor = makeUnique<BoolEditor>(
        ui::WidgetId(widgets.content->getId().path + "_flipY"),
        "flipY");
    flipYEditor->setLabel("Flip Y");
    flipYEditor->setValue(sprite.flipY);
    flipYEditor->setCommandHistory(&history_);

    editorConnections_.add(sink(flipYEditor->onValueChanged).connect(
        [this, entity](const std::any& value) {
            if (registry_.valid(entity) && registry_.has<ecs::Sprite>(entity)) {
                auto& s = registry_.get<ecs::Sprite>(entity);
                try {
                    s.flipY = std::any_cast<bool>(value);
                } catch (const std::bad_any_cast&) {
                    ES_LOG_ERROR("Failed to cast flipY value");
                }
            }
        }
    ));

    widgets.content->addChild(std::move(flipYEditor));
}

void InspectorPanel::addTagsEditor(Entity entity) {
    auto widgets = createComponentSection("Tags", ui::icons::Check);

    bool hasActive = registry_.has<ecs::Active>(entity);
    auto activeEditor = makeUnique<BoolEditor>(
        ui::WidgetId(widgets.content->getId().path + "_active"),
        "active");
    activeEditor->setLabel("Active");
    activeEditor->setValue(hasActive);
    activeEditor->setCommandHistory(&history_);

    editorConnections_.add(sink(activeEditor->onValueChanged).connect(
        [this, entity](const std::any& value) {
            if (!registry_.valid(entity)) return;
            try {
                bool active = std::any_cast<bool>(value);
                if (active && !registry_.has<ecs::Active>(entity)) {
                    registry_.emplace<ecs::Active>(entity);
                } else if (!active && registry_.has<ecs::Active>(entity)) {
                    registry_.remove<ecs::Active>(entity);
                }
            } catch (const std::bad_any_cast&) {
                ES_LOG_ERROR("Failed to cast active value");
            }
        }
    ));

    widgets.content->addChild(std::move(activeEditor));

    bool hasVisible = registry_.has<ecs::Visible>(entity);
    auto visibleEditor = makeUnique<BoolEditor>(
        ui::WidgetId(widgets.content->getId().path + "_visible"),
        "visible");
    visibleEditor->setLabel("Visible");
    visibleEditor->setValue(hasVisible);
    visibleEditor->setCommandHistory(&history_);

    editorConnections_.add(sink(visibleEditor->onValueChanged).connect(
        [this, entity](const std::any& value) {
            if (!registry_.valid(entity)) return;
            try {
                bool visible = std::any_cast<bool>(value);
                if (visible && !registry_.has<ecs::Visible>(entity)) {
                    registry_.emplace<ecs::Visible>(entity);
                } else if (!visible && registry_.has<ecs::Visible>(entity)) {
                    registry_.remove<ecs::Visible>(entity);
                }
            } catch (const std::bad_any_cast&) {
                ES_LOG_ERROR("Failed to cast visible value");
            }
        }
    ));

    widgets.content->addChild(std::move(visibleEditor));

    bool hasStatic = registry_.has<ecs::Static>(entity);
    auto staticEditor = makeUnique<BoolEditor>(
        ui::WidgetId(widgets.content->getId().path + "_static"),
        "static");
    staticEditor->setLabel("Static");
    staticEditor->setValue(hasStatic);
    staticEditor->setCommandHistory(&history_);

    editorConnections_.add(sink(staticEditor->onValueChanged).connect(
        [this, entity](const std::any& value) {
            if (!registry_.valid(entity)) return;
            try {
                bool isStatic = std::any_cast<bool>(value);
                if (isStatic && !registry_.has<ecs::Static>(entity)) {
                    registry_.emplace<ecs::Static>(entity);
                } else if (!isStatic && registry_.has<ecs::Static>(entity)) {
                    registry_.remove<ecs::Static>(entity);
                }
            } catch (const std::bad_any_cast&) {
                ES_LOG_ERROR("Failed to cast static value");
            }
        }
    ));

    widgets.content->addChild(std::move(staticEditor));
}

void InspectorPanel::addScriptComponentEditors(Entity entity) {
    if (!registry_.has<ecs::Scripts>(entity)) return;

    auto& scripts = registry_.get<ecs::Scripts>(entity);

    for (auto& instance : scripts.instances) {
        // Get field definitions from registry if available
        const ScriptComponentDef* def = nullptr;
        if (scriptRegistry_) {
            def = scriptRegistry_->getComponent(instance.componentName);
        }

        auto widgets = createComponentSection(instance.componentName, ui::icons::Code);

        for (auto& [fieldName, fieldValue] : instance.values) {
            ScriptFieldType fieldType = ScriptFieldType::F32;  // Default

            // Try to get type from definition
            if (def) {
                for (const auto& field : def->fields) {
                    if (field.name == fieldName) {
                        fieldType = field.type;
                        break;
                    }
                }
            }

            // Create appropriate editor based on field type
            std::string fieldId = widgets.content->getId().path + "_" + fieldName;

            switch (fieldType) {
                case ScriptFieldType::F32: {
                    auto editor = makeUnique<FloatEditor>(ui::WidgetId(fieldId), fieldName);
                    editor->setLabel(fieldName);
                    if (std::holds_alternative<f32>(fieldValue)) {
                        editor->setValue(std::get<f32>(fieldValue));
                    }
                    editor->setCommandHistory(&history_);

                    editorConnections_.add(sink(editor->onValueChanged).connect(
                        [this, entity, compName = instance.componentName, fieldName](const std::any& value) {
                            if (!registry_.valid(entity) || !registry_.has<ecs::Scripts>(entity)) return;
                            auto& s = registry_.get<ecs::Scripts>(entity);
                            if (auto* inst = s.get(compName)) {
                                try {
                                    inst->values[fieldName] = std::any_cast<f32>(value);
                                } catch (const std::bad_any_cast&) {}
                            }
                        }
                    ));

                    widgets.content->addChild(std::move(editor));
                    break;
                }

                case ScriptFieldType::I32: {
                    auto editor = makeUnique<IntEditor>(ui::WidgetId(fieldId), fieldName);
                    editor->setLabel(fieldName);
                    if (std::holds_alternative<i32>(fieldValue)) {
                        editor->setValue(std::get<i32>(fieldValue));
                    }
                    editor->setCommandHistory(&history_);

                    editorConnections_.add(sink(editor->onValueChanged).connect(
                        [this, entity, compName = instance.componentName, fieldName](const std::any& value) {
                            if (!registry_.valid(entity) || !registry_.has<ecs::Scripts>(entity)) return;
                            auto& s = registry_.get<ecs::Scripts>(entity);
                            if (auto* inst = s.get(compName)) {
                                try {
                                    inst->values[fieldName] = std::any_cast<i32>(value);
                                } catch (const std::bad_any_cast&) {}
                            }
                        }
                    ));

                    widgets.content->addChild(std::move(editor));
                    break;
                }

                case ScriptFieldType::Bool: {
                    auto editor = makeUnique<BoolEditor>(ui::WidgetId(fieldId), fieldName);
                    editor->setLabel(fieldName);
                    if (std::holds_alternative<bool>(fieldValue)) {
                        editor->setValue(std::get<bool>(fieldValue));
                    }
                    editor->setCommandHistory(&history_);

                    editorConnections_.add(sink(editor->onValueChanged).connect(
                        [this, entity, compName = instance.componentName, fieldName](const std::any& value) {
                            if (!registry_.valid(entity) || !registry_.has<ecs::Scripts>(entity)) return;
                            auto& s = registry_.get<ecs::Scripts>(entity);
                            if (auto* inst = s.get(compName)) {
                                try {
                                    inst->values[fieldName] = std::any_cast<bool>(value);
                                } catch (const std::bad_any_cast&) {}
                            }
                        }
                    ));

                    widgets.content->addChild(std::move(editor));
                    break;
                }

                case ScriptFieldType::String: {
                    auto editor = makeUnique<StringEditor>(ui::WidgetId(fieldId), fieldName);
                    editor->setLabel(fieldName);
                    if (std::holds_alternative<std::string>(fieldValue)) {
                        editor->setValue(std::get<std::string>(fieldValue));
                    }
                    editor->setCommandHistory(&history_);

                    editorConnections_.add(sink(editor->onValueChanged).connect(
                        [this, entity, compName = instance.componentName, fieldName](const std::any& value) {
                            if (!registry_.valid(entity) || !registry_.has<ecs::Scripts>(entity)) return;
                            auto& s = registry_.get<ecs::Scripts>(entity);
                            if (auto* inst = s.get(compName)) {
                                try {
                                    inst->values[fieldName] = std::any_cast<std::string>(value);
                                } catch (const std::bad_any_cast&) {}
                            }
                        }
                    ));

                    widgets.content->addChild(std::move(editor));
                    break;
                }

                case ScriptFieldType::Vec2: {
                    auto editor = makeUnique<Vector2Editor>(ui::WidgetId(fieldId), fieldName);
                    editor->setLabel(fieldName);
                    if (std::holds_alternative<glm::vec2>(fieldValue)) {
                        editor->setValue(std::get<glm::vec2>(fieldValue));
                    }
                    editor->setCommandHistory(&history_);

                    editorConnections_.add(sink(editor->onValueChanged).connect(
                        [this, entity, compName = instance.componentName, fieldName](const std::any& value) {
                            if (!registry_.valid(entity) || !registry_.has<ecs::Scripts>(entity)) return;
                            auto& s = registry_.get<ecs::Scripts>(entity);
                            if (auto* inst = s.get(compName)) {
                                try {
                                    inst->values[fieldName] = std::any_cast<glm::vec2>(value);
                                } catch (const std::bad_any_cast&) {}
                            }
                        }
                    ));

                    widgets.content->addChild(std::move(editor));
                    break;
                }

                case ScriptFieldType::Vec3: {
                    auto editor = makeUnique<Vector3Editor>(ui::WidgetId(fieldId), fieldName);
                    editor->setLabel(fieldName);
                    if (std::holds_alternative<glm::vec3>(fieldValue)) {
                        editor->setValue(std::get<glm::vec3>(fieldValue));
                    }
                    editor->setCommandHistory(&history_);

                    editorConnections_.add(sink(editor->onValueChanged).connect(
                        [this, entity, compName = instance.componentName, fieldName](const std::any& value) {
                            if (!registry_.valid(entity) || !registry_.has<ecs::Scripts>(entity)) return;
                            auto& s = registry_.get<ecs::Scripts>(entity);
                            if (auto* inst = s.get(compName)) {
                                try {
                                    inst->values[fieldName] = std::any_cast<glm::vec3>(value);
                                } catch (const std::bad_any_cast&) {}
                            }
                        }
                    ));

                    widgets.content->addChild(std::move(editor));
                    break;
                }

                case ScriptFieldType::Vec4:
                case ScriptFieldType::Color: {
                    auto editor = makeUnique<ColorEditor>(ui::WidgetId(fieldId), fieldName);
                    editor->setLabel(fieldName);
                    if (std::holds_alternative<glm::vec4>(fieldValue)) {
                        editor->setValue(std::get<glm::vec4>(fieldValue));
                    }
                    editor->setCommandHistory(&history_);

                    editorConnections_.add(sink(editor->onValueChanged).connect(
                        [this, entity, compName = instance.componentName, fieldName](const std::any& value) {
                            if (!registry_.valid(entity) || !registry_.has<ecs::Scripts>(entity)) return;
                            auto& s = registry_.get<ecs::Scripts>(entity);
                            if (auto* inst = s.get(compName)) {
                                try {
                                    inst->values[fieldName] = std::any_cast<glm::vec4>(value);
                                } catch (const std::bad_any_cast&) {}
                            }
                        }
                    ));

                    widgets.content->addChild(std::move(editor));
                    break;
                }

                case ScriptFieldType::Entity: {
                    auto editor = makeUnique<IntEditor>(ui::WidgetId(fieldId), fieldName);
                    editor->setLabel(fieldName + " (Entity)");
                    if (std::holds_alternative<u32>(fieldValue)) {
                        editor->setValue(static_cast<i32>(std::get<u32>(fieldValue)));
                    }
                    editor->setRange(0, 1000000);
                    editor->setCommandHistory(&history_);

                    editorConnections_.add(sink(editor->onValueChanged).connect(
                        [this, entity, compName = instance.componentName, fieldName](const std::any& value) {
                            if (!registry_.valid(entity) || !registry_.has<ecs::Scripts>(entity)) return;
                            auto& s = registry_.get<ecs::Scripts>(entity);
                            if (auto* inst = s.get(compName)) {
                                try {
                                    inst->values[fieldName] = static_cast<u32>(std::any_cast<i32>(value));
                                } catch (const std::bad_any_cast&) {}
                            }
                        }
                    ));

                    widgets.content->addChild(std::move(editor));
                    break;
                }
            }
        }
    }
}

}  // namespace esengine::editor
