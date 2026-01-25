/**
 * @file    PropertyCommand.hpp
 * @brief   Template for mergeable property modification commands
 * @details Provides a base class for commands that modify a single
 *          property value. Supports automatic merging of consecutive
 *          changes to the same property.
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

#include <type_traits>

namespace esengine::editor {

// =============================================================================
// PropertyCommand Template
// =============================================================================

/**
 * @brief Base class for commands that modify a single property
 *
 * @tparam T The property value type
 *
 * @details PropertyCommand provides automatic support for merging
 *          consecutive changes to the same target. Subclasses need only
 *          implement getPropertyRef() and isSameTarget().
 *
 * @code
 * class TransformPositionCommand : public PropertyCommand<glm::vec3> {
 * public:
 *     TransformPositionCommand(Registry& reg, Entity e, const glm::vec3& pos)
 *         : PropertyCommand(pos), registry_(reg), entity_(e) {}
 *
 * protected:
 *     glm::vec3& getPropertyRef() override {
 *         return registry_.get<Transform>(entity_).position;
 *     }
 *
 *     bool isSameTarget(const Command& other) const override {
 *         auto* cmd = dynamic_cast<const TransformPositionCommand*>(&other);
 *         return cmd && cmd->entity_ == entity_;
 *     }
 *
 *     std::string getTargetDescription() const override {
 *         return "Entity " + std::to_string(entity_);
 *     }
 *
 * private:
 *     Registry& registry_;
 *     Entity entity_;
 * };
 * @endcode
 */
template<typename T>
class PropertyCommand : public Command {
public:
    /**
     * @brief Construct with new value
     * @param newValue The value to set
     */
    explicit PropertyCommand(T newValue)
        : newValue_(std::move(newValue)) {}

    /**
     * @brief Construct with explicit old and new values
     * @param oldValue The original value (for undo)
     * @param newValue The value to set
     */
    PropertyCommand(T oldValue, T newValue)
        : oldValue_(std::move(oldValue))
        , newValue_(std::move(newValue))
        , hasOldValue_(true) {}

    CommandResult execute() override {
        if (!hasOldValue_) {
            oldValue_ = getPropertyRef();
            hasOldValue_ = true;
        }

        if (oldValue_ == newValue_) {
            return CommandResult::NoOp;
        }

        getPropertyRef() = newValue_;
        return CommandResult::Success;
    }

    void undo() override {
        getPropertyRef() = oldValue_;
    }

    CommandResult redo() override {
        getPropertyRef() = newValue_;
        return CommandResult::Success;
    }

    [[nodiscard]] bool canMergeWith(const Command& other) const override {
        if (getTypeName() != other.getTypeName()) {
            return false;
        }

        if (!isSameTarget(other)) {
            return false;
        }

        u64 timeDiff = other.getTimestamp() > getTimestamp()
                           ? other.getTimestamp() - getTimestamp()
                           : getTimestamp() - other.getTimestamp();

        return timeDiff <= getMergeWindowMs();
    }

    void mergeWith(Command& other) override {
        auto& otherProp = static_cast<PropertyCommand<T>&>(other);
        newValue_ = std::move(otherProp.newValue_);
    }

    [[nodiscard]] std::string getDescription() const override {
        return "Modify " + getPropertyName() + " on " + getTargetDescription();
    }

    [[nodiscard]] std::string getTypeName() const override {
        return "PropertyCommand";
    }

    [[nodiscard]] usize getMemoryUsage() const override {
        return sizeof(*this);
    }

    /**
     * @brief Get the old value
     * @return The original value before modification
     */
    [[nodiscard]] const T& getOldValue() const {
        return oldValue_;
    }

    /**
     * @brief Get the new value
     * @return The value that was/will be set
     */
    [[nodiscard]] const T& getNewValue() const {
        return newValue_;
    }

protected:
    /**
     * @brief Get a reference to the property being modified
     * @return Reference to the property
     */
    virtual T& getPropertyRef() = 0;

    /**
     * @brief Check if another command targets the same property
     * @param other The other command
     * @return true if same target
     */
    [[nodiscard]] virtual bool isSameTarget(const Command& other) const = 0;

    /**
     * @brief Get the property name for the description
     * @return Property name string
     */
    [[nodiscard]] virtual std::string getPropertyName() const {
        return "property";
    }

    /**
     * @brief Get a description of the target
     * @return Target description string
     */
    [[nodiscard]] virtual std::string getTargetDescription() const {
        return "target";
    }

    T oldValue_{};
    T newValue_;
    bool hasOldValue_ = false;
};

// =============================================================================
// Simple Value Command
// =============================================================================

/**
 * @brief Simple command for setting a value through a pointer
 *
 * @tparam T The value type
 *
 * @code
 * int myValue = 10;
 * auto cmd = makeUnique<SimpleValueCommand<int>>(&myValue, 20);
 * history.execute(std::move(cmd));  // myValue is now 20
 * history.undo();                   // myValue is back to 10
 * @endcode
 */
template<typename T>
class SimpleValueCommand : public Command {
public:
    SimpleValueCommand(T* target, T newValue, std::string description = "Set Value")
        : target_(target)
        , oldValue_(*target)
        , newValue_(std::move(newValue))
        , description_(std::move(description)) {}

    CommandResult execute() override {
        if (oldValue_ == newValue_) {
            return CommandResult::NoOp;
        }
        *target_ = newValue_;
        return CommandResult::Success;
    }

    void undo() override {
        *target_ = oldValue_;
    }

    CommandResult redo() override {
        *target_ = newValue_;
        return CommandResult::Success;
    }

    [[nodiscard]] std::string getDescription() const override {
        return description_;
    }

    [[nodiscard]] std::string getTypeName() const override {
        return "SimpleValueCommand";
    }

    [[nodiscard]] bool isValid() const override {
        return target_ != nullptr;
    }

private:
    T* target_;
    T oldValue_;
    T newValue_;
    std::string description_;
};

// =============================================================================
// Lambda Command
// =============================================================================

/**
 * @brief Command that uses lambdas for execute and undo
 *
 * @details Convenient for one-off commands where creating a full
 *          subclass would be overkill.
 *
 * @code
 * auto cmd = makeUnique<LambdaCommand>(
 *     "Toggle Flag",
 *     [&flag]() { flag = !flag; return CommandResult::Success; },
 *     [&flag]() { flag = !flag; }
 * );
 * @endcode
 */
class LambdaCommand : public Command {
public:
    using ExecuteFunc = std::function<CommandResult()>;
    using UndoFunc = std::function<void()>;

    LambdaCommand(std::string description, ExecuteFunc execute, UndoFunc undo)
        : description_(std::move(description))
        , executeFunc_(std::move(execute))
        , undoFunc_(std::move(undo))
        , redoFunc_(executeFunc_) {}

    LambdaCommand(std::string description, ExecuteFunc execute, UndoFunc undo,
                  ExecuteFunc redo)
        : description_(std::move(description))
        , executeFunc_(std::move(execute))
        , undoFunc_(std::move(undo))
        , redoFunc_(std::move(redo)) {}

    CommandResult execute() override {
        return executeFunc_ ? executeFunc_() : CommandResult::Failed;
    }

    void undo() override {
        if (undoFunc_) {
            undoFunc_();
        }
    }

    CommandResult redo() override {
        return redoFunc_ ? redoFunc_() : CommandResult::Failed;
    }

    [[nodiscard]] std::string getDescription() const override {
        return description_;
    }

    [[nodiscard]] std::string getTypeName() const override {
        return "LambdaCommand";
    }

private:
    std::string description_;
    ExecuteFunc executeFunc_;
    UndoFunc undoFunc_;
    ExecuteFunc redoFunc_;
};

}  // namespace esengine::editor
