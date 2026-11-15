// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include <cstddef>
#include <cstdint>
#include <mutex>
#include <string>

#ifdef _WIN32
#  ifndef WIN32_LEAN_AND_MEAN
#    define WIN32_LEAN_AND_MEAN
#  endif
#  include <winsock2.h>
#  include <ws2tcpip.h>
#else
#  include <netdb.h>
#  include <netinet/in.h>
#  include <netinet/tcp.h>
#  include <sys/socket.h>
#  include <sys/types.h>
#  include <unistd.h>
#endif

namespace eshost {

#ifdef _WIN32
using SocketHandle = SOCKET;
inline constexpr SocketHandle kNoSocket = INVALID_SOCKET;
#else
using SocketHandle = int;
inline constexpr SocketHandle kNoSocket = -1;
#endif

#ifdef MSG_NOSIGNAL
inline constexpr int kSendFlags = MSG_NOSIGNAL;
#else
inline constexpr int kSendFlags = 0;
#endif

inline void closeSocket(SocketHandle s) {
#ifdef _WIN32
    closesocket(s);
#else
    ::close(s);
#endif
}

inline void shutdownSocket(SocketHandle s) {
#ifdef _WIN32
    shutdown(s, SD_BOTH);
#else
    shutdown(s, SHUT_RDWR);
#endif
}

inline void ensureSockets() {
#ifdef _WIN32
    static std::once_flag once;
    std::call_once(once, [] { WSADATA d; WSAStartup(MAKEWORD(2, 2), &d); });
#endif
}

inline bool sendAllSocket(SocketHandle s, const uint8_t* p, size_t n) {
    while (n > 0) {
        const auto sent = ::send(s, reinterpret_cast<const char*>(p), static_cast<int>(n), kSendFlags);
        if (sent <= 0) return false;
        p += sent;
        n -= static_cast<size_t>(sent);
    }
    return true;
}

inline bool recvAllSocket(SocketHandle s, uint8_t* p, size_t n) {
    while (n > 0) {
        const auto got = ::recv(s, reinterpret_cast<char*>(p), static_cast<int>(n), 0);
        if (got <= 0) return false;
        p += got;
        n -= static_cast<size_t>(got);
    }
    return true;
}

inline SocketHandle dialTcp(const std::string& host, const std::string& port) {
    ensureSockets();
    addrinfo hints{};
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;
    addrinfo* res = nullptr;
    if (getaddrinfo(host.c_str(), port.c_str(), &hints, &res) != 0) return kNoSocket;
    SocketHandle s = kNoSocket;
    for (addrinfo* a = res; a; a = a->ai_next) {
        s = ::socket(a->ai_family, a->ai_socktype, a->ai_protocol);
        if (s == kNoSocket) continue;
        if (::connect(s, a->ai_addr, static_cast<int>(a->ai_addrlen)) == 0) break;
        closeSocket(s);
        s = kNoSocket;
    }
    freeaddrinfo(res);
    if (s == kNoSocket) return s;
    int one = 1;
    setsockopt(s, IPPROTO_TCP, TCP_NODELAY, reinterpret_cast<const char*>(&one), sizeof one);
#ifdef SO_NOSIGPIPE
    setsockopt(s, SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof one);
#endif
    return s;
}

}  // namespace eshost
