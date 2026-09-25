// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    WsClient.hpp
 * @brief   A plain `ws://` WebSocket client over the OS's TCP sockets, one thread
 *          per connection, for a development build's line back to the editor.
 * @details Portable rather than per-platform like es_fetch: the editor is on the
 *          LAN and speaks `ws://`, so there is no TLS stack to borrow from the OS
 *          and one implementation serves every host. Events are handed out through
 *          a sink that may run on the connection's thread.
 */
#pragma once

#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace eshost {

struct WsEvent {
    enum class Kind { Open, Text, Binary, Error, Close };
    int id = 0;
    Kind kind = Kind::Open;
    std::vector<uint8_t> data;
    int code = 0;
    std::string reason;
};

using WsSink = std::function<void(WsEvent)>;

/** Dial @p url on a new thread; every event for the returned id goes to @p sink.
 *  A connection that cannot be made reports Error then Close(1006). */
int wsOpen(const std::string& url, WsSink sink);

/** Send one message; false once the connection is not open. */
bool wsSend(int id, const uint8_t* data, size_t len, bool text);

/** Start the closing handshake; the Close event follows from the connection. */
void wsClose(int id, int code, const std::string& reason);

/** @internal Exposed for tests: base64(SHA-1(key + RFC 6455 GUID)). */
std::string wsAcceptFor(const std::string& key);

}  // namespace eshost
