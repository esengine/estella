// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "net/WsClient.hpp"

#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <queue>
#include <string>
#include <vector>

using eshost::WsEvent;

namespace {

std::string escaped(const std::string& text) {
    std::string out;
    for (const char ch : text) {
        if (ch == '"' || ch == '\\') { out += '\\'; out += ch; }
        else if (static_cast<unsigned char>(ch) < 0x20) out += ' ';
        else out += ch;
    }
    return out;
}

}  // namespace

int main(int argc, char** argv) {
    if (argc < 2) {
        std::fprintf(stderr, "usage: ws_probe <ws://|wss:// url> [seconds]\n");
        return 2;
    }
    const std::string url = argv[1];
    const int seconds = argc > 2 ? std::atoi(argv[2]) : 20;

    std::mutex mutex;
    std::condition_variable arrived;
    std::queue<WsEvent> events;
    const int id = eshost::wsOpen(url, [&](WsEvent e) {
        std::lock_guard<std::mutex> lk(mutex);
        events.push(std::move(e));
        arrived.notify_all();
    });

    const std::string text = "estella wss probe";
    std::vector<uint8_t> binary(70000);
    for (size_t i = 0; i < binary.size(); ++i) binary[i] = static_cast<uint8_t>((i * 31 + 7) & 0xFF);

    bool opened = false, textBack = false, binaryBack = false, closed = false;
    int closeCode = 0;
    std::string error;
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(seconds);
    while (!closed) {
        WsEvent e;
        {
            std::unique_lock<std::mutex> lk(mutex);
            if (!arrived.wait_until(lk, deadline, [&] { return !events.empty(); })) break;
            e = std::move(events.front());
            events.pop();
        }
        switch (e.kind) {
            case WsEvent::Kind::Open:
                opened = true;
                eshost::wsSend(id, reinterpret_cast<const uint8_t*>(text.data()), text.size(), true);
                break;
            case WsEvent::Kind::Text:
                textBack = std::string(e.data.begin(), e.data.end()) == text;
                eshost::wsSend(id, binary.data(), binary.size(), false);
                break;
            case WsEvent::Kind::Binary:
                binaryBack = e.data == binary;
                eshost::wsClose(id, 1000, "done");
                break;
            case WsEvent::Kind::Error:
                error = e.reason;
                break;
            case WsEvent::Kind::Close:
                closed = true;
                closeCode = e.code;
                break;
        }
    }
    std::printf("{\"opened\":%s,\"text\":%s,\"binary\":%s,\"closed\":%s,\"code\":%d,\"error\":\"%s\"}\n",
        opened ? "true" : "false", textBack ? "true" : "false", binaryBack ? "true" : "false",
        closed ? "true" : "false", closeCode, escaped(error).c_str());
    return 0;
}
