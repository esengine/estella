/**
 * @file    EditorCommands.hpp
 * @brief   Common editor command implementations
 * @details Provides ready-to-use commands for common editor operations
 *          like creating entities, modifying transforms, etc.
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
#include "PropertyCommand.hpp"
#include "../../ecs/Registry.hpp"
#include "../../ecs/Component.hpp"

#include <glm/glm.hpp>

namespace esengine::editor {

// =============================================================================
// Entity Commands
// =============================================================================

/**
 * @brief Command to create a new entity
 */
class CreateEntityCommand : public Command {
public:
    explicit CreateEntityCommand(ecs::Registry& registry, std::string name = "Entity")
        : registry_(registry), name_(std::move(name)) {}

    CommandResult execute() override {
        entity_ = registry_.create();
        registry_.emplace<ecs::Name>(entity_, name_);
        registry_.emplace<ecs::Transform>(entity_);
        return CommandResult::Success;
    }

    void undo() override {
        if (entity_ != INVALID_ENTITY) {
            registry_.destroy(entity_);
        }
    }

    [[nodiscard]] std::string getDescription() const override {
        return "Create Entity \"" + name_ + "\"";
    }

    [[nodiscard]] std::string getTypeName() const override {
        return "CreateEntityCommand";
    }

    [[nodiscard]] Entity getCreatedEntity() const {
        return entity_;
    }

private:
    ecs::Registry& registry_;
    std::string name_;
    Entity entity_ = INVALID_ENTITY;
};

/**
 * @brief Command to delete an entity
 */
class DeleteEntityCommand : public Command {
public:
    DeleteEntityCommand(ecs::Registry& registry, Entity entity)
        : registry_(registry), entity_(entity) {}

    CommandResult execute() override {
        if (!registry_.valid(entity_)) {
            return CommandResult::Failed;
        }

        if (registry_.has<ecs::Name>(entity_)) {
            savedName_ = registry_.get<ecs::Name>(entity_).name;
        }

        if (registry_.has<ecs::Transform>(entity_)) {
            savedTransform_ = registry_.get<ecs::Transform>(entity_);
            hasTransform_ = true;
        }

        registry_.destroy(entity_);
        return CommandResult::Success;
    }

    void undo() override {
        entity_ = registry_.create(entity_);

        if (!savedName_.empty()) {
            registry_.emplace<ecs::Name>(entity_, savedName_);
        }

        if (hasTransform_) {
            registry_.emplace<ecs::Transform>(entity_, savedTransform_);
        }
    }

    [[nodiscard]] std::string getDescription() const override {
        return "Delete Entity";
    }

    [[nodiscard]] std::string getTypeName() const override {
        return "DeleteEntityCommand";
    }

private:
    ecs::Registry& registry_;
    Entity entity_;
    std::string savedName_;
    ecs::Transform savedTransform_;
    bool hasTransform_ = false;
};

/**
 * @brief Command to rename an entity
 */
class RenameEntityCommand : public Command {
public:
    RenameEntityCommand(ecs::Registry& registry, Entity entity, std::string newName)
        : registry_(registry)
        , entity_(entity)
        , newName_(std::move(newName)) {}

    CommandResult execute() override {
        if (!registry_.valid(entity_) || !registry_.has<ecs::Name>(entity_)) {
            return CommandResult::Failed;
        }

        auto& name = registry_.get<ecs::Name>(entity_);
        oldName_ = name.name;
        name.name = newName_;

        return CommandResult::Success;
    }

    void undo() override {
        if (registry_.valid(entity_) && registry_.has<ecs::Name>(entity_)) {
            registry_.get<ecs::Name>(entity_).name = oldName_;
        }
    }

    [[nodiscard]] bool canMergeWith(const Command& other) const override {
        auto* cmd = dynamic_cast<const RenameEntityCommand*>(&other);
        if (!cmd || cmd->entity_ != entity_) {
            return false;
        }

        u64 timeDiff = other.getTimestamp() > getTimestamp()
                           ? other.getTimestamp() - getTimestamp()
                           : getTimestamp() - other.getTimestamp();

        return timeDiff <= getMergeWindowMs();
    }

    void mergeWith(Command& other) override {
        auto& cmd = static_cast<RenameEntityCommand&>(other);
        newName_ = std::move(cmd.newName_);
    }

    [[nodiscard]] std::string getDescription() const override {
        return "Rename Entity to \"" + newName_ + "\"";
    }

    [[nodiscard]] std::string getTypeName() const override {
        return "RenameEntityCommand";
    }

private:
    ecs::Registry& registry_;
    Entity entity_;
    std::string oldName_;
    std::string newName_;
};

// =============================================================================
// Transform Commands
// =============================================================================

/**
 * @brief Command to modify entity position
 */
class SetPositionCommand : public Command {
public:
    SetPositionCommand(ecs::Registry& registry, Entity entity, const glm::vec3& position)
        : registry_(registry)
        , entity_(entity)
        , newPosition_(position) {}

    CommandResult execute() override {
        if (!registry_.valid(entity_) || !registry_.has<ecs::Transform>(entity_)) {
            return CommandResult::Failed;
        }

        auto& transform = registry_.get<ecs::Transform>(entity_);
        oldPosition_ = transform.position;
        transform.position = newPosition_;

        return CommandResult::Success;
    }

    void undo() override {
        if (registry_.valid(entity_) && registry_.has<ecs::Transform>(entity_)) {
            registry_.get<ecs::Transform>(entity_).position = oldPosition_;
        }
    }

    [[nodiscard]] bool canMergeWith(const Command& other) const override {
        auto* cmd = dynamic_cast<const SetPositionCommand*>(&other);
        if (!cmd || cmd->entity_ != entity_) {
            return false;
        }

        u64 timeDiff = other.getTimestamp() > getTimestamp()
                           ? other.getTimestamp() - getTimestamp()
                           : getTimestamp() - other.getTimestamp();

        return timeDiff <= getMergeWindowMs();
    }

    void mergeWith(Command& other) override {
        auto& cmd = static_cast<SetPositionCommand&>(other);
        newPosition_ = cmd.newPosition_;
    }

    [[nodiscard]] std::string getDescription() const override {
        return "Set Position";
    }

    [[nodiscard]] std::string getTypeName() const override {
        return "SetPositionCommand";
    }

private:
    ecs::Registry& registry_;
    Entity entity_;
    glm::vec3 oldPosition_{0.0f};
    glm::vec3 newPosition_;
};

/**
 * @brief Command to modify entity rotation
 */
class SetRotationCommand : public Command {
public:
    SetRotationCommand(ecs::Registry& registry, Entity entity, const glm::vec3& rotation)
        : registry_(registry)
        , entity_(entity)
        , newRotation_(rotation) {}

    CommandResult execute() override {
        if (!registry_.valid(entity_) || !registry_.has<ecs::Transform>(entity_)) {
            return CommandResult::Failed;
        }

        auto& transform = registry_.get<ecs::Transform>(entity_);
        oldRotation_ = transform.rotation;
        transform.rotation = newRotation_;

        return CommandResult::Success;
    }

    void undo() override {
        if (registry_.valid(entity_) && registry_.has<ecs::Transform>(entity_)) {
            registry_.get<ecs::Transform>(entity_).rotation = oldRotation_;
        }
    }

    [[nodiscard]] bool canMergeWith(const Command& other) const override {
        auto* cmd = dynamic_cast<const SetRotationCommand*>(&other);
        if (!cmd || cmd->entity_ != entity_) {
            return false;
        }

        u64 timeDiff = other.getTimestamp() > getTimestamp()
                           ? other.getTimestamp() - getTimestamp()
                           : getTimestamp() - other.getTimestamp();

        return timeDiff <= getMergeWindowMs();
    }

    void mergeWith(Command& other) override {
        auto& cmd = static_cast<SetRotationCommand&>(other);
        newRotation_ = cmd.newRotation_;
    }

    [[nodiscard]] std::string getDescription() const override {
        return "Set Rotation";
    }

    [[nodiscard]] std::string getTypeName() const override {
        return "SetRotationCommand";
    }

private:
    ecs::Registry& registry_;
    Entity entity_;
    glm::vec3 oldRotation_{0.0f};
    glm::vec3 newRotation_;
};

/**
 * @brief Command to modify entity scale
 */
class SetScaleCommand : public Command {
public:
    SetScaleCommand(ecs::Registry& registry, Entity entity, const glm::vec3& scale)
        : registry_(registry)
        , entity_(entity)
        , newScale_(scale) {}

    CommandResult execute() override {
        if (!registry_.valid(entity_) || !registry_.has<ecs::Transform>(entity_)) {
            return CommandResult::Failed;
        }

        auto& transform = registry_.get<ecs::Transform>(entity_);
        oldScale_ = transform.scale;
        transform.scale = newScale_;

        return CommandResult::Success;
    }

    void undo() override {
        if (registry_.valid(entity_) && registry_.has<ecs::Transform>(entity_)) {
            registry_.get<ecs::Transform>(entity_).scale = oldScale_;
        }
    }

    [[nodiscard]] bool canMergeWith(const Command& other) const override {
        auto* cmd = dynamic_cast<const SetScaleCommand*>(&other);
        if (!cmd || cmd->entity_ != entity_) {
            return false;
        }

        u64 timeDiff = other.getTimestamp() > getTimestamp()
                           ? other.getTimestamp() - getTimestamp()
                           : getTimestamp() - other.getTimestamp();

        return timeDiff <= getMergeWindowMs();
    }

    void mergeWith(Command& other) override {
        auto& cmd = static_cast<SetScaleCommand&>(other);
        newScale_ = cmd.newScale_;
    }

    [[nodiscard]] std::string getDescription() const override {
        return "Set Scale";
    }

    [[nodiscard]] std::string getTypeName() const override {
        return "SetScaleCommand";
    }

private:
    ecs::Registry& registry_;
    Entity entity_;
    glm::vec3 oldScale_{1.0f};
    glm::vec3 newScale_;
};

/**
 * @brief Command to modify entire transform
 */
class SetTransformCommand : public Command {
public:
    SetTransformCommand(ecs::Registry& registry, Entity entity,
                        const ecs::Transform& transform)
        : registry_(registry)
        , entity_(entity)
        , newTransform_(transform) {}

    CommandResult execute() override {
        if (!registry_.valid(entity_) || !registry_.has<ecs::Transform>(entity_)) {
            return CommandResult::Failed;
        }

        oldTransform_ = registry_.get<ecs::Transform>(entity_);
        registry_.get<ecs::Transform>(entity_) = newTransform_;

        return CommandResult::Success;
    }

    void undo() override {
        if (registry_.valid(entity_) && registry_.has<ecs::Transform>(entity_)) {
            registry_.get<ecs::Transform>(entity_) = oldTransform_;
        }
    }

    [[nodiscard]] bool canMergeWith(const Command& other) const override {
        auto* cmd = dynamic_cast<const SetTransformCommand*>(&other);
        if (!cmd || cmd->entity_ != entity_) {
            return false;
        }

        u64 timeDiff = other.getTimestamp() > getTimestamp()
                           ? other.getTimestamp() - getTimestamp()
                           : getTimestamp() - other.getTimestamp();

        return timeDiff <= getMergeWindowMs();
    }

    void mergeWith(Command& other) override {
        auto& cmd = static_cast<SetTransformCommand&>(other);
        newTransform_ = cmd.newTransform_;
    }

    [[nodiscard]] std::string getDescription() const override {
        return "Set Transform";
    }

    [[nodiscard]] std::string getTypeName() const override {
        return "SetTransformCommand";
    }

private:
    ecs::Registry& registry_;
    Entity entity_;
    ecs::Transform oldTransform_;
    ecs::Transform newTransform_;
};

}  // namespace esengine::editor
