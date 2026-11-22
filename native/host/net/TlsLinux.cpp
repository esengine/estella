// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "ByteStream.hpp"
#include "CurlInit.hpp"

#include <curl/curl.h>
#include <poll.h>
#include <sys/socket.h>

#include <atomic>
#include <cerrno>
#include <mutex>

namespace eshost {

void curlInitOnce() {
    static std::once_flag once;
    std::call_once(once, [] { curl_global_init(CURL_GLOBAL_DEFAULT); });
}

namespace {

class CurlTlsStream final : public ByteStream {
public:
    CurlTlsStream(CURL* curl, curl_socket_t socket) : curl_(curl), socket_(socket) {}

    ~CurlTlsStream() override { curl_easy_cleanup(curl_); }

    bool sendAll(const uint8_t* data, size_t len) override {
        while (len > 0) {
            size_t sent = 0;
            CURLcode code;
            {
                std::lock_guard<std::mutex> lk(mutex_);
                code = curl_easy_send(curl_, data, len, &sent);
            }
            if (code == CURLE_OK) {
                data += sent;
                len -= sent;
            } else if (code != CURLE_AGAIN || !ready(POLLOUT)) {
                return false;
            }
        }
        return true;
    }

    bool recvAll(uint8_t* data, size_t len) override {
        while (len > 0) {
            size_t got = 0;
            CURLcode code;
            {
                std::lock_guard<std::mutex> lk(mutex_);
                code = curl_easy_recv(curl_, data, len, &got);
            }
            if (code == CURLE_OK) {
                if (got == 0) return false;
                data += got;
                len -= got;
            } else if (code != CURLE_AGAIN || !ready(POLLIN)) {
                return false;
            }
        }
        return true;
    }

    void shutdown() override {
        down_ = true;
        ::shutdown(socket_, SHUT_RDWR);
    }

private:
    bool ready(short events) {
        while (!down_) {
            pollfd waiting{socket_, events, 0};
            const int n = ::poll(&waiting, 1, 250);
            if (n > 0) return true;
            if (n < 0 && errno != EINTR) return false;
        }
        return false;
    }

    CURL* curl_;
    curl_socket_t socket_;
    std::mutex mutex_;
    std::atomic<bool> down_{false};
};

}  // namespace

std::unique_ptr<ByteStream> dialTls(const std::string& host, const std::string& port, std::string& why) {
    curlInitOnce();
    CURL* curl = curl_easy_init();
    if (!curl) {
        why = "curl_easy_init failed";
        return nullptr;
    }
    char said[CURL_ERROR_SIZE] = {0};
    const std::string url = "https://" + host + ":" + port + "/";
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_CONNECT_ONLY, 1L);
    curl_easy_setopt(curl, CURLOPT_HTTP_VERSION, static_cast<long>(CURL_HTTP_VERSION_1_1));
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 30L);
    curl_easy_setopt(curl, CURLOPT_ERRORBUFFER, said);
    const CURLcode code = curl_easy_perform(curl);
    curl_socket_t socket = CURL_SOCKET_BAD;
    if (code == CURLE_OK) curl_easy_getinfo(curl, CURLINFO_ACTIVESOCKET, &socket);
    if (code != CURLE_OK || socket == CURL_SOCKET_BAD) {
        why = host + ":" + port + ": " + (said[0] ? said : curl_easy_strerror(code));
        curl_easy_cleanup(curl);
        return nullptr;
    }
    // The stream keeps the easy handle beyond this handshake's diagnostic buffer.
    curl_easy_setopt(curl, CURLOPT_ERRORBUFFER, static_cast<char*>(nullptr));
    return std::make_unique<CurlTlsStream>(curl, socket);
}

}  // namespace eshost
