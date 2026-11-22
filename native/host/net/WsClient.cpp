// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "WsClient.hpp"
#include "ByteStream.hpp"
#include "Sockets.hpp"
#include "WsFrame.hpp"

#include <algorithm>
#include <atomic>
#include <cstring>
#include <memory>
#include <mutex>
#include <random>
#include <string>
#include <thread>
#include <unordered_map>

namespace eshost {
namespace {

class TcpStream final : public ByteStream {
public:
    explicit TcpStream(SocketHandle sock) : sock_(sock) {}
    ~TcpStream() override { closeSocket(sock_); }
    bool sendAll(const uint8_t* data, size_t len) override { return sendAllSocket(sock_, data, len); }
    bool recvAll(uint8_t* data, size_t len) override { return recvAllSocket(sock_, data, len); }
    void shutdown() override { shutdownSocket(sock_); }

private:
    SocketHandle sock_;
};

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
    std::shared_ptr<ByteStream> stream;
    WsSink sink;
    std::mutex sendMutex;
    std::atomic<bool> open{false};
    std::atomic<bool> closeSent{false};
    std::atomic<bool> closeRequested{false};
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
    return c.stream && c.stream->sendAll(f.data(), f.size());
}

struct Url { std::string host, port, path; bool secure = false; };

bool parseWsUrl(const std::string& url, Url& out) {
    const std::string plain = "ws://", secure = "wss://";
    out.secure = url.compare(0, secure.size(), secure) == 0;
    if (!out.secure && url.compare(0, plain.size(), plain) != 0) return false;
    const std::string rest = url.substr(out.secure ? secure.size() : plain.size());
    const size_t slash = rest.find('/');
    const std::string authority = rest.substr(0, slash);
    out.path = slash == std::string::npos ? "/" : rest.substr(slash);
    const size_t colon = authority.rfind(':');
    out.host = colon == std::string::npos ? authority : authority.substr(0, colon);
    out.port = colon == std::string::npos ? (out.secure ? "443" : "80") : authority.substr(colon + 1);
    return !out.host.empty();
}

std::shared_ptr<ByteStream> dial(const Url& u, std::string& why) {
    if (u.secure) {
        std::shared_ptr<ByteStream> tls = dialTls(u.host, u.port, why);
        if (!tls && why.empty()) why = "could not connect to " + u.host + ":" + u.port;
        return tls;
    }
    const SocketHandle s = dialTcp(u.host, u.port);
    if (s == kNoSocket) {
        why = "could not connect to " + u.host + ":" + u.port;
        return nullptr;
    }
    return std::make_shared<TcpStream>(s);
}

std::string lower(std::string s) {
    for (char& ch : s) ch = static_cast<char>(tolower(static_cast<unsigned char>(ch)));
    return s;
}

std::string handshake(Conn& c, ByteStream& stream, const Url& u) {
    uint8_t nonce[16];
    for (auto& b : nonce) b = uint8_t(c.rng());
    const std::string key = base64(nonce, sizeof nonce);
    const std::string req = "GET " + u.path + " HTTP/1.1\r\nHost: " + u.host + ":" + u.port
        + "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: " + key
        + "\r\nSec-WebSocket-Version: 13\r\n\r\n";
    if (!stream.sendAll(reinterpret_cast<const uint8_t*>(req.data()), req.size())) return "handshake send failed";
    std::string head;
    uint8_t ch;
    while (head.size() < 8192 && head.find("\r\n\r\n") == std::string::npos) {
        if (!stream.recvAll(&ch, 1)) return "the server closed during the handshake";
        head += static_cast<char>(ch);
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
    std::shared_ptr<ByteStream> stream;
    auto finish = [&](int code, std::string reason) {
        c->open = false;
        {
            std::lock_guard<std::mutex> lk(c->sendMutex);
            c->stream.reset();
        }
        stream.reset();
        {
            std::lock_guard<std::mutex> lk(g_connsMutex);
            g_conns.erase(c->id);
        }
        // A close handler can exit the host as soon as it receives this final event.
        emit(*c, WsEvent::Kind::Close, {}, code, std::move(reason));
    };
    Url u;
    if (!parseWsUrl(url, u)) {
        emit(*c, WsEvent::Kind::Error, {}, 0, "only ws:// and wss:// URLs are supported: " + url);
        return finish(1006, "bad url");
    }
    std::string refused;
    stream = dial(u, refused);
    {
        std::lock_guard<std::mutex> lk(c->sendMutex);
        c->stream = stream;
    }
    if (!stream) {
        emit(*c, WsEvent::Kind::Error, {}, 0, refused);
        return finish(1006, "connect failed");
    }
    if (c->closeRequested) return finish(1006, "closed before the connection opened");
    if (std::string why = handshake(*c, *stream, u); !why.empty()) {
        if (c->closeRequested) return finish(1006, "closed before the connection opened");
        emit(*c, WsEvent::Kind::Error, {}, 0, why);
        return finish(1006, why);
    }
    c->open = true;
    if (c->closeRequested) return finish(1006, "closed before the connection opened");
    emit(*c, WsEvent::Kind::Open);

    std::vector<uint8_t> message;
    uint8_t messageOp = 0;
    for (;;) {
        uint8_t hdr[2];
        if (!stream->recvAll(hdr, 2)) return finish(1006, "connection lost");
        const bool fin = hdr[0] & 0x80;
        const uint8_t op = hdr[0] & 0x0F;
        uint64_t len = hdr[1] & 0x7F;
        if (len == 126) {
            uint8_t b[2];
            if (!stream->recvAll(b, 2)) return finish(1006, "connection lost");
            len = (uint64_t(b[0]) << 8) | b[1];
        } else if (len == 127) {
            uint8_t b[8];
            if (!stream->recvAll(b, 8)) return finish(1006, "connection lost");
            len = 0;
            for (uint8_t x : b) len = (len << 8) | x;
        }
        uint8_t mask[4] = {0, 0, 0, 0};
        const bool masked = hdr[1] & 0x80;
        if (masked && !stream->recvAll(mask, 4)) return finish(1006, "connection lost");
        const uint64_t pending = op == 0x0 ? message.size() : 0;
        if (const int refusal = wsFrameRefusal(op, fin, len, pending); refusal != 0) {
            const std::string why = refusal == kWsCloseMessageTooBig
                ? "a message of more than " + std::to_string(kWsMaxMessageBytes) + " bytes"
                : "a control frame that is fragmented or longer than 125 bytes";
            emit(*c, WsEvent::Kind::Error, {}, 0, why);
            if (!c->closeSent.exchange(true)) {
                const uint8_t body[2] = { uint8_t(refusal >> 8), uint8_t(refusal) };
                sendFrame(*c, 0x8, body, sizeof body);
            }
            return finish(refusal, why);
        }
        std::vector<uint8_t> payload(static_cast<size_t>(len));
        if (len > 0 && !stream->recvAll(payload.data(), payload.size())) return finish(1006, "connection lost");
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
    c->closeRequested = true;
    if (c->open && !c->closeSent.exchange(true)) {
        std::vector<uint8_t> body = { uint8_t(code >> 8), uint8_t(code) };
        body.insert(body.end(), reason.begin(), reason.end());
        sendFrame(*c, 0x8, body.data(), body.size());
    }
    std::shared_ptr<ByteStream> stream;
    {
        std::lock_guard<std::mutex> lk(c->sendMutex);
        stream = c->stream;
    }
    if (stream) stream->shutdown();
}

}  // namespace eshost
