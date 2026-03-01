#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>

#include <esengine/events/Events.hpp>

struct TestEvent {
    int value;
};

struct AnotherEvent {
    std::string message;
};

TEST_CASE("signal_basic") {
    esengine::Signal<void(int)> signal;
    int received = 0;

    auto conn = esengine::sink(signal).connect([&received](int x) {
        received = x;
    });

    signal.publish(42);
    CHECK_EQ(received, 42);
}

TEST_CASE("signal_multiple_subscribers") {
    esengine::Signal<void(int)> signal;
    int sum = 0;

    auto conn1 = esengine::sink(signal).connect([&sum](int x) {
        sum += x;
    });

    auto conn2 = esengine::sink(signal).connect([&sum](int x) {
        sum += x * 2;
    });

    signal.publish(10);
    CHECK_EQ(sum, 30);
}

TEST_CASE("signal_disconnect") {
    esengine::Signal<void(int)> signal;
    int count = 0;

    auto conn = esengine::sink(signal).connect([&count](int) {
        count++;
    });

    signal.publish(1);
    CHECK_EQ(count, 1);

    conn.disconnect();

    signal.publish(1);
    CHECK_EQ(count, 1);
}

TEST_CASE("signal_raii_disconnect") {
    esengine::Signal<void(int)> signal;
    int count = 0;

    {
        auto conn = esengine::sink(signal).connect([&count](int) {
            count++;
        });

        signal.publish(1);
        CHECK_EQ(count, 1);
    }

    signal.publish(1);
    CHECK_EQ(count, 1);
}

TEST_CASE("connection_holder") {
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
    CHECK_EQ(count, 2);

    holder.disconnectAll();

    signal.publish(1);
    CHECK_EQ(count, 2);
}

TEST_CASE("dispatcher_trigger") {
    esengine::Dispatcher dispatcher;
    int received = 0;

    auto conn = dispatcher.sink<TestEvent>().connect([&received](const TestEvent& e) {
        received = e.value;
    });

    dispatcher.trigger(TestEvent{42});
    CHECK_EQ(received, 42);
}

TEST_CASE("dispatcher_multiple_event_types") {
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

    CHECK_EQ(intValue, 123);
    CHECK_EQ(strValue, "hello");
}

TEST_CASE("dispatcher_queue") {
    esengine::Dispatcher dispatcher;
    int received = 0;

    auto conn = dispatcher.sink<TestEvent>().connect([&received](const TestEvent& e) {
        received = e.value;
    });

    dispatcher.enqueue(TestEvent{99});
    CHECK_EQ(received, 0);

    dispatcher.update();
    CHECK_EQ(received, 99);
}

TEST_CASE("dispatcher_queue_multiple") {
    esengine::Dispatcher dispatcher;
    std::vector<int> values;

    auto conn = dispatcher.sink<TestEvent>().connect([&values](const TestEvent& e) {
        values.push_back(e.value);
    });

    dispatcher.enqueue(TestEvent{1});
    dispatcher.enqueue(TestEvent{2});
    dispatcher.enqueue(TestEvent{3});

    CHECK(values.empty());

    dispatcher.update();

    CHECK_EQ(values.size(), 3u);
    CHECK_EQ(values[0], 1);
    CHECK_EQ(values[1], 2);
    CHECK_EQ(values[2], 3);
}

TEST_CASE("dispatcher_has_subscribers") {
    esengine::Dispatcher dispatcher;

    CHECK(!dispatcher.hasSubscribers<TestEvent>());

    {
        auto conn = dispatcher.sink<TestEvent>().connect([](const TestEvent&) {});
        CHECK(dispatcher.hasSubscribers<TestEvent>());
        conn.disconnect();
    }

    CHECK(!dispatcher.hasSubscribers<TestEvent>());
}

TEST_CASE("dispatcher_clear") {
    esengine::Dispatcher dispatcher;
    int count = 0;

    auto conn = dispatcher.sink<TestEvent>().connect([&count](const TestEvent&) {
        count++;
    });

    dispatcher.enqueue(TestEvent{1});
    dispatcher.enqueue(TestEvent{2});

    conn.disconnect();

    dispatcher.clear();

    CHECK_EQ(dispatcher.queueSize(), 0u);
}
