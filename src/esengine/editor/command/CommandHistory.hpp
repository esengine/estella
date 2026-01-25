/**
 * @file    CommandHistory.hpp
 * @brief   Command history management with undo/redo support
 * @details Manages the execution history of commands, providing undo
 *          and redo functionality with memory limits and command merging.
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
#include "MacroCommand.hpp"
#include "../core/EditorEvents.hpp"
#include "../../events/Dispatcher.hpp"

#include <chrono>
#include <deque>
#include <future>
#include <mutex>
#include <queue>

namespace esengine::editor {

// =============================================================================
// Configuration
// =============================================================================

/**
 * @brief Configuration for CommandHistory
 */
struct CommandHistoryConfig {
    u32 maxUndoLevels = 100;
    usize maxMemoryUsage = 64 * 1024 * 1024;  // 64 MB
    bool enableMerging = true;
    bool enableAsyncExecution = false;
};

// =============================================================================
// Transaction Guard
// =============================================================================

class CommandHistory;

/**
 * @brief RAII guard for command transactions
 *
 * @details Groups multiple commands into a single undoable operation.
 *          Automatically commits on success or rolls back on exception.
 *
 * @code
 * {
 *     TransactionGuard guard(history, "Batch Move");
 *     for (Entity e : selection) {
 *         history.execute<MoveCommand>(e, delta);
 *     }
 * }  // Auto-commits here
 * @endcode
 */
class TransactionGuard {
public:
    TransactionGuard(CommandHistory& history, const std::string& description);
    ~TransactionGuard();

    TransactionGuard(const TransactionGuard&) = delete;
    TransactionGuard& operator=(const TransactionGuard&) = delete;
    TransactionGuard(TransactionGuard&&) = delete;
    TransactionGuard& operator=(TransactionGuard&&) = delete;

    void commit();
    void rollback();

private:
    CommandHistory& history_;
    bool committed_ = false;
    bool rolledBack_ = false;
};

// =============================================================================
// CommandHistory Class
// =============================================================================

/**
 * @brief Manages command execution history with undo/redo support
 *
 * @details CommandHistory tracks executed commands and provides undo/redo
 *          functionality. It supports command merging, transactions,
 *          memory limits, and event notifications.
 *
 * @code
 * CommandHistory history;
 *
 * // Execute a command
 * history.execute(makeUnique<MoveCommand>(entity, newPos));
 *
 * // Or construct in-place
 * history.execute<MoveCommand>(entity, newPos);
 *
 * // Undo/Redo
 * history.undo();
 * history.redo();
 * @endcode
 */
class CommandHistory {
public:
    /**
     * @brief Construct with default configuration
     */
    CommandHistory() : CommandHistory(CommandHistoryConfig{}) {}

    /**
     * @brief Construct with custom configuration
     * @param config Configuration options
     */
    explicit CommandHistory(CommandHistoryConfig config)
        : config_(config) {}

    ~CommandHistory() = default;

    CommandHistory(const CommandHistory&) = delete;
    CommandHistory& operator=(const CommandHistory&) = delete;
    CommandHistory(CommandHistory&&) = default;
    CommandHistory& operator=(CommandHistory&&) = default;

    /**
     * @brief Execute a command
     * @param cmd The command to execute
     * @return Result of execution
     */
    CommandResult execute(Unique<Command> cmd) {
        return executeImpl(std::move(cmd), CommandOptions{});
    }

    /**
     * @brief Execute a command with options
     * @param cmd The command to execute
     * @param options Execution options
     * @return Result of execution
     */
    CommandResult execute(Unique<Command> cmd, const CommandOptions& options) {
        return executeImpl(std::move(cmd), options);
    }

    /**
     * @brief Execute a command constructed in-place
     * @tparam T Command type
     * @tparam Args Constructor argument types
     * @param args Constructor arguments
     * @return Result of execution
     */
    template<CommandType T, typename... Args>
    CommandResult execute(Args&&... args) {
        return execute(makeUnique<T>(std::forward<Args>(args)...));
    }

    /**
     * @brief Undo the last command
     * @return true if undo succeeded
     */
    bool undo() {
        if (!canUndo()) {
            return false;
        }

        if (inTransaction_) {
            return false;
        }

        auto& cmd = undoStack_.back();
        cmd->undo();

        redoStack_.push_back(std::move(cmd));
        undoStack_.pop_back();

        updateMemoryUsage();
        notifyHistoryChanged();

        if (dispatcher_) {
            dispatcher_->trigger(UndoRedoEvent{
                true,
                !redoStack_.empty() ? redoStack_.back()->getDescription() : ""});
        }

        return true;
    }

    /**
     * @brief Redo the last undone command
     * @return true if redo succeeded
     */
    bool redo() {
        if (!canRedo()) {
            return false;
        }

        if (inTransaction_) {
            return false;
        }

        auto& cmd = redoStack_.back();
        CommandResult result = cmd->redo();

        if (result == CommandResult::Failed) {
            return false;
        }

        undoStack_.push_back(std::move(cmd));
        redoStack_.pop_back();

        updateMemoryUsage();
        notifyHistoryChanged();

        if (dispatcher_) {
            dispatcher_->trigger(UndoRedoEvent{
                false,
                undoStack_.back()->getDescription()});
        }

        return true;
    }

    /**
     * @brief Check if undo is available
     * @return true if can undo
     */
    [[nodiscard]] bool canUndo() const {
        return !undoStack_.empty() && !inTransaction_;
    }

    /**
     * @brief Check if redo is available
     * @return true if can redo
     */
    [[nodiscard]] bool canRedo() const {
        return !redoStack_.empty() && !inTransaction_;
    }

    /**
     * @brief Get the description of the next undo action
     * @return Description string or empty
     */
    [[nodiscard]] std::string getUndoDescription() const {
        return canUndo() ? undoStack_.back()->getDescription() : "";
    }

    /**
     * @brief Get the description of the next redo action
     * @return Description string or empty
     */
    [[nodiscard]] std::string getRedoDescription() const {
        return canRedo() ? redoStack_.back()->getDescription() : "";
    }

    /**
     * @brief Check if there are unsaved changes
     * @return true if modified since last save
     */
    [[nodiscard]] bool isDirty() const {
        return dirty_;
    }

    /**
     * @brief Mark the current state as saved
     */
    void markSaved() {
        dirty_ = false;
        savedPosition_ = undoStack_.size();
    }

    /**
     * @brief Clear all history
     */
    void clear() {
        undoStack_.clear();
        redoStack_.clear();
        currentMemoryUsage_ = 0;
        dirty_ = false;
        savedPosition_ = 0;
        notifyHistoryChanged();
    }

    /**
     * @brief Begin a transaction
     * @param description Description of the transaction
     */
    void beginTransaction(const std::string& description) {
        if (inTransaction_) {
            return;
        }

        inTransaction_ = true;
        currentTransaction_ = makeUnique<MacroCommand>(description);
    }

    /**
     * @brief Commit the current transaction
     * @return true if committed successfully
     */
    bool commitTransaction() {
        if (!inTransaction_ || !currentTransaction_) {
            return false;
        }

        inTransaction_ = false;

        if (currentTransaction_->empty()) {
            currentTransaction_.reset();
            return true;
        }

        auto macro = std::move(currentTransaction_);
        pushToUndoStack(std::move(macro));
        notifyHistoryChanged();

        return true;
    }

    /**
     * @brief Rollback the current transaction
     */
    void rollbackTransaction() {
        if (!inTransaction_ || !currentTransaction_) {
            return;
        }

        inTransaction_ = false;
        currentTransaction_.reset();
    }

    /**
     * @brief Check if in a transaction
     * @return true if in transaction
     */
    [[nodiscard]] bool inTransaction() const {
        return inTransaction_;
    }

    /**
     * @brief Get the number of undo levels
     * @return Number of undoable commands
     */
    [[nodiscard]] usize getUndoCount() const {
        return undoStack_.size();
    }

    /**
     * @brief Get the number of redo levels
     * @return Number of redoable commands
     */
    [[nodiscard]] usize getRedoCount() const {
        return redoStack_.size();
    }

    /**
     * @brief Get current memory usage
     * @return Memory usage in bytes
     */
    [[nodiscard]] usize getMemoryUsage() const {
        return currentMemoryUsage_;
    }

    /**
     * @brief Set the event dispatcher for notifications
     * @param dispatcher The dispatcher to use
     */
    void setDispatcher(Dispatcher* dispatcher) {
        dispatcher_ = dispatcher;
    }

    /**
     * @brief Get the configuration
     * @return Configuration reference
     */
    [[nodiscard]] const CommandHistoryConfig& getConfig() const {
        return config_;
    }

    /**
     * @brief Update configuration
     * @param config New configuration
     */
    void setConfig(const CommandHistoryConfig& config) {
        config_ = config;
        enforceMemoryLimit();
    }

private:
    friend class TransactionGuard;

    CommandResult executeImpl(Unique<Command> cmd, const CommandOptions& options) {
        if (!cmd || !cmd->isValid()) {
            return CommandResult::Failed;
        }

        cmd->setTimestamp(getCurrentTimeMs());

        CommandResult result = cmd->execute();

        if (result != CommandResult::Success) {
            return result;
        }

        dirty_ = true;

        if (!options.addToHistory) {
            return result;
        }

        if (inTransaction_ && currentTransaction_) {
            currentTransaction_->add(std::move(cmd), true);  // Already executed
            return result;
        }

        if (config_.enableMerging && options.mergeWithPrevious && !undoStack_.empty()) {
            auto& lastCmd = undoStack_.back();
            if (lastCmd->canMergeWith(*cmd)) {
                lastCmd->mergeWith(*cmd);
                notifyHistoryChanged();
                return result;
            }
        }

        if (config_.enableMerging && !undoStack_.empty()) {
            auto& lastCmd = undoStack_.back();
            if (cmd->canMergeWith(*lastCmd)) {
                lastCmd->mergeWith(*cmd);
                notifyHistoryChanged();
                return result;
            }
        }

        redoStack_.clear();
        pushToUndoStack(std::move(cmd));
        notifyHistoryChanged();

        return result;
    }

    void pushToUndoStack(Unique<Command> cmd) {
        currentMemoryUsage_ += cmd->getMemoryUsage();
        undoStack_.push_back(std::move(cmd));

        enforceUndoLimit();
        enforceMemoryLimit();
    }

    void enforceUndoLimit() {
        while (undoStack_.size() > config_.maxUndoLevels) {
            currentMemoryUsage_ -= undoStack_.front()->getMemoryUsage();
            undoStack_.pop_front();

            if (savedPosition_ > 0) {
                savedPosition_--;
            }
        }
    }

    void enforceMemoryLimit() {
        while (currentMemoryUsage_ > config_.maxMemoryUsage && !undoStack_.empty()) {
            currentMemoryUsage_ -= undoStack_.front()->getMemoryUsage();
            undoStack_.pop_front();

            if (savedPosition_ > 0) {
                savedPosition_--;
            }
        }
    }

    void updateMemoryUsage() {
        currentMemoryUsage_ = 0;
        for (const auto& cmd : undoStack_) {
            currentMemoryUsage_ += cmd->getMemoryUsage();
        }
        for (const auto& cmd : redoStack_) {
            currentMemoryUsage_ += cmd->getMemoryUsage();
        }
    }

    void notifyHistoryChanged() {
        if (dispatcher_) {
            dispatcher_->trigger(HistoryChanged{
                canUndo(),
                canRedo(),
                getUndoDescription(),
                getRedoDescription()});
        }
    }

    static u64 getCurrentTimeMs() {
        auto now = std::chrono::steady_clock::now();
        auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
            now.time_since_epoch());
        return static_cast<u64>(ms.count());
    }

    CommandHistoryConfig config_;
    std::deque<Unique<Command>> undoStack_;
    std::deque<Unique<Command>> redoStack_;

    usize currentMemoryUsage_ = 0;
    bool dirty_ = false;
    usize savedPosition_ = 0;

    bool inTransaction_ = false;
    Unique<MacroCommand> currentTransaction_;

    Dispatcher* dispatcher_ = nullptr;
};

// =============================================================================
// TransactionGuard Implementation
// =============================================================================

inline TransactionGuard::TransactionGuard(CommandHistory& history,
                                          const std::string& description)
    : history_(history) {
    history_.beginTransaction(description);
}

inline TransactionGuard::~TransactionGuard() {
    if (!committed_ && !rolledBack_) {
        try {
            commit();
        } catch (...) {
            rollback();
        }
    }
}

inline void TransactionGuard::commit() {
    if (!committed_ && !rolledBack_) {
        history_.commitTransaction();
        committed_ = true;
    }
}

inline void TransactionGuard::rollback() {
    if (!committed_ && !rolledBack_) {
        history_.rollbackTransaction();
        rolledBack_ = true;
    }
}

}  // namespace esengine::editor
