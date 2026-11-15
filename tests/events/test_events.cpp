#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>

#include <esengine/events/Events.hpp>

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
