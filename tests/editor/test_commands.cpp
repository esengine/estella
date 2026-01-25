/**
 * @file    test_commands.cpp
 * @brief   Unit tests for the command system
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include <esengine/editor/command/Command.hpp>
#include <esengine/editor/command/CommandHistory.hpp>
#include <esengine/editor/command/MacroCommand.hpp>
#include <esengine/editor/command/PropertyCommand.hpp>
#include <iostream>
#include <cassert>

using namespace esengine;
using namespace esengine::editor;

// Simple test macros
#define TEST(name) void test_##name()
#define RUN_TEST(name) do { \
    std::cout << "Running " #name "... "; \
    test_##name(); \
    std::cout << "PASSED" << std::endl; \
    passed++; \
} while(0)

#define ASSERT_TRUE(cond) do { \
    if (!(cond)) { \
        std::cerr << "FAILED: " #cond << " at line " << __LINE__ << std::endl; \
        failed++; \
        return; \
    } \
} while(0)

#define ASSERT_EQ(a, b) ASSERT_TRUE((a) == (b))
#define ASSERT_NE(a, b) ASSERT_TRUE((a) != (b))

static int passed = 0;
static int failed = 0;

// Test command that increments a counter
class IncrementCommand : public Command {
public:
    IncrementCommand(int& counter, int amount = 1)
        : counter_(counter), amount_(amount) {}

    CommandResult execute() override {
        counter_ += amount_;
        return CommandResult::Success;
    }

    void undo() override {
        counter_ -= amount_;
    }

    std::string getDescription() const override {
        return "Increment by " + std::to_string(amount_);
    }

private:
    int& counter_;
    int amount_;
};

// Test command that sets a value
class SetValueCommand : public Command {
public:
    SetValueCommand(int& value, int newValue)
        : value_(value), oldValue_(value), newValue_(newValue) {}

    CommandResult execute() override {
        value_ = newValue_;
        return CommandResult::Success;
    }

    void undo() override {
        value_ = oldValue_;
    }

    std::string getDescription() const override {
        return "Set value to " + std::to_string(newValue_);
    }

private:
    int& value_;
    int oldValue_;
    int newValue_;
};

// Test command that can fail
class FailingCommand : public Command {
public:
    CommandResult execute() override {
        return CommandResult::Failed;
    }

    void undo() override {}

    std::string getDescription() const override {
        return "Failing command";
    }
};

// Command tests
TEST(command_execute_undo) {
    int counter = 0;
    IncrementCommand cmd(counter, 5);

    cmd.execute();
    ASSERT_EQ(counter, 5);

    cmd.undo();
    ASSERT_EQ(counter, 0);
}

TEST(command_redo) {
    int counter = 0;
    IncrementCommand cmd(counter, 3);

    cmd.execute();
    ASSERT_EQ(counter, 3);

    cmd.undo();
    ASSERT_EQ(counter, 0);

    cmd.redo();
    ASSERT_EQ(counter, 3);
}

// CommandHistory tests
TEST(history_basic) {
    int counter = 0;
    CommandHistory history;

    history.execute(makeUnique<IncrementCommand>(counter, 10));
    ASSERT_EQ(counter, 10);
    ASSERT_TRUE(history.canUndo());
    ASSERT_TRUE(!history.canRedo());
}

TEST(history_undo) {
    int counter = 0;
    CommandHistory history;

    history.execute(makeUnique<IncrementCommand>(counter, 10));
    ASSERT_EQ(counter, 10);

    history.undo();
    ASSERT_EQ(counter, 0);
    ASSERT_TRUE(!history.canUndo());
    ASSERT_TRUE(history.canRedo());
}

TEST(history_redo) {
    int counter = 0;
    CommandHistory history;

    history.execute(makeUnique<IncrementCommand>(counter, 10));
    history.undo();
    ASSERT_EQ(counter, 0);

    history.redo();
    ASSERT_EQ(counter, 10);
    ASSERT_TRUE(history.canUndo());
    ASSERT_TRUE(!history.canRedo());
}

TEST(history_multiple_undo_redo) {
    int counter = 0;
    CommandHistory history;

    history.execute(makeUnique<IncrementCommand>(counter, 1));
    history.execute(makeUnique<IncrementCommand>(counter, 2));
    history.execute(makeUnique<IncrementCommand>(counter, 3));
    ASSERT_EQ(counter, 6);

    history.undo();  // 6 - 3 = 3
    ASSERT_EQ(counter, 3);

    history.undo();  // 3 - 2 = 1
    ASSERT_EQ(counter, 1);

    history.redo();  // 1 + 2 = 3
    ASSERT_EQ(counter, 3);

    history.redo();  // 3 + 3 = 6
    ASSERT_EQ(counter, 6);
}

TEST(history_undo_clears_redo) {
    int counter = 0;
    CommandHistory history;

    history.execute(makeUnique<IncrementCommand>(counter, 1));
    history.execute(makeUnique<IncrementCommand>(counter, 2));
    ASSERT_EQ(counter, 3);

    history.undo();  // Can redo now
    ASSERT_TRUE(history.canRedo());

    history.execute(makeUnique<IncrementCommand>(counter, 10));
    ASSERT_TRUE(!history.canRedo());  // Redo cleared
}

TEST(history_failed_command) {
    CommandHistory history;

    auto result = history.execute(makeUnique<FailingCommand>());
    ASSERT_EQ(result, CommandResult::Failed);
    ASSERT_TRUE(!history.canUndo());
}

TEST(history_dirty_flag) {
    int counter = 0;
    CommandHistory history;

    ASSERT_TRUE(!history.isDirty());

    history.execute(makeUnique<IncrementCommand>(counter, 1));
    ASSERT_TRUE(history.isDirty());

    history.markSaved();
    ASSERT_TRUE(!history.isDirty());

    history.execute(makeUnique<IncrementCommand>(counter, 1));
    ASSERT_TRUE(history.isDirty());
}

TEST(history_description) {
    int counter = 0;
    CommandHistory history;

    history.execute(makeUnique<IncrementCommand>(counter, 5));

    ASSERT_EQ(history.getUndoDescription(), "Increment by 5");
}

// MacroCommand tests
TEST(macro_basic) {
    int counter = 0;
    auto macro = makeUnique<MacroCommand>("Batch increment");

    macro->add(makeUnique<IncrementCommand>(counter, 1));
    macro->add(makeUnique<IncrementCommand>(counter, 2));
    macro->add(makeUnique<IncrementCommand>(counter, 3));

    macro->execute();
    ASSERT_EQ(counter, 6);

    macro->undo();
    ASSERT_EQ(counter, 0);
}

TEST(macro_partial_failure) {
    int counter = 0;
    auto macro = makeUnique<MacroCommand>("Batch with failure");

    macro->add(makeUnique<IncrementCommand>(counter, 5));
    macro->add(makeUnique<FailingCommand>());
    macro->add(makeUnique<IncrementCommand>(counter, 10));

    auto result = macro->execute();
    ASSERT_EQ(result, CommandResult::Failed);
    ASSERT_EQ(counter, 0);  // Should rollback first command
}

TEST(macro_with_history) {
    int counter = 0;
    CommandHistory history;

    auto macro = makeUnique<MacroCommand>("Batch increment");
    macro->add(makeUnique<IncrementCommand>(counter, 1));
    macro->add(makeUnique<IncrementCommand>(counter, 2));

    history.execute(std::move(macro));
    ASSERT_EQ(counter, 3);

    history.undo();
    ASSERT_EQ(counter, 0);  // Single undo undoes entire macro

    history.redo();
    ASSERT_EQ(counter, 3);
}

// Transaction tests
TEST(transaction_basic) {
    int counter = 0;
    CommandHistory history;

    {
        TransactionGuard guard(history, "Transaction");
        history.execute(makeUnique<IncrementCommand>(counter, 1));
        history.execute(makeUnique<IncrementCommand>(counter, 2));
    }  // Auto-commit

    ASSERT_EQ(counter, 3);
    ASSERT_EQ(history.getUndoCount(), 1u);  // Single undo entry

    history.undo();
    ASSERT_EQ(counter, 0);
}

// Lambda command tests
TEST(lambda_command) {
    int value = 0;

    auto cmd = makeUnique<LambdaCommand>(
        "Set to 42",
        [&value]() { value = 42; return CommandResult::Success; },
        [&value]() { value = 0; }
    );

    cmd->execute();
    ASSERT_EQ(value, 42);

    cmd->undo();
    ASSERT_EQ(value, 0);
}

// SimpleValueCommand tests
TEST(simple_value_command) {
    int value = 10;

    auto cmd = makeUnique<SimpleValueCommand<int>>(&value, 20, "Set to 20");

    cmd->execute();
    ASSERT_EQ(value, 20);

    cmd->undo();
    ASSERT_EQ(value, 10);

    cmd->redo();
    ASSERT_EQ(value, 20);
}

int main() {
    std::cout << "ESEngine Command System Unit Tests" << std::endl;
    std::cout << "====================================" << std::endl;

    // Command tests
    RUN_TEST(command_execute_undo);
    RUN_TEST(command_redo);

    // CommandHistory tests
    RUN_TEST(history_basic);
    RUN_TEST(history_undo);
    RUN_TEST(history_redo);
    RUN_TEST(history_multiple_undo_redo);
    RUN_TEST(history_undo_clears_redo);
    RUN_TEST(history_failed_command);
    RUN_TEST(history_dirty_flag);
    RUN_TEST(history_description);

    // MacroCommand tests
    RUN_TEST(macro_basic);
    RUN_TEST(macro_partial_failure);
    RUN_TEST(macro_with_history);

    // Transaction tests
    RUN_TEST(transaction_basic);

    // Lambda command tests
    RUN_TEST(lambda_command);

    // SimpleValueCommand tests
    RUN_TEST(simple_value_command);

    std::cout << "====================================" << std::endl;
    std::cout << "Results: " << passed << " passed, " << failed << " failed" << std::endl;

    return failed > 0 ? 1 : 0;
}
