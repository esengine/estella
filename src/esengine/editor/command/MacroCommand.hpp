/**
 * @file    MacroCommand.hpp
 * @brief   Composite command for grouping multiple commands
 * @details Allows multiple commands to be executed as a single undoable
 *          unit. Useful for complex operations that involve multiple
 *          discrete steps.
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

#include <vector>

namespace esengine::editor {

// =============================================================================
// MacroCommand Class
// =============================================================================

/**
 * @brief Groups multiple commands into a single undoable operation
 *
 * @details MacroCommand executes its child commands in order and
 *          undoes them in reverse order. If any command fails during
 *          execution, all previously executed commands are rolled back.
 *
 * @code
 * auto macro = makeUnique<MacroCommand>("Batch Delete");
 * for (Entity e : selection) {
 *     macro->add(makeUnique<DeleteEntityCommand>(e));
 * }
 * history.execute(std::move(macro));
 * @endcode
 */
class MacroCommand : public Command {
public:
    /**
     * @brief Construct a macro command
     * @param description Description of the combined operation
     */
    explicit MacroCommand(std::string description)
        : description_(std::move(description)) {}

    /**
     * @brief Add a command to the macro
     * @param command Command to add
     * @param alreadyExecuted If true, the command was already executed
     */
    void add(Unique<Command> command, bool alreadyExecuted = false) {
        commands_.push_back(std::move(command));
        if (alreadyExecuted) {
            executedCount_ = commands_.size();
        }
    }

    /**
     * @brief Mark all commands as executed
     * @details Used when commands were executed individually before being
     *          added to the macro (e.g., during transactions).
     */
    void markAllExecuted() {
        executedCount_ = commands_.size();
    }

    /**
     * @brief Get the number of commands in the macro
     * @return Number of commands
     */
    [[nodiscard]] usize size() const {
        return commands_.size();
    }

    /**
     * @brief Check if the macro is empty
     * @return true if no commands
     */
    [[nodiscard]] bool empty() const {
        return commands_.empty();
    }

    /**
     * @brief Execute all commands in order
     * @return Success if all commands succeeded
     */
    CommandResult execute() override {
        if (commands_.empty()) {
            return CommandResult::NoOp;
        }

        executedCount_ = 0;

        for (auto& cmd : commands_) {
            CommandResult result = cmd->execute();

            if (result == CommandResult::Failed) {
                rollback();
                return CommandResult::Failed;
            }

            if (result == CommandResult::Cancelled) {
                rollback();
                return CommandResult::Cancelled;
            }

            if (result == CommandResult::Success) {
                executedCount_++;
            }
        }

        return executedCount_ > 0 ? CommandResult::Success : CommandResult::NoOp;
    }

    /**
     * @brief Undo all commands in reverse order
     */
    void undo() override {
        for (auto it = commands_.rbegin();
             it != commands_.rbegin() + static_cast<std::ptrdiff_t>(executedCount_);
             ++it) {
            (*it)->undo();
        }
    }

    /**
     * @brief Redo all commands in order
     * @return Success if all commands succeeded
     */
    CommandResult redo() override {
        if (commands_.empty()) {
            return CommandResult::NoOp;
        }

        executedCount_ = 0;

        for (usize i = 0; i < commands_.size(); ++i) {
            CommandResult result = commands_[i]->redo();

            if (result == CommandResult::Failed || result == CommandResult::Cancelled) {
                rollback();
                return result;
            }

            if (result == CommandResult::Success) {
                executedCount_++;
            }
        }

        return executedCount_ > 0 ? CommandResult::Success : CommandResult::NoOp;
    }

    [[nodiscard]] std::string getDescription() const override {
        return description_;
    }

    [[nodiscard]] std::string getTypeName() const override {
        return "MacroCommand";
    }

    [[nodiscard]] bool isValid() const override {
        for (const auto& cmd : commands_) {
            if (!cmd->isValid()) {
                return false;
            }
        }
        return true;
    }

    [[nodiscard]] usize getMemoryUsage() const override {
        usize usage = sizeof(*this);
        for (const auto& cmd : commands_) {
            usage += cmd->getMemoryUsage();
        }
        return usage;
    }

private:
    /**
     * @brief Rollback executed commands on failure
     */
    void rollback() {
        for (usize i = executedCount_; i > 0; --i) {
            commands_[i - 1]->undo();
        }
        executedCount_ = 0;
    }

    std::string description_;
    std::vector<Unique<Command>> commands_;
    usize executedCount_ = 0;
};

}  // namespace esengine::editor
