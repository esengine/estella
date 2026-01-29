/**
 * @file    TransformCommand.hpp
 * @brief   Command for entity transform modifications
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

#include "Command.hpp"
#include "../../ecs/Registry.hpp"
#include "../../ecs/components/Transform.hpp"

namespace esengine::editor {

// =============================================================================
// TransformCommand Class
// =============================================================================

/**
 * @brief Command for modifying entity transforms
 *
 * @details Stores the old and new transform values to support undo/redo.
 */
class TransformCommand : public Command {
public:
    TransformCommand(ecs::Registry& registry, Entity entity,
                     const ecs::LocalTransform& oldTransform,
                     const ecs::LocalTransform& newTransform)
        : registry_(registry),
          entity_(entity),
          oldTransform_(oldTransform),
          newTransform_(newTransform) {}

    CommandResult execute() override {
        if (!registry_.valid(entity_) || !registry_.has<ecs::LocalTransform>(entity_)) {
            return CommandResult::Failed;
        }

        registry_.get<ecs::LocalTransform>(entity_) = newTransform_;
        return CommandResult::Success;
    }

    void undo() override {
        if (registry_.valid(entity_) && registry_.has<ecs::LocalTransform>(entity_)) {
            registry_.get<ecs::LocalTransform>(entity_) = oldTransform_;
        }
    }

    [[nodiscard]] std::string getDescription() const override {
        return "Transform Entity";
    }

    [[nodiscard]] std::string getTypeName() const override {
        return "TransformCommand";
    }

    [[nodiscard]] bool canMergeWith(const Command& other) const override {
        auto* otherCmd = dynamic_cast<const TransformCommand*>(&other);
        if (!otherCmd) return false;

        if (entity_ != otherCmd->entity_) return false;

        u64 timeDiff = otherCmd->getTimestamp() > getTimestamp()
            ? otherCmd->getTimestamp() - getTimestamp()
            : getTimestamp() - otherCmd->getTimestamp();

        return timeDiff < getMergeWindowMs();
    }

    void mergeWith(Command& other) override {
        auto* otherCmd = dynamic_cast<TransformCommand*>(&other);
        if (otherCmd) {
            newTransform_ = otherCmd->newTransform_;
        }
    }

    [[nodiscard]] u32 getMergeWindowMs() const override {
        return 300;
    }

private:
    ecs::Registry& registry_;
    Entity entity_;
    ecs::LocalTransform oldTransform_;
    ecs::LocalTransform newTransform_;
};

}  // namespace esengine::editor
