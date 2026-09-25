// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    WsClient.cpp
 * @brief   RFC 6455 client framing over blocking TCP sockets (POSIX and Winsock).
 */
#include "WsClient.hpp"

#include <algorithm>
#include <atomic>
#include <cstring>
#include <memory>
#include <mutex>
#include <random>
#include <thread>
#include <unordered_map>

#ifdef _WIN32
#  ifndef WIN32_LEAN_AND_MEAN
#    define WIN32_LEAN_AND_MEAN
#  endif
#  include <winsock2.h>
#  include <ws2tcpip.h>
using SocketHandle = SOCKET;
constexpr SocketHandle kNoSocket = INVALID_SOCKET;
#else
#  include <netdb.h>
#  include <netinet/in.h>
#  include <netinet/tcp.h>
#  include <sys/socket.h>
#  include <sys/types.h>
#  include <unistd.h>
using SocketHandle = int;
constexpr SocketHandle kNoSocket = -1;
#endif

namespace eshost {
namespace {

#ifdef MSG_NOSIGNAL
constexpr int kSendFlags = MSG_NOSIGNAL;
#else
constexpr int kSendFlags = 0;
#endif

void closeSocket(SocketHandle s) {
#ifdef _WIN32
    closesocket(s);
#else
    ::close(s);
#endif
}

void shutdownSocket(SocketHandle s) {
#ifdef _WIN32
    shutdown(s, SD_BOTH);
#else
    shutdown(s, SHUT_RDWR);
#endif
}

void ensureSockets() {
#ifdef _WIN32
    static std::once_flag once;
    std::call_once(once, [] { WSADATA d; WSAStartup(MAKEWORD(2, 2), &d); });
#endif
}

// — SHA-1 and base64, for the handshake's Sec-WebSocket-Accept —

uint32_t rol(uint32_t v, int n) { return (v << n) | (v >> (32 - n)); }

void sha1(const std::string& in, uint8_t out[20]) {
    uint32_t h[5] = { 0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0 };
    std::string msg = in;
    const uint64_t bits = static_cast<uint64_t>(in.size()) * 8;
    msg += static_cast<char>(0x80);
    while (msg.size() % 64 != 56) msg += '\0';
    for (int i = 7; i >= 0; --i) msg += static_cast<char>((bits >> (i * 8)) & 0xFF);
    for (size_t chunk = 0; chunk < msg.size(); chunk += 64) {
        uint32_t w[80];
        for (int i = 0; i < 16; ++i) {
            const auto* p = reinterpret_cast<const uint8_t*>(msg.data() + chunk + i * 4);
            w[i] = (uint32_t(p[0]) << 24) | (uint32_t(p[1]) << 16) | (uint32_t(p[2]) << 8) | p[3];
        }
        for (int i = 16; i < 80; ++i) w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
        uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4];
        for (int i = 0; i < 80; ++i) {
            uint32_t f, k;
            if (i < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
            else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
            else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
            else { f = b ^ c ^ d; k = 0xCA62C1D6; }
            const uint32_t t = rol(a, 5) + f + e + k + w[i];
            e = d; d = c; c = rol(b, 30); b = a; a = t;
        }
        h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e;
    }
    for (int i = 0; i < 5; ++i) {
        out[i * 4] = uint8_t(h[i] >> 24); out[i * 4 + 1] = uint8_t(h[i] >> 16);
        out[i * 4 + 2] = uint8_t(h[i] >> 8); out[i * 4 + 3] = uint8_t(h[i]);
    }
}

std::string base64(const uint8_t* data, size_t len) {
    static const char* T = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    for (size_t i = 0; i < len; i += 3) {
        const uint32_t n = (uint32_t(data[i]) << 16) | (i + 1 < len ? uint32_t(data[i + 1]) << 8 : 0)
            | (i + 2 < len ? data[i + 2] : 0);
        out += T[(n >> 18) & 63];
        out += T[(n >> 12) & 63];
        out += i + 1 < len ? T[(n >> 6) & 63] : '=';
        out += i + 2 < len ? T[n & 63] : '=';
    }
    return out;
}

// — One connection —

struct Conn {
    int id = 0;
    SocketHandle sock = kNoSocket;
    WsSink sink;
    std::mutex sendMutex;
    std::atomic<bool> open{false};
    std::atomic<bool> closeSent{false};
    std::mt19937 rng{std::random_device{}()};
};

std::mutex g_connsMutex;
std::unordered_map<int, std::shared_ptr<Conn>> g_conns;
std::atomic<int> g_nextId{1};

std::shared_ptr<Conn> connOf(int id) {
    std::lock_guard<std::mutex> lk(g_connsMutex);
    auto it = g_conns.find(id);
    return it == g_conns.end() ? nullptr : it->second;
}

bool sendAll(SocketHandle s, const uint8_t* p, size_t n) {
    while (n > 0) {
        const auto sent = ::send(s, reinterpret_cast<const char*>(p), static_cast<int>(n), kSendFlags);
        if (sent <= 0) return false;
        p += sent;
        n -= static_cast<size_t>(sent);
    }
    return true;
}

bool recvAll(SocketHandle s, uint8_t* p, size_t n) {
    while (n > 0) {
        const auto got = ::recv(s, reinterpret_cast<char*>(p), static_cast<int>(n), 0);
        if (got <= 0) return false;
        p += got;
        n -= static_cast<size_t>(got);
    }
    return true;
}

/** A client frame: always masked, as RFC 6455 requires of a client. */
bool sendFrame(Conn& c, uint8_t opcode, const uint8_t* data, size_t len) {
    std::vector<uint8_t> f;
    f.reserve(len + 14);
    f.push_back(uint8_t(0x80 | opcode));
    if (len < 126) {
        f.push_back(uint8_t(0x80 | len));
    } else if (len <= 0xFFFF) {
        f.push_back(0x80 | 126);
        f.push_back(uint8_t(len >> 8)); f.push_back(uint8_t(len));
    } else {
        f.push_back(0x80 | 127);
        for (int i = 7; i >= 0; --i) f.push_back(uint8_t(uint64_t(len) >> (i * 8)));
    }
    std::lock_guard<std::mutex> lk(c.sendMutex);
    uint8_t mask[4];
    for (auto& m : mask) m = uint8_t(c.rng());
    f.insert(f.end(), mask, mask + 4);
    const size_t at = f.size();
    f.insert(f.end(), data, data + len);
    for (size_t i = 0; i < len; ++i) f[at + i] ^= mask[i % 4];
    return sendAll(c.sock, f.data(), f.size());
}

struct Url { std::string host, port, path; };

bool parseWsUrl(const std::string& url, Url& out) {
    const std::string scheme = "ws://";
    if (url.compare(0, scheme.size(), scheme) != 0) return false;
    const std::string rest = url.substr(scheme.size());
    const size_t slash = rest.find('/');
    const std::string authority = rest.substr(0, slash);
    out.path = slash == std::string::npos ? "/" : rest.substr(slash);
    const size_t colon = authority.rfind(':');
    out.host = colon == std::string::npos ? authority : authority.substr(0, colon);
    out.port = colon == std::string::npos ? "80" : authority.substr(colon + 1);
    return !out.host.empty();
}

SocketHandle dial(const Url& u) {
    addrinfo hints{};
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;
    addrinfo* res = nullptr;
    if (getaddrinfo(u.host.c_str(), u.port.c_str(), &hints, &res) != 0) return kNoSocket;
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

std::string lower(std::string s) {
    for (char& ch : s) ch = static_cast<char>(tolower(static_cast<unsigned char>(ch)));
    return s;
}

/** The opening handshake; an error message on failure, empty on success. */
std::string handshake(Conn& c, const Url& u) {
    uint8_t nonce[16];
    for (auto& b : nonce) b = uint8_t(c.rng());
    const std::string key = base64(nonce, sizeof nonce);
    const std::string req = "GET " + u.path + " HTTP/1.1\r\nHost: " + u.host + ":" + u.port
        + "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: " + key
        + "\r\nSec-WebSocket-Version: 13\r\n\r\n";
    if (!sendAll(c.sock, reinterpret_cast<const uint8_t*>(req.data()), req.size())) return "handshake send failed";
    std::string head;
    char ch;
    while (head.size() < 8192 && head.find("\r\n\r\n") == std::string::npos) {
        if (::recv(c.sock, &ch, 1, 0) <= 0) return "the server closed during the handshake";
        head += ch;
    }
    if (head.compare(0, 12, "HTTP/1.1 101") != 0) return "refused: " + head.substr(0, head.find("\r\n"));
    const std::string lo = lower(head);
    const size_t at = lo.find("\r\nsec-websocket-accept:");
    if (at == std::string::npos) return "no Sec-WebSocket-Accept in the reply";
    size_t v = at + 23;
    while (v < head.size() && head[v] == ' ') ++v;
    const std::string accept = head.substr(v, head.find("\r\n", v) - v);
    if (accept != wsAcceptFor(key)) return "Sec-WebSocket-Accept does not answer the key";
    return {};
}

void emit(Conn& c, WsEvent::Kind kind, std::vector<uint8_t> data = {}, int code = 0, std::string reason = {}) {
    WsEvent e;
    e.id = c.id;
    e.kind = kind;
    e.data = std::move(data);
    e.code = code;
    e.reason = std::move(reason);
    c.sink(std::move(e));
}

void run(std::shared_ptr<Conn> c, std::string url) {
    auto finish = [&](int code, std::string reason) {
        c->open = false;
        {
            std::lock_guard<std::mutex> lk(c->sendMutex);
            if (c->sock != kNoSocket) { closeSocket(c->sock); c->sock = kNoSocket; }
        }
        emit(*c, WsEvent::Kind::Close, {}, code, std::move(reason));
        std::lock_guard<std::mutex> lk(g_connsMutex);
        g_conns.erase(c->id);
    };
    Url u;
    if (!parseWsUrl(url, u)) {
        emit(*c, WsEvent::Kind::Error, {}, 0, "only ws:// URLs are supported: " + url);
        return finish(1006, "bad url");
    }
    c->sock = dial(u);
    if (c->sock == kNoSocket) {
        emit(*c, WsEvent::Kind::Error, {}, 0, "could not connect to " + u.host + ":" + u.port);
        return finish(1006, "connect failed");
    }
    if (std::string why = handshake(*c, u); !why.empty()) {
        emit(*c, WsEvent::Kind::Error, {}, 0, why);
        return finish(1006, why);
    }
    c->open = true;
    emit(*c, WsEvent::Kind::Open);

    std::vector<uint8_t> message;
    uint8_t messageOp = 0;
    for (;;) {
        uint8_t hdr[2];
        if (!recvAll(c->sock, hdr, 2)) return finish(1006, "connection lost");
        const bool fin = hdr[0] & 0x80;
        const uint8_t op = hdr[0] & 0x0F;
        uint64_t len = hdr[1] & 0x7F;
        if (len == 126) {
            uint8_t b[2];
            if (!recvAll(c->sock, b, 2)) return finish(1006, "connection lost");
            len = (uint64_t(b[0]) << 8) | b[1];
        } else if (len == 127) {
            uint8_t b[8];
            if (!recvAll(c->sock, b, 8)) return finish(1006, "connection lost");
            len = 0;
            for (uint8_t x : b) len = (len << 8) | x;
        }
        uint8_t mask[4] = {0, 0, 0, 0};
        const bool masked = hdr[1] & 0x80;
        if (masked && !recvAll(c->sock, mask, 4)) return finish(1006, "connection lost");
        std::vector<uint8_t> payload(static_cast<size_t>(len));
        if (len > 0 && !recvAll(c->sock, payload.data(), payload.size())) return finish(1006, "connection lost");
        if (masked) for (size_t i = 0; i < payload.size(); ++i) payload[i] ^= mask[i % 4];

        if (op == 0x8) {
            const int code = payload.size() >= 2 ? (payload[0] << 8) | payload[1] : 1005;
            std::string reason = payload.size() > 2 ? std::string(payload.begin() + 2, payload.end()) : "";
            if (!c->closeSent.exchange(true)) sendFrame(*c, 0x8, payload.data(), std::min<size_t>(payload.size(), 2));
            return finish(code, std::move(reason));
        }
        if (op == 0x9) { sendFrame(*c, 0xA, payload.data(), payload.size()); continue; }
        if (op == 0xA) continue;
        if (op == 0x1 || op == 0x2) { message = std::move(payload); messageOp = op; }
        else if (op == 0x0) message.insert(message.end(), payload.begin(), payload.end());
        else continue;
        if (fin) {
            emit(*c, messageOp == 0x1 ? WsEvent::Kind::Text : WsEvent::Kind::Binary, std::move(message));
            message.clear();
        }
    }
}

}  // namespace

std::string wsAcceptFor(const std::string& key) {
    uint8_t digest[20];
    sha1(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11", digest);
    return base64(digest, sizeof digest);
}

int wsOpen(const std::string& url, WsSink sink) {
    ensureSockets();
    auto c = std::make_shared<Conn>();
    c->id = g_nextId++;
    c->sink = std::move(sink);
    {
        std::lock_guard<std::mutex> lk(g_connsMutex);
        g_conns[c->id] = c;
    }
    std::thread(run, c, url).detach();
    return c->id;
}

bool wsSend(int id, const uint8_t* data, size_t len, bool text) {
    auto c = connOf(id);
    if (!c || !c->open || c->closeSent) return false;
    return sendFrame(*c, text ? 0x1 : 0x2, data, len);
}

void wsClose(int id, int code, const std::string& reason) {
    auto c = connOf(id);
    if (!c) return;
    if (c->open && !c->closeSent.exchange(true)) {
        std::vector<uint8_t> body = { uint8_t(code >> 8), uint8_t(code) };
        body.insert(body.end(), reason.begin(), reason.end());
        sendFrame(*c, 0x8, body.data(), body.size());
    }
    // The reader thread finishes on the server's close reply, or here if none comes.
    std::lock_guard<std::mutex> lk(c->sendMutex);
    if (c->sock != kNoSocket) shutdownSocket(c->sock);
}

}  // namespace eshost
