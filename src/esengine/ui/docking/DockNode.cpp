/**
 * @file    DockNode.cpp
 * @brief   DockNode implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "DockNode.hpp"
#include "DockPanel.hpp"

#include <algorithm>

namespace esengine::ui {

// =============================================================================
// Factory Methods
// =============================================================================

Unique<DockNode> DockNode::createTabs(DockNodeId id) {
    return Unique<DockNode>(new DockNode(id, DockNodeType::Tabs));
}

Unique<DockNode> DockNode::createSplit(DockNodeId id, DockSplitDirection direction) {
    auto node = Unique<DockNode>(new DockNode(id, DockNodeType::Split));
    node->splitDirection_ = direction;
    return node;
}

// =============================================================================
// Constructor / Destructor
// =============================================================================

DockNode::DockNode(DockNodeId id, DockNodeType type)
    : id_(id), type_(type) {}

DockNode::~DockNode() = default;

// =============================================================================
// Tree Structure
// =============================================================================

void DockNode::setFirst(Unique<DockNode> node) {
    first_ = std::move(node);
    if (first_) {
        first_->parent_ = this;
        first_->area_ = area_;
    }
}

void DockNode::setSecond(Unique<DockNode> node) {
    second_ = std::move(node);
    if (second_) {
        second_->parent_ = this;
        second_->area_ = area_;
    }
}

Unique<DockNode> DockNode::detachFirst() {
    if (first_) {
        first_->parent_ = nullptr;
        first_->area_ = nullptr;
    }
    return std::move(first_);
}

Unique<DockNode> DockNode::detachSecond() {
    if (second_) {
        second_->parent_ = nullptr;
        second_->area_ = nullptr;
    }
    return std::move(second_);
}

void DockNode::updateChildParents() {
    if (first_) {
        first_->parent_ = this;
        first_->area_ = area_;
    }
    if (second_) {
        second_->parent_ = this;
        second_->area_ = area_;
    }
}

// =============================================================================
// Split Properties
// =============================================================================

void DockNode::setSplitRatio(f32 ratio) {
    splitRatio_ = std::clamp(ratio, 0.1f, 0.9f);
}

// =============================================================================
// Tab Properties
// =============================================================================

void DockNode::setActiveTabIndex(i32 index) {
    if (!panels_.empty()) {
        activeTabIndex_ = std::clamp(index, 0, static_cast<i32>(panels_.size()) - 1);
    } else {
        activeTabIndex_ = 0;
    }
}

DockPanel* DockNode::getActivePanel() const {
    if (activeTabIndex_ >= 0 && activeTabIndex_ < static_cast<i32>(panels_.size())) {
        return panels_[static_cast<usize>(activeTabIndex_)].get();
    }
    return nullptr;
}

// =============================================================================
// Panel Management
// =============================================================================

void DockNode::addPanel(Unique<DockPanel> panel) {
    if (panel) {
        panel->ownerNode_ = this;
        panels_.push_back(std::move(panel));
        if (panels_.size() == 1) {
            activeTabIndex_ = 0;
        }
    }
}

void DockNode::insertPanel(Unique<DockPanel> panel, i32 index) {
    if (panel) {
        panel->ownerNode_ = this;
        index = std::clamp(index, 0, static_cast<i32>(panels_.size()));
        panels_.insert(panels_.begin() + index, std::move(panel));

        if (activeTabIndex_ >= index) {
            activeTabIndex_++;
        }
    }
}

Unique<DockPanel> DockNode::removePanel(DockPanel* panel) {
    i32 index = findPanelIndex(panel);
    if (index >= 0) {
        return removePanelAt(index);
    }
    return nullptr;
}

Unique<DockPanel> DockNode::removePanelAt(i32 index) {
    if (index < 0 || index >= static_cast<i32>(panels_.size())) {
        return nullptr;
    }

    auto panel = std::move(panels_[static_cast<usize>(index)]);
    panel->ownerNode_ = nullptr;
    panels_.erase(panels_.begin() + index);

    if (activeTabIndex_ >= static_cast<i32>(panels_.size())) {
        activeTabIndex_ = static_cast<i32>(panels_.size()) - 1;
    }
    if (activeTabIndex_ < 0) {
        activeTabIndex_ = 0;
    }

    return panel;
}

i32 DockNode::findPanelIndex(DockPanel* panel) const {
    for (usize i = 0; i < panels_.size(); ++i) {
        if (panels_[i].get() == panel) {
            return static_cast<i32>(i);
        }
    }
    return -1;
}

DockPanel* DockNode::findPanel(DockPanelId id) const {
    for (const auto& panel : panels_) {
        if (panel->getPanelId() == id) {
            return panel.get();
        }
    }
    return nullptr;
}

// =============================================================================
// Layout
// =============================================================================

void DockNode::layout(f32 splitterThickness, f32 tabBarHeight) {
    if (isSplit()) {
        layoutSplit(splitterThickness, tabBarHeight);
    } else {
        layoutTabs(tabBarHeight);
    }
}

void DockNode::layoutSplit(f32 splitterThickness, f32 tabBarHeight) {
    if (!first_ || !second_) return;

    if (splitDirection_ == DockSplitDirection::Horizontal) {
        f32 availableWidth = bounds_.width - splitterThickness;
        f32 firstWidth = availableWidth * splitRatio_;
        f32 secondWidth = availableWidth - firstWidth;

        Rect firstBounds{
            bounds_.x,
            bounds_.y,
            firstWidth,
            bounds_.height
        };

        Rect secondBounds{
            bounds_.x + firstWidth + splitterThickness,
            bounds_.y,
            secondWidth,
            bounds_.height
        };

        first_->setBounds(firstBounds);
        second_->setBounds(secondBounds);
    } else {
        f32 availableHeight = bounds_.height - splitterThickness;
        f32 firstHeight = availableHeight * splitRatio_;
        f32 secondHeight = availableHeight - firstHeight;

        Rect firstBounds{
            bounds_.x,
            bounds_.y,
            bounds_.width,
            firstHeight
        };

        Rect secondBounds{
            bounds_.x,
            bounds_.y + firstHeight + splitterThickness,
            bounds_.width,
            secondHeight
        };

        first_->setBounds(firstBounds);
        second_->setBounds(secondBounds);
    }

    first_->layout(splitterThickness, tabBarHeight);
    second_->layout(splitterThickness, tabBarHeight);
}

void DockNode::layoutTabs(f32 tabBarHeight) {
    contentBounds_ = Rect{
        bounds_.x,
        bounds_.y + tabBarHeight,
        bounds_.width,
        bounds_.height - tabBarHeight
    };

    for (auto& panel : panels_) {
        if (panel) {
            panel->layout(contentBounds_);
        }
    }
}

Rect DockNode::getSplitterBounds(f32 thickness) const {
    if (!isSplit()) return {};

    if (splitDirection_ == DockSplitDirection::Horizontal) {
        f32 availableWidth = bounds_.width - thickness;
        f32 splitterX = bounds_.x + availableWidth * splitRatio_;
        return Rect{
            splitterX,
            bounds_.y,
            thickness,
            bounds_.height
        };
    } else {
        f32 availableHeight = bounds_.height - thickness;
        f32 splitterY = bounds_.y + availableHeight * splitRatio_;
        return Rect{
            bounds_.x,
            splitterY,
            bounds_.width,
            thickness
        };
    }
}

bool DockNode::hitTestSplitter(f32 x, f32 y, f32 tolerance) const {
    if (!isSplit()) return false;

    Rect splitterBounds = getSplitterBounds(tolerance * 2.0f);
    return splitterBounds.contains({x, y});
}

// =============================================================================
// Tree Traversal
// =============================================================================

DockNode* DockNode::findNode(DockNodeId id) {
    if (id_ == id) return this;

    if (first_) {
        if (auto* found = first_->findNode(id)) {
            return found;
        }
    }

    if (second_) {
        if (auto* found = second_->findNode(id)) {
            return found;
        }
    }

    return nullptr;
}

DockNode* DockNode::findNodeContainingPanel(DockPanelId panelId) {
    if (isTabs()) {
        for (const auto& panel : panels_) {
            if (panel && panel->getPanelId() == panelId) {
                return this;
            }
        }
    }

    if (first_) {
        if (auto* found = first_->findNodeContainingPanel(panelId)) {
            return found;
        }
    }

    if (second_) {
        if (auto* found = second_->findNodeContainingPanel(panelId)) {
            return found;
        }
    }

    return nullptr;
}

void DockNode::forEachLeaf(const std::function<void(DockNode&)>& callback) {
    if (isTabs()) {
        callback(*this);
    } else {
        if (first_) first_->forEachLeaf(callback);
        if (second_) second_->forEachLeaf(callback);
    }
}

void DockNode::forEachNode(const std::function<void(DockNode&)>& callback) {
    callback(*this);
    if (first_) first_->forEachNode(callback);
    if (second_) second_->forEachNode(callback);
}

}  // namespace esengine::ui
