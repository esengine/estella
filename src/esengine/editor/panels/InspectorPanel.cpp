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
#include "../../ui/layout/StackLayout.hpp"

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

    auto scrollView = makeUnique<ui::ScrollView>(ui::WidgetId(getId().path + "_scroll"));
    scrollView_ = scrollView.get();
    addChild(std::move(scrollView));

    auto content = makeUnique<ui::Panel>(ui::WidgetId(getId().path + "_content"));
    content->setLayout(makeUnique<ui::StackLayout>(ui::StackDirection::Vertical, 8.0f));
    content->setPadding(ui::Insets::all(8.0f));
    contentPanel_ = content.get();
    scrollView_->setContent(std::move(content));

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
    if (scrollView_) {
        if (scrollView_->getContext() != getContext()) {
            scrollView_->setContext(getContext());
        }
        scrollView_->layout(getBounds());
        scrollView_->renderTree(renderer);
    }
}

// =============================================================================
// Private Methods
// =============================================================================

void InspectorPanel::rebuildInspector() {
    clearInspector();

    if (currentEntity_ == INVALID_ENTITY || !registry_.valid(currentEntity_)) {
        auto noSelectionLabel = makeUnique<ui::Label>(
            ui::WidgetId(contentPanel_->getId().path + "_no_selection"));
        noSelectionLabel->setText("No entity selected");
        contentPanel_->addChild(std::move(noSelectionLabel));
        return;
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
}

void InspectorPanel::addNameEditor(Entity entity) {
    auto& name = registry_.get<ecs::Name>(entity);

    auto headerLabel = makeUnique<ui::Label>(
        ui::WidgetId(contentPanel_->getId().path + "_name_header"));
    headerLabel->setText("Name");
    contentPanel_->addChild(std::move(headerLabel));

    auto valueLabel = makeUnique<ui::Label>(
        ui::WidgetId(contentPanel_->getId().path + "_name_value"));
    valueLabel->setText(name.value);
    contentPanel_->addChild(std::move(valueLabel));
}

void InspectorPanel::addLocalTransformEditor(Entity entity) {
    auto& transform = registry_.get<ecs::LocalTransform>(entity);

    auto headerLabel = makeUnique<ui::Label>(
        ui::WidgetId(contentPanel_->getId().path + "_transform_header"));
    headerLabel->setText("Local Transform");
    contentPanel_->addChild(std::move(headerLabel));

    auto positionEditor = makeUnique<Vector3Editor>(
        ui::WidgetId(contentPanel_->getId().path + "_position"),
        "position");
    positionEditor->setLabel("Position");
    positionEditor->setValue(transform.position);
    positionEditor->setCommandHistory(&history_);

    sink(positionEditor->onValueChanged).connect(
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
    );

    contentPanel_->addChild(std::move(positionEditor));

    glm::vec3 eulerAngles = math::quatToEulerDegrees(transform.rotation);

    auto rotationEditor = makeUnique<Vector3Editor>(
        ui::WidgetId(contentPanel_->getId().path + "_rotation"),
        "rotation");
    rotationEditor->setLabel("Rotation");
    rotationEditor->setValue(eulerAngles);
    rotationEditor->setCommandHistory(&history_);

    sink(rotationEditor->onValueChanged).connect(
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
    );

    contentPanel_->addChild(std::move(rotationEditor));

    auto scaleEditor = makeUnique<Vector3Editor>(
        ui::WidgetId(contentPanel_->getId().path + "_scale"),
        "scale");
    scaleEditor->setLabel("Scale");
    scaleEditor->setValue(transform.scale);
    scaleEditor->setCommandHistory(&history_);

    sink(scaleEditor->onValueChanged).connect(
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
    );

    contentPanel_->addChild(std::move(scaleEditor));
}

}  // namespace esengine::editor
