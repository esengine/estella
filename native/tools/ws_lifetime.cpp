// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include "doctest.h"
#include "net/ByteStream.hpp"
#include "net/WsClient.hpp"

#include <atomic>
#include <chrono>
#include <future>
#include <memory>

namespace {
std::atomic<bool> retired{false};

// The peer accepts the handshake request, then closes the connection.
class ClosingPeer final : public eshost::ByteStream {
public:
    ~ClosingPeer() override { retired = true; }
    bool sendAll(const uint8_t*, size_t) override { return true; }
    bool recvAll(uint8_t*, size_t) override { return false; }
    void shutdown() override {}
};
}  // namespace

namespace eshost {
std::unique_ptr<ByteStream> dialTls(const std::string&, const std::string&, std::string&) {
    return std::make_unique<ClosingPeer>();
}
}  // namespace eshost

TEST_CASE("the final socket event arrives after the worker releases its transport") {
    retired = false;
    auto result = std::make_shared<std::promise<bool>>();
    auto done = result->get_future();
    eshost::wsOpen("wss://localhost/", [result](eshost::WsEvent event) {
        if (event.kind == eshost::WsEvent::Kind::Close) result->set_value_at_thread_exit(retired.load());
    });
    REQUIRE(done.wait_for(std::chrono::seconds(5)) == std::future_status::ready);
    CHECK(done.get());
}
