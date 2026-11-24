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

TEST_CASE("an observer removed in the dispatch that registered it stays disconnected") {
    esengine::Signal<void()> notify;
    esengine::Signal<int()> query;
    int calls = 0;
    auto listener = esengine::sink(notify).connect([&] {
        auto transient = esengine::sink(notify).connect([&] { ++calls; });
    });
    auto responder = esengine::sink(query).connect([&] {
        auto transient = esengine::sink(query).connect([] { return 2; });
        return 1;
    });

    for (int round = 0; round < 2; ++round) {
        notify.publish();
        const auto answers = query.publish();
        CHECK(calls == 0);
        CHECK(notify.size() == 1);
        REQUIRE(answers.size() == 1);
        CHECK(answers.front() == 1);
        CHECK(query.size() == 1);
    }
}

TEST_CASE("nested queries see additions only after the outer query returns") {
    esengine::Signal<int()> query;
    auto subscribers = esengine::sink(query);
    esengine::Connection later;
    bool outer = true;
    auto responder = subscribers.connect([&] {
        if (outer) {
            outer = false;
            later = subscribers.connect([] { return 9; });
            CHECK(query.publishFirst(0) == 4);
            CHECK(query.publish().size() == 1);
            CHECK(query.size() == 1);
        }
        return 4;
    });

    CHECK(query.publishFirst(0) == 4);
    auto answers = query.publish();
    std::sort(answers.begin(), answers.end());
    REQUIRE(answers.size() == 2);
    CHECK(answers.front() == 4);
    CHECK(answers.back() == 9);
    later.disconnect();
    responder.disconnect();
    CHECK(query.publishFirst(12) == 12);
}

TEST_CASE("a sink and its connections follow the listeners through a move") {
    esengine::Signal<void()> source, destination;
    auto subscriptions = esengine::sink(source);
    auto displaced = esengine::sink(destination);
    int calls = 0;
    auto observer = subscriptions.connect([&] { ++calls; });
    auto previous = displaced.connect([&] { calls += 100; });
    destination = std::move(source);
    destination.publish();
    CHECK(calls == 1);
    observer.disconnect();
    auto retained = subscriptions.connect([&] { calls += 2; });
    auto expired = displaced.connect([&] { calls += 100; });
    CHECK_FALSE(expired.isConnected());
    source.publish();
    destination.publish();
    CHECK(calls == 3);
    auto fresh = esengine::sink(source).connect([&] { calls += 5; });
    source.publish();
    CHECK(calls == 8);
}

TEST_CASE("notification and query sinks accept const members by pointer and reference") {
    struct Handler {
        int& last;
        int receive(int value) const { return last = value; }
    };
    int last = 0;
    const Handler handler{last};
    esengine::Signal<void(int)> event;
    auto notify = esengine::sink(event).connect<&Handler::receive>(handler);
    event.publish(2);
    CHECK(last == 2);
    esengine::Signal<int(int)> query;
    auto result = esengine::sink(query).connect<&Handler::receive>(&handler);
    CHECK(query.publishFirst(0, 6) == 6);
    CHECK(last == 6);
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
