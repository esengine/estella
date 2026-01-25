/**
 * @file    Command.hpp
 * @brief   Base class for undoable commands
 * @details Defines the interface for commands that support undo/redo
 *          operations. All editor operations that modify state should
 *          be implemented as Command subclasses.
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

#include "../../core/Types.hpp"

#include <string>
#include <vector>

namespace esengine::editor {

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * @brief Result of command execution
 */
enum class CommandResult : u8 {
    Success,
    Failed,
    Cancelled,
    NoOp
};

/**
 * @brief Command execution options
 */
struct CommandOptions {
    bool addToHistory = true;
    bool mergeWithPrevious = false;
};

// =============================================================================
// Command Base Class
// =============================================================================

/**
 * @brief Abstract base class for undoable commands
 *
 * @details Commands encapsulate operations that can be undone and redone.
 *          Each command stores enough state to reverse its effects.
 *
 * @code
 * class MoveEntityCommand : public Command {
 * public:
 *     MoveEntityCommand(Entity e, const glm::vec3& newPos)
 *         : entity_(e), newPosition_(newPos) {}
 *
 *     CommandResult execute() override {
 *         oldPosition_ = getPosition(entity_);
 *         setPosition(entity_, newPosition_);
 *         return CommandResult::Success;
 *     }
 *
 *     void undo() override {
 *         setPosition(entity_, oldPosition_);
 *     }
 *
 *     std::string getDescription() const override {
 *         return "Move Entity";
 *     }
 * };
 * @endcode
 */
class Command {
public:
    virtual ~Command() = default;

    /**
     * @brief Execute the command
     * @return Result indicating success or failure
     */
    virtual CommandResult execute() = 0;

    /**
     * @brief Undo the command
     */
    virtual void undo() = 0;

    /**
     * @brief Redo the command (default: re-execute)
     * @return Result indicating success or failure
     */
    virtual CommandResult redo() {
        return execute();
    }

    /**
     * @brief Get a human-readable description
     * @return Description string
     */
    [[nodiscard]] virtual std::string getDescription() const = 0;

    /**
     * @brief Get the command type name
     * @return Type name for debugging/logging
     */
    [[nodiscard]] virtual std::string getTypeName() const {
        return "Command";
    }

    /**
     * @brief Check if this command can merge with another
     *
     * @param other The command to potentially merge with
     * @return true if commands can be merged
     *
     * @details Command merging allows multiple similar operations
     *          (e.g., dragging) to be combined into a single undo step.
     */
    [[nodiscard]] virtual bool canMergeWith(const Command& other) const {
        (void)other;
        return false;
    }

    /**
     * @brief Merge another command into this one
     *
     * @param other The command to merge (will be discarded after)
     *
     * @details After merging, this command should represent the combined
     *          effect of both commands. The other command will be deleted.
     */
    virtual void mergeWith(Command& other) {
        (void)other;
    }

    /**
     * @brief Get the merge window in milliseconds
     * @return Time window for merging (0 = no time limit)
     */
    [[nodiscard]] virtual u32 getMergeWindowMs() const {
        return 500;
    }

    /**
     * @brief Check if the command is still valid
     * @return true if the command can be executed/undone
     */
    [[nodiscard]] virtual bool isValid() const {
        return true;
    }

    /**
     * @brief Estimate memory usage of this command
     * @return Memory usage in bytes
     */
    [[nodiscard]] virtual usize getMemoryUsage() const {
        return sizeof(*this);
    }

    /**
     * @brief Serialize the command to a buffer
     *
     * @param buffer Output buffer
     * @return true if serialization succeeded
     *
     * @details Optional: Used for persistent undo history.
     */
    [[nodiscard]] virtual bool serialize(std::vector<u8>& buffer) const {
        (void)buffer;
        return false;
    }

    /**
     * @brief Get the timestamp when the command was created
     * @return Timestamp in milliseconds
     */
    [[nodiscard]] u64 getTimestamp() const {
        return timestamp_;
    }

    /**
     * @brief Set the timestamp (called by CommandHistory)
     * @param timestamp Timestamp in milliseconds
     */
    void setTimestamp(u64 timestamp) {
        timestamp_ = timestamp;
    }

protected:
    Command() = default;

private:
    u64 timestamp_ = 0;
};

// =============================================================================
// Concept for Commands
// =============================================================================

/**
 * @brief Concept for command types
 */
template<typename T>
concept CommandType = std::derived_from<T, Command>;

}  // namespace esengine::editor
