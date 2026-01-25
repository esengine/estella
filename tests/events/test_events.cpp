/**
 * @file    test_events.cpp
 * @brief   Unit tests for the event system
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include <esengine/events/Events.hpp>
#include <iostream>
#include <cassert>

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

// Test events
struct TestEvent {
    int value;
};

struct AnotherEvent {
    std::string message;
};

// Signal Tests
TEST(signal_basic) {
    esengine::Signal<void(int)> signal;
    int received = 0;

    auto conn = esengine::sink(signal).connect([&received](int x) {
        received = x;
    });

    signal.publish(42);
    ASSERT_EQ(received, 42);
}

TEST(signal_multiple_subscribers) {
    esengine::Signal<void(int)> signal;
    int sum = 0;

    auto conn1 = esengine::sink(signal).connect([&sum](int x) {
        sum += x;
    });

    auto conn2 = esengine::sink(signal).connect([&sum](int x) {
        sum += x * 2;
    });

    signal.publish(10);
    ASSERT_EQ(sum, 30);  // 10 + 20
}

TEST(signal_disconnect) {
    esengine::Signal<void(int)> signal;
    int count = 0;

    auto conn = esengine::sink(signal).connect([&count](int) {
        count++;
    });

    signal.publish(1);
    ASSERT_EQ(count, 1);

    conn.disconnect();

    signal.publish(1);
    ASSERT_EQ(count, 1);  // No change after disconnect
}

TEST(signal_raii_disconnect) {
    esengine::Signal<void(int)> signal;
    int count = 0;

    {
        auto conn = esengine::sink(signal).connect([&count](int) {
            count++;
        });

        signal.publish(1);
        ASSERT_EQ(count, 1);
    }  // conn goes out of scope, auto-disconnect

    signal.publish(1);
    ASSERT_EQ(count, 1);  // No change after auto-disconnect
}

TEST(connection_holder) {
    esengine::Signal<void(int)> signal;
    int count = 0;

    esengine::ConnectionHolder holder;

    holder.add(esengine::sink(signal).connect([&count](int) {
        count++;
    }));

    holder.add(esengine::sink(signal).connect([&count](int) {
        count++;
    }));

    signal.publish(1);
    ASSERT_EQ(count, 2);

    holder.disconnectAll();

    signal.publish(1);
    ASSERT_EQ(count, 2);  // No change after disconnect
}

// Dispatcher Tests
TEST(dispatcher_trigger) {
    esengine::Dispatcher dispatcher;
    int received = 0;

    auto conn = dispatcher.sink<TestEvent>().connect([&received](const TestEvent& e) {
        received = e.value;
    });

    dispatcher.trigger(TestEvent{42});
    ASSERT_EQ(received, 42);
}

TEST(dispatcher_multiple_event_types) {
    esengine::Dispatcher dispatcher;
    int intValue = 0;
    std::string strValue;

    auto conn1 = dispatcher.sink<TestEvent>().connect([&intValue](const TestEvent& e) {
        intValue = e.value;
    });

    auto conn2 = dispatcher.sink<AnotherEvent>().connect([&strValue](const AnotherEvent& e) {
        strValue = e.message;
    });

    dispatcher.trigger(TestEvent{123});
    dispatcher.trigger(AnotherEvent{"hello"});

    ASSERT_EQ(intValue, 123);
    ASSERT_EQ(strValue, "hello");
}

TEST(dispatcher_queue) {
    esengine::Dispatcher dispatcher;
    int received = 0;

    auto conn = dispatcher.sink<TestEvent>().connect([&received](const TestEvent& e) {
        received = e.value;
    });

    dispatcher.enqueue(TestEvent{99});
    ASSERT_EQ(received, 0);  // Not yet processed

    dispatcher.update();
    ASSERT_EQ(received, 99);  // Now processed
}

TEST(dispatcher_queue_multiple) {
    esengine::Dispatcher dispatcher;
    std::vector<int> values;

    auto conn = dispatcher.sink<TestEvent>().connect([&values](const TestEvent& e) {
        values.push_back(e.value);
    });

    dispatcher.enqueue(TestEvent{1});
    dispatcher.enqueue(TestEvent{2});
    dispatcher.enqueue(TestEvent{3});

    ASSERT_TRUE(values.empty());

    dispatcher.update();

    ASSERT_EQ(values.size(), 3u);
    ASSERT_EQ(values[0], 1);
    ASSERT_EQ(values[1], 2);
    ASSERT_EQ(values[2], 3);
}

TEST(dispatcher_has_subscribers) {
    esengine::Dispatcher dispatcher;

    ASSERT_TRUE(!dispatcher.hasSubscribers<TestEvent>());

    {
        auto conn = dispatcher.sink<TestEvent>().connect([](const TestEvent&) {});
        ASSERT_TRUE(dispatcher.hasSubscribers<TestEvent>());
        conn.disconnect();
    }

    ASSERT_TRUE(!dispatcher.hasSubscribers<TestEvent>());
}

TEST(dispatcher_clear) {
    esengine::Dispatcher dispatcher;
    int count = 0;

    auto conn = dispatcher.sink<TestEvent>().connect([&count](const TestEvent&) {
        count++;
    });

    dispatcher.enqueue(TestEvent{1});
    dispatcher.enqueue(TestEvent{2});

    // Must disconnect before clear() to avoid dangling pointer in Connection
    conn.disconnect();

    dispatcher.clear();

    ASSERT_EQ(dispatcher.queueSize(), 0u);
}

int main() {
    std::cout << "ESEngine Events Unit Tests" << std::endl;
    std::cout << "===========================" << std::endl;

    // Signal tests
    RUN_TEST(signal_basic);
    RUN_TEST(signal_multiple_subscribers);
    RUN_TEST(signal_disconnect);
    RUN_TEST(signal_raii_disconnect);
    RUN_TEST(connection_holder);

    // Dispatcher tests
    RUN_TEST(dispatcher_trigger);
    RUN_TEST(dispatcher_multiple_event_types);
    RUN_TEST(dispatcher_queue);
    RUN_TEST(dispatcher_queue_multiple);
    RUN_TEST(dispatcher_has_subscribers);
    RUN_TEST(dispatcher_clear);

    std::cout << "===========================" << std::endl;
    std::cout << "Results: " << passed << " passed, " << failed << " failed" << std::endl;

    return failed > 0 ? 1 : 0;
}
