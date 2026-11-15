// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "ByteStream.hpp"

#include <CoreFoundation/CoreFoundation.h>
#include <Network/Network.h>
#include <dispatch/dispatch.h>

#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <mutex>
#include <vector>

#if __has_feature(objc_arc)
#  define ES_NW_RELEASE(x)
#  define ES_DISPATCH_RELEASE(x)
#else
#  define ES_NW_RELEASE(x) nw_release(x)
#  define ES_DISPATCH_RELEASE(x) dispatch_release(x)
#endif

namespace eshost {
namespace {

constexpr auto kDialTimeout = std::chrono::seconds(30);

struct Signal {
    std::mutex mutex;
    std::condition_variable changed;
    bool done = false;
    bool ok = false;
    std::string error;
    std::vector<uint8_t> bytes;
};

std::string describe(nw_error_t error) {
    if (!error) return "the connection was closed";
    std::string text;
    if (CFErrorRef cf = nw_error_copy_cf_error(error)) {
        if (CFStringRef said = CFErrorCopyDescription(cf)) {
            char buffer[512];
            if (CFStringGetCString(said, buffer, sizeof buffer, kCFStringEncodingUTF8)) text = buffer;
            CFRelease(said);
        }
        CFRelease(cf);
    }
    if (text.empty()) text = "network error " + std::to_string(nw_error_get_error_code(error));
    return text;
}

class AppleTlsStream final : public ByteStream {
public:
    AppleTlsStream(nw_connection_t connection, dispatch_queue_t queue) : connection_(connection), queue_(queue) {}

    ~AppleTlsStream() override {
        nw_connection_cancel(connection_);
        ES_NW_RELEASE(connection_);
        ES_DISPATCH_RELEASE(queue_);
    }

    bool sendAll(const uint8_t* data, size_t len) override {
        if (len == 0) return true;
        auto sent = std::make_shared<Signal>();
        dispatch_data_t content = dispatch_data_create(data, len, queue_, DISPATCH_DATA_DESTRUCTOR_DEFAULT);
        nw_connection_send(connection_, content, NW_CONNECTION_DEFAULT_MESSAGE_CONTEXT, true, ^(nw_error_t error) {
            std::lock_guard<std::mutex> lk(sent->mutex);
            sent->ok = error == nullptr;
            sent->done = true;
            sent->changed.notify_all();
        });
        ES_DISPATCH_RELEASE(content);
        std::unique_lock<std::mutex> lk(sent->mutex);
        sent->changed.wait(lk, [&] { return sent->done; });
        return sent->ok;
    }

    bool recvAll(uint8_t* data, size_t len) override {
        while (len > 0) {
            if (at_ == pending_.size() && !fill()) return false;
            const size_t n = std::min(len, pending_.size() - at_);
            std::memcpy(data, pending_.data() + at_, n);
            at_ += n;
            data += n;
            len -= n;
        }
        return true;
    }

    void shutdown() override { nw_connection_cancel(connection_); }

private:
    bool fill() {
        auto got = std::make_shared<Signal>();
        nw_connection_receive(connection_, 1, 65536,
            ^(dispatch_data_t content, nw_content_context_t, bool, nw_error_t) {
                if (content) {
                    dispatch_data_apply(content, ^bool(dispatch_data_t, size_t, const void* buffer, size_t size) {
                        const auto* bytes = static_cast<const uint8_t*>(buffer);
                        got->bytes.insert(got->bytes.end(), bytes, bytes + size);
                        return true;
                    });
                }
                std::lock_guard<std::mutex> lk(got->mutex);
                got->ok = !got->bytes.empty();
                got->done = true;
                got->changed.notify_all();
            });
        std::unique_lock<std::mutex> lk(got->mutex);
        got->changed.wait(lk, [&] { return got->done; });
        if (!got->ok) return false;
        pending_ = std::move(got->bytes);
        at_ = 0;
        return true;
    }

    nw_connection_t connection_;
    dispatch_queue_t queue_;
    std::vector<uint8_t> pending_;
    size_t at_ = 0;
};

}  // namespace

std::unique_ptr<ByteStream> dialTls(const std::string& host, const std::string& port, std::string& why) {
    nw_endpoint_t endpoint = nw_endpoint_create_host(host.c_str(), port.c_str());
    nw_parameters_t parameters = nw_parameters_create_secure_tcp(
        NW_PARAMETERS_DEFAULT_CONFIGURATION, NW_PARAMETERS_DEFAULT_CONFIGURATION);
    nw_connection_t connection = nw_connection_create(endpoint, parameters);
    ES_NW_RELEASE(endpoint);
    ES_NW_RELEASE(parameters);
    dispatch_queue_t queue = dispatch_queue_create("estella.wss", DISPATCH_QUEUE_SERIAL);
    nw_connection_set_queue(connection, queue);

    auto dialed = std::make_shared<Signal>();
    nw_connection_set_state_changed_handler(connection, ^(nw_connection_state_t state, nw_error_t error) {
        std::lock_guard<std::mutex> lk(dialed->mutex);
        if (dialed->done) return;
        if (state == nw_connection_state_ready) {
            dialed->ok = true;
        } else if (state == nw_connection_state_failed || state == nw_connection_state_cancelled
            || (state == nw_connection_state_waiting && error)) {
            dialed->error = describe(error);
        } else {
            return;
        }
        dialed->done = true;
        dialed->changed.notify_all();
    });
    nw_connection_start(connection);

    auto stream = std::make_unique<AppleTlsStream>(connection, queue);
    std::unique_lock<std::mutex> lk(dialed->mutex);
    const bool settled = dialed->changed.wait_for(lk, kDialTimeout, [&] { return dialed->done; });
    if (settled && dialed->ok) return stream;
    why = host + ":" + port + ": " + (settled ? dialed->error : std::string("timed out"));
    dialed->done = true;
    return nullptr;
}

}  // namespace eshost
