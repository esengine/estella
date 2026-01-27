/**
 * @file    DockArea.cpp
 * @brief   DockArea implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "DockArea.hpp"
#include "DockPanel.hpp"
#include "DockTabBar.hpp"
#include "../UIContext.hpp"
#include "../rendering/UIBatchRenderer.hpp"
#include "../../events/Sink.hpp"

namespace esengine::ui {

// =============================================================================
// Constructor / Destructor
// =============================================================================

DockArea::DockArea(const WidgetId& id)
    : Widget(id)
    , zoneDetector_(this) {}

DockArea::~DockArea() = default;

// =============================================================================
// Tree Access
// =============================================================================

DockNode* DockArea::findNode(DockNodeId id) {
    if (!rootNode_) return nullptr;
    return rootNode_->findNode(id);
}

DockPanel* DockArea::findPanel(DockPanelId id) {
    if (!rootNode_) return nullptr;

    DockPanel* found = nullptr;
    rootNode_->forEachLeaf([&](DockNode& node) {
        if (!found) {
            found = node.findPanel(id);
        }
    });
    return found;
}

DockNode* DockArea::findNodeContainingPanel(DockPanelId panelId) {
    if (!rootNode_) return nullptr;
    return rootNode_->findNodeContainingPanel(panelId);
}

// =============================================================================
// Panel Management
// =============================================================================

void DockArea::addPanel(Unique<DockPanel> panel, DockDropZone zone,
                        DockNode* targetNode, f32 ratio) {
    if (!panel) return;

    if (!rootNode_) {
        rootNode_ = DockNode::createTabs(generateNodeId());
        setNodeArea(rootNode_.get());
        rootNode_->addPanel(std::move(panel));
        onLayoutChanged.publish();
        return;
    }

    if (!targetNode) {
        targetNode = rootNode_.get();
    }

    if (zone == DockDropZone::Center || zone == DockDropZone::None) {
        if (targetNode->isTabs()) {
            targetNode->addPanel(std::move(panel));
        } else {
            DockNode* leaf = nullptr;
            targetNode->forEachLeaf([&](DockNode& node) {
                if (!leaf) leaf = &node;
            });
            if (leaf) {
                leaf->addPanel(std::move(panel));
            }
        }
    } else if (isEdgeDropZone(zone)) {
        DockSplitDirection dir = dropZoneToSplitDirection(zone);
        bool insertFirst = dropZoneIsFirst(zone);

        DockNode* newTabsNode = splitNode(targetNode, dir, ratio, insertFirst);
        if (newTabsNode) {
            newTabsNode->addPanel(std::move(panel));
        }
    }

    onLayoutChanged.publish();
}

Unique<DockPanel> DockArea::removePanel(DockPanelId panelId) {
    DockNode* node = findNodeContainingPanel(panelId);
    if (!node) return nullptr;

    DockPanel* panel = node->findPanel(panelId);
    if (!panel) return nullptr;

    auto removed = node->removePanel(panel);

    if (node->isEmpty()) {
        tryMergeNode(node);
    }

    onLayoutChanged.publish();
    return removed;
}

void DockArea::movePanel(DockPanel* panel, const DockDropTarget& target) {
    if (!panel || target.zone == DockDropZone::None) return;

    DockNode* sourceNode = panel->getOwnerNode();
    if (!sourceNode) return;

    auto detachedPanel = sourceNode->removePanel(panel);
    if (!detachedPanel) return;

    if (target.zone == DockDropZone::Center) {
        if (target.targetNode) {
            if (target.targetNode->isTabs()) {
                target.targetNode->addPanel(std::move(detachedPanel));
            } else {
                DockNode* leaf = nullptr;
                target.targetNode->forEachLeaf([&](DockNode& node) {
                    if (!leaf) leaf = &node;
                });
                if (leaf) {
                    leaf->addPanel(std::move(detachedPanel));
                }
            }
        }
    } else if (isEdgeDropZone(target.zone)) {
        DockSplitDirection dir = dropZoneToSplitDirection(target.zone);
        bool insertFirst = dropZoneIsFirst(target.zone);

        DockNode* newNode = splitNode(target.targetNode, dir, target.splitRatio, insertFirst);
        if (newNode) {
            newNode->addPanel(std::move(detachedPanel));
        }
    }

    if (sourceNode->isEmpty()) {
        tryMergeNode(sourceNode);
    }

    onLayoutChanged.publish();
}

void DockArea::closePanel(DockPanelId panelId) {
    auto panel = removePanel(panelId);
    if (panel) {
        onPanelClosed.publish(panelId);
    }
}

std::vector<DockPanel*> DockArea::getAllPanels() const {
    std::vector<DockPanel*> result;

    if (rootNode_) {
        rootNode_->forEachLeaf([&](DockNode& node) {
            for (const auto& panel : node.getPanels()) {
                if (panel) {
                    result.push_back(panel.get());
                }
            }
        });
    }

    return result;
}

// =============================================================================
// Node Operations
// =============================================================================

DockNode* DockArea::splitNode(DockNode* node, DockSplitDirection direction,
                               f32 ratio, bool insertFirst) {
    if (!node) return nullptr;

    auto newTabsNode = DockNode::createTabs(generateNodeId());
    DockNode* newTabsPtr = newTabsNode.get();

    if (node == rootNode_.get()) {
        auto newSplit = DockNode::createSplit(generateNodeId(), direction);
        newSplit->setSplitRatio(insertFirst ? ratio : (1.0f - ratio));

        if (insertFirst) {
            newSplit->setFirst(std::move(newTabsNode));
            newSplit->setSecond(std::move(rootNode_));
        } else {
            newSplit->setFirst(std::move(rootNode_));
            newSplit->setSecond(std::move(newTabsNode));
        }

        rootNode_ = std::move(newSplit);
        setNodeArea(rootNode_.get());
    } else {
        DockNode* parent = node->getParent();
        if (!parent || !parent->isSplit()) return nullptr;

        bool isFirst = (parent->getFirst() == node);

        Unique<DockNode> detached = isFirst ? parent->detachFirst() : parent->detachSecond();

        auto newSplit = DockNode::createSplit(generateNodeId(), direction);
        newSplit->setSplitRatio(insertFirst ? ratio : (1.0f - ratio));

        if (insertFirst) {
            newSplit->setFirst(std::move(newTabsNode));
            newSplit->setSecond(std::move(detached));
        } else {
            newSplit->setFirst(std::move(detached));
            newSplit->setSecond(std::move(newTabsNode));
        }

        if (isFirst) {
            parent->setFirst(std::move(newSplit));
        } else {
            parent->setSecond(std::move(newSplit));
        }

        setNodeArea(parent);
    }

    return newTabsPtr;
}

void DockArea::tryMergeNode(DockNode* node) {
    if (!node || !node->isEmpty()) return;

    DockNode* parent = node->getParent();
    if (!parent || !parent->isSplit()) {
        if (node == rootNode_.get() && node->isEmpty()) {
            rootNode_.reset();
        }
        return;
    }

    bool isFirst = (parent->getFirst() == node);
    DockNode* sibling = isFirst ? parent->getSecond() : parent->getFirst();

    if (!sibling) return;

    Unique<DockNode> siblingOwned = isFirst ? parent->detachSecond() : parent->detachFirst();

    DockNode* grandparent = parent->getParent();
    if (grandparent && grandparent->isSplit()) {
        bool parentIsFirst = (grandparent->getFirst() == parent);
        if (parentIsFirst) {
            grandparent->setFirst(std::move(siblingOwned));
        } else {
            grandparent->setSecond(std::move(siblingOwned));
        }
    } else if (parent == rootNode_.get()) {
        rootNode_ = std::move(siblingOwned);
        if (rootNode_) {
            rootNode_->parent_ = nullptr;
            setNodeArea(rootNode_.get());
        }
    }

    tabBars_.erase(node->getId());
    tabBarConnections_.erase(node->getId());
    tabBars_.erase(parent->getId());
    tabBarConnections_.erase(parent->getId());
}

// =============================================================================
// Drag and Drop
// =============================================================================

void DockArea::beginPanelDrag(DockPanel* panel, const glm::vec2& startPos) {
    zoneDetector_.beginDrag(panel, startPos);
}

// =============================================================================
// Widget Overrides
// =============================================================================

glm::vec2 DockArea::measure(f32 availableWidth, f32 availableHeight) {
    return {availableWidth, availableHeight};
}

void DockArea::render(UIBatchRenderer& renderer) {
    if (!rootNode_) {
        return;
    }

    rootNode_->setBounds(getBounds());
    rootNode_->layout(splitterThickness_, tabBarHeight_);

    renderNode(renderer, rootNode_.get());

    zoneDetector_.render(renderer);
}

Widget* DockArea::hitTest(f32 x, f32 y) {
    if (hitTestSplitter(x, y)) {
        return this;
    }

    return Widget::hitTest(x, y);
}

void DockArea::renderNode(UIBatchRenderer& renderer, DockNode* node) {
    if (!node) return;

    if (node->isSplit()) {
        renderNode(renderer, node->getFirst());
        renderNode(renderer, node->getSecond());
        renderSplitter(renderer, node);
    } else {
        renderTabBar(renderer, node);

        DockPanel* activePanel = node->getActivePanel();
        if (activePanel) {
            if (activePanel->getContext() != getContext()) {
                activePanel->setContext(getContext());
            }
            activePanel->render(renderer);
        }
    }
}

void DockArea::renderSplitter(UIBatchRenderer& renderer, DockNode* node) {
    if (!node || !node->isSplit()) return;

    UIContext* ctx = getContext();
    if (!ctx) return;

    Rect splitterBounds = node->getSplitterBounds(splitterThickness_);
    glm::vec2 mousePos = ctx->getMousePosition();
    bool hovered = (draggedSplitter_ == node) ||
                   splitterBounds.contains({mousePos.x, mousePos.y});

    glm::vec4 color = hovered
                          ? ctx->getTheme().colors.accent
                          : ctx->getTheme().colors.border;

    renderer.drawRect(splitterBounds, color);
}

void DockArea::renderTabBar(UIBatchRenderer& renderer, DockNode* node) {
    if (!node || !node->isTabs()) return;

    DockTabBar* tabBar = getOrCreateTabBar(node);
    if (!tabBar) return;

    if (tabBar->getContext() != getContext()) {
        tabBar->setContext(getContext());
    }

    Rect tabBarBounds{
        node->getBounds().x,
        node->getBounds().y,
        node->getBounds().width,
        tabBarHeight_
    };

    tabBar->layout(tabBarBounds);
    tabBar->render(renderer);
}

// =============================================================================
// Event Handling
// =============================================================================

bool DockArea::onMouseDown(const MouseButtonEvent& event) {
    if (event.button != MouseButton::Left) return false;

    if (zoneDetector_.isDragging()) {
        return true;
    }

    DockNode* splitter = hitTestSplitter(event.x, event.y);
    if (splitter) {
        draggedSplitter_ = splitter;
        splitterDragStart_ = {event.x, event.y};
        splitterDragStartRatio_ = splitter->getSplitRatio();
        return true;
    }

    if (rootNode_) {
        rootNode_->forEachLeaf([&](DockNode& node) {
            DockTabBar* tabBar = getOrCreateTabBar(&node);
            if (tabBar) {
                Rect tabBarBounds{
                    node.getBounds().x,
                    node.getBounds().y,
                    node.getBounds().width,
                    tabBarHeight_
                };
                if (tabBarBounds.contains({event.x, event.y})) {
                    tabBar->onMouseDown(event);
                }
            }
        });
    }

    return false;
}

bool DockArea::onMouseUp(const MouseButtonEvent& event) {
    if (event.button != MouseButton::Left) return false;

    if (zoneDetector_.isDragging()) {
        DockPanel* panel = zoneDetector_.getDraggedPanel();
        DockDropTarget target = zoneDetector_.endDrag();
        if (panel && target.zone != DockDropZone::None) {
            movePanel(panel, target);
        }
        return true;
    }

    if (draggedSplitter_) {
        draggedSplitter_ = nullptr;
        return true;
    }

    if (rootNode_) {
        rootNode_->forEachLeaf([&](DockNode& node) {
            DockTabBar* tabBar = getOrCreateTabBar(&node);
            if (tabBar) {
                tabBar->onMouseUp(event);
            }
        });
    }

    return false;
}

bool DockArea::onMouseMove(const MouseMoveEvent& event) {
    lastMouseX_ = event.x;
    lastMouseY_ = event.y;

    if (zoneDetector_.isDragging()) {
        zoneDetector_.updateDrag({event.x, event.y});
        return true;
    }

    if (draggedSplitter_) {
        handleSplitterDrag(event.x, event.y);
        return true;
    }

    if (rootNode_) {
        rootNode_->forEachLeaf([&](DockNode& node) {
            DockTabBar* tabBar = getOrCreateTabBar(&node);
            if (tabBar) {
                tabBar->onMouseMove(event);
            }
        });
    }

    return false;
}

void DockArea::onStateChanged() {
    Widget::onStateChanged();
}

// =============================================================================
// Private Methods
// =============================================================================

DockNode* DockArea::hitTestSplitter(f32 x, f32 y) {
    if (!rootNode_) return nullptr;

    DockNode* result = nullptr;
    rootNode_->forEachNode([&](DockNode& node) {
        if (!result && node.isSplit() && node.hitTestSplitter(x, y, splitterThickness_)) {
            result = &node;
        }
    });
    return result;
}

void DockArea::handleSplitterDrag(f32 x, f32 y) {
    if (!draggedSplitter_) return;

    const Rect& bounds = draggedSplitter_->getBounds();
    f32 newRatio;

    if (draggedSplitter_->getSplitDirection() == DockSplitDirection::Horizontal) {
        f32 relX = x - bounds.x;
        newRatio = relX / bounds.width;
    } else {
        f32 relY = y - bounds.y;
        newRatio = relY / bounds.height;
    }

    draggedSplitter_->setSplitRatio(newRatio);
}

void DockArea::setNodeArea(DockNode* node) {
    if (!node) return;

    node->area_ = this;

    if (node->getFirst()) {
        setNodeArea(node->getFirst());
    }
    if (node->getSecond()) {
        setNodeArea(node->getSecond());
    }
}

DockTabBar* DockArea::getOrCreateTabBar(DockNode* node) {
    if (!node || !node->isTabs()) return nullptr;

    auto it = tabBars_.find(node->getId());
    if (it != tabBars_.end()) {
        return it->second.get();
    }

    auto tabBar = makeUnique<DockTabBar>(
        WidgetId("dock.tabbar." + std::to_string(node->getId())),
        node
    );

    std::vector<Connection> connections;

    connections.push_back(sink(tabBar->onTabSelected).connect([this, node](i32 index) {
        node->setActiveTabIndex(index);
        DockPanel* panel = node->getActivePanel();
        if (panel) {
            onPanelActivated.publish(panel->getPanelId());
        }
    }));

    connections.push_back(sink(tabBar->onTabCloseRequested).connect([this](DockPanelId panelId) {
        closePanel(panelId);
    }));

    connections.push_back(sink(tabBar->onTabDragStart).connect([this](DockPanelId panelId, glm::vec2 pos) {
        DockPanel* panel = findPanel(panelId);
        if (panel) {
            beginPanelDrag(panel, pos);
        }
    }));

    DockTabBar* ptr = tabBar.get();
    DockNodeId nodeId = node->getId();
    tabBars_[nodeId] = std::move(tabBar);
    tabBarConnections_[nodeId] = std::move(connections);
    return ptr;
}

}  // namespace esengine::ui
