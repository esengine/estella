// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ChannelBindings.cpp
 * @brief   es_native_* — the game's own line to native code, by name.
 * @details Every other binding here is one capability the engine needs of the OS,
 *          written out call by call. This one is the capability a game needs that
 *          the engine cannot name in advance: an ad SDK, a store, a sign-in, an
 *          analytics library — code that exists in Java or Objective-C, belongs to
 *          the project, and is different in every project. So it is one seam and
 *          not many: a method name, a JSON argument, a JSON reply, and events the
 *          native side raises on its own.
 *
 *          A call is answered by the first of:
 *            * the platform ({@link Platform::nativeCall}): the handlers the app's
 *              Java or Objective-C registered;
 *            * a handler registered here in C++ ({@link registerNativeHandler}).
 *          One that nobody answers is refused at the call (es_native_call answers
 *          false), so the script's promise rejects naming the method rather than
 *          waiting on a reply that is not coming.
 *
 *          Handlers answer from whatever thread their SDK calls back on, so a
 *          reply is queued as POD and delivered in the frame loop, the shape
 *          {@link deliverFetch} and the text editor use for the same reason.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#include "Bindings.hpp"

#include <cstdio>
#include <mutex>
#include <queue>
#include <string>
#include <unordered_map>
#include <utility>

using namespace esengine;

namespace eshost {
namespace {

/** One thing native code said, as POD: what crosses the thread boundary. */
struct ChannelPush {
    bool reply = false;      ///< a call's answer; otherwise an event
    int id = 0;              ///< the call it answers
    bool ok = false;
    std::string name;        ///< the event's name
    std::string payload;     ///< JSON, or the reason a call failed
};

// Namespace-scope, so deliverNative* is safe before boot and after teardown alike.
std::mutex g_mutex;
std::queue<ChannelPush> g_queue;
std::unordered_map<std::string, NativeHandler> g_handlers;

void push(ChannelPush item) {
    std::lock_guard<std::mutex> lk(g_mutex);
    g_queue.push(std::move(item));
}

bool hasHandler(const std::string& method) {
    std::lock_guard<std::mutex> lk(g_mutex);
    return g_handlers.count(method) != 0;
}

std::string jsonString(const std::string& text) {
    std::string out = "\"";
    for (const unsigned char c : text) {
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (c < 0x20) {
                    char escaped[8];
                    std::snprintf(escaped, sizeof escaped, "\\u%04x", c);
                    out += escaped;
                } else {
                    out += static_cast<char>(c);
                }
        }
    }
    return out + "\"";
}

// es_native_has(method): whether a call to it would be answered.
esjs::Val js_native_has(const esjs::Args& a) {
    if (a.size() < 1 || !hostAlive()) return esjs::boolean(false);
    const std::string method = esjs::toString(a[0]);
    if (host().platform && host().platform->nativeHas(method)) return esjs::boolean(true);
    return esjs::boolean(hasHandler(method));
}

// es_native_call(id, method, argsJson): false when nobody answers to the name.
esjs::Val js_native_call(const esjs::Args& a) {
    if (a.size() < 3 || !hostAlive()) return esjs::boolean(false);
    const int id = esjs::toInt32(a[0]);
    const std::string method = esjs::toString(a[1]);
    const std::string args = esjs::toString(a[2]);
    if (host().platform && host().platform->nativeCall(id, method, args)) return esjs::boolean(true);

    NativeHandler handler;
    {
        std::lock_guard<std::mutex> lk(g_mutex);
        const auto it = g_handlers.find(method);
        if (it == g_handlers.end()) return esjs::boolean(false);
        handler = it->second;   // a copy: the handler may register or remove one
    }
    handler(args, [id](bool ok, std::string payload) { deliverNativeReply(id, ok, std::move(payload)); });
    return esjs::boolean(true);
}

/** The push as the SDK's `es_onNativeMessage` reads it. */
esjs::Val makePush(const ChannelPush& item) {
    esjs::Val obj = esjs::object();
    if (item.reply) {
        esjs::set(obj, "kind", esjs::string("reply"));
        esjs::set(obj, "id", esjs::int32(item.id));
        esjs::set(obj, "ok", esjs::boolean(item.ok));
    } else {
        esjs::set(obj, "kind", esjs::string("event"));
        esjs::set(obj, "name", esjs::string(item.name));
    }
    esjs::set(obj, "payload", esjs::string(item.payload));
    return obj;
}

}  // namespace

void drainNativeChannel(HostState& h) {
    std::queue<ChannelPush> pending;
    { std::lock_guard<std::mutex> lk(g_mutex); pending.swap(g_queue); }
    if (pending.empty()) return;
    (void)h;
    esjs::Enter enter;
    const esjs::Val fn = esjs::get(esjs::global(), "es_onNativeMessage");
    while (!pending.empty()) {
        const ChannelPush item = std::move(pending.front());
        pending.pop();
        if (!esjs::isFunction(fn)) continue;   // the SDK has not installed it (yet)
        esjs::Scope scope;
        const esjs::Val arg = makePush(item);
        esjs::call(fn, esjs::undefined(), 1, &arg, "es_onNativeMessage");
    }
}

void registerChannelBindings(HostState& h, esjs::Val global) {
    // What the host itself answers on every platform, so a script can tell where
    // it is running without a handler of its own. A platform that knows more (the
    // package's id and version) answers the same name first.
    if (!hasHandler("app.info")) {
        const std::string device = h.platform ? h.platform->describe() : std::string();
        registerNativeHandler("app.info", [device](const std::string&, NativeReply reply) {
            reply(true, "{\"device\":" + jsonString(device) + "}");
        });
    }
    bindGlobal(global, "es_native_has", js_native_has, 1);
    bindGlobal(global, "es_native_call", js_native_call, 3);
}

void registerNativeHandler(std::string method, NativeHandler handler) {
    std::lock_guard<std::mutex> lk(g_mutex);
    if (handler) g_handlers[std::move(method)] = std::move(handler);
    else g_handlers.erase(method);
}

// Thread-safe: an SDK answers on its own thread, the frame loop delivers.
void deliverNativeReply(int id, bool ok, std::string payload) {
    ChannelPush item;
    item.reply = true;
    item.id = id;
    item.ok = ok;
    item.payload = std::move(payload);
    push(std::move(item));
}

void deliverNativeEvent(std::string name, std::string payload) {
    ChannelPush item;
    item.name = std::move(name);
    item.payload = std::move(payload);
    push(std::move(item));
}

}  // namespace eshost
