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

    addTagsEditor(currentEntity_);

    if (registry_.has<ecs::Name>(currentEntity_)) {
        addNameEditor(currentEntity_);
    }

    if (registry_.has<ecs::LocalTransform>(currentEntity_)) {
        addLocalTransformEditor(currentEntity_);
    }

    if (registry_.has<ecs::Camera>(currentEntity_)) {
        addCameraEditor(currentEntity_);
    }

    if (registry_.has<ecs::Sprite>(currentEntity_)) {
        addSpriteEditor(currentEntity_);
    }
}

void InspectorPanel::clearInspector() {
    editorConnections_.disconnectAll();
    if (contentPanel_) {
        contentPanel_->clearChildren();
    }
}

void InspectorPanel::addNameEditor(Entity entity) {
    auto section = createComponentSection("Name", ui::icons::User);
    auto& name = registry_.get<ecs::Name>(entity);

    auto content = makeUnique<ui::Panel>(ui::WidgetId(section->getId().path + "_content"));
    content->setLayout(makeUnique<ui::StackLayout>(ui::StackDirection::Vertical, 4.0f));
    content->setWidth(ui::SizeValue::flex(1.0f));
    content->setHeight(ui::SizeValue::autoSize());
    content->setPadding(ui::Insets(8.0f, 12.0f, 8.0f, 12.0f));

    auto nameEditor = makeUnique<StringEditor>(
        ui::WidgetId(content->getId().path + "_name"),
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

    content->addChild(std::move(nameEditor));
    section->addChild(std::move(content));
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

void InspectorPanel::addCameraEditor(Entity entity) {
    auto section = createComponentSection("Camera", ui::icons::Camera);
    auto& camera = registry_.get<ecs::Camera>(entity);

    auto content = makeUnique<ui::Panel>(ui::WidgetId(section->getId().path + "_content"));
    content->setLayout(makeUnique<ui::StackLayout>(ui::StackDirection::Vertical, 4.0f));
    content->setWidth(ui::SizeValue::flex(1.0f));
    content->setHeight(ui::SizeValue::autoSize());
    content->setPadding(ui::Insets(8.0f, 12.0f, 8.0f, 12.0f));

    auto fovEditor = makeUnique<FloatEditor>(
        ui::WidgetId(content->getId().path + "_fov"),
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

    content->addChild(std::move(fovEditor));

    auto nearEditor = makeUnique<FloatEditor>(
        ui::WidgetId(content->getId().path + "_near"),
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

    content->addChild(std::move(nearEditor));

    auto farEditor = makeUnique<FloatEditor>(
        ui::WidgetId(content->getId().path + "_far"),
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

    content->addChild(std::move(farEditor));

    auto activeEditor = makeUnique<BoolEditor>(
        ui::WidgetId(content->getId().path + "_active"),
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

    content->addChild(std::move(activeEditor));

    auto priorityEditor = makeUnique<IntEditor>(
        ui::WidgetId(content->getId().path + "_priority"),
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

    content->addChild(std::move(priorityEditor));

    section->addChild(std::move(content));
}

void InspectorPanel::addSpriteEditor(Entity entity) {
    auto section = createComponentSection("Sprite", ui::icons::Image);
    auto& sprite = registry_.get<ecs::Sprite>(entity);

    auto content = makeUnique<ui::Panel>(ui::WidgetId(section->getId().path + "_content"));
    content->setLayout(makeUnique<ui::StackLayout>(ui::StackDirection::Vertical, 4.0f));
    content->setWidth(ui::SizeValue::flex(1.0f));
    content->setHeight(ui::SizeValue::autoSize());
    content->setPadding(ui::Insets(8.0f, 12.0f, 8.0f, 12.0f));

    auto sizeEditor = makeUnique<Vector2Editor>(
        ui::WidgetId(content->getId().path + "_size"),
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

    content->addChild(std::move(sizeEditor));

    auto layerEditor = makeUnique<IntEditor>(
        ui::WidgetId(content->getId().path + "_layer"),
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

    content->addChild(std::move(layerEditor));

    auto flipXEditor = makeUnique<BoolEditor>(
        ui::WidgetId(content->getId().path + "_flipX"),
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

    content->addChild(std::move(flipXEditor));

    auto flipYEditor = makeUnique<BoolEditor>(
        ui::WidgetId(content->getId().path + "_flipY"),
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

    content->addChild(std::move(flipYEditor));

    section->addChild(std::move(content));
}

void InspectorPanel::addTagsEditor(Entity entity) {
    auto section = createComponentSection("Tags", ui::icons::Check);

    auto content = makeUnique<ui::Panel>(ui::WidgetId(section->getId().path + "_content"));
    content->setLayout(makeUnique<ui::StackLayout>(ui::StackDirection::Vertical, 4.0f));
    content->setWidth(ui::SizeValue::flex(1.0f));
    content->setHeight(ui::SizeValue::autoSize());
    content->setPadding(ui::Insets(8.0f, 12.0f, 8.0f, 12.0f));

    bool hasActive = registry_.has<ecs::Active>(entity);
    auto activeEditor = makeUnique<BoolEditor>(
        ui::WidgetId(content->getId().path + "_active"),
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

    content->addChild(std::move(activeEditor));

    bool hasVisible = registry_.has<ecs::Visible>(entity);
    auto visibleEditor = makeUnique<BoolEditor>(
        ui::WidgetId(content->getId().path + "_visible"),
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

    content->addChild(std::move(visibleEditor));

    bool hasStatic = registry_.has<ecs::Static>(entity);
    auto staticEditor = makeUnique<BoolEditor>(
        ui::WidgetId(content->getId().path + "_static"),
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

    content->addChild(std::move(staticEditor));

    section->addChild(std::move(content));
}

}  // namespace esengine::editor
