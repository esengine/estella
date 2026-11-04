// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    NetBindings.cpp
 * @brief   es_fetch over the platform's native networking, and the thread-safe
 *          hand-back that makes it usable from JS.
 * @details Host-owned: the OS owns the TLS stack, so the request itself is one of
 *          the few things that genuinely differs per platform (NSURLSession /
 *          a JNI HttpURLConnection). Everything around it is here — the request is
 *          read off a JS object, handed to {@link Platform::startFetch}, and the
 *          reply comes back on whatever thread the completion runs on. That reply
 *          is queued as POD and drained on the JS thread in the frame loop, so no
 *          JS value is ever touched off-thread.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#include "Bindings.hpp"
#include "../net/WsClient.hpp"

#include <mutex>
#include <queue>
#include <utility>

using namespace esengine;

namespace eshost {
namespace {

// HTTP replies cross back from whatever thread the platform's completion runs on.
// The platform enqueues here (POD only, no JS); the frame loop drains it on the JS
// thread and runs the callbacks. A namespace-scope queue, so deliverFetch (a free
// function the glue calls) is safe before boot and after teardown alike.
std::mutex g_fetchMutex;
std::queue<FetchResult> g_fetchQueue;

// Socket events arrive on each connection's own thread, and cross the same way.
std::mutex g_wsMutex;
std::queue<WsEvent> g_wsQueue;

std::string fetchStrProp(esjs::Val obj, const char* key, const char* dflt) {
    const esjs::Val v = esjs::get(obj, key);
    return esjs::isString(v) ? esjs::toString(v) : std::string(dflt ? dflt : "");
}

void readFetchHeaders(esjs::Val obj, FetchRequest& req) {
    const esjs::Val h = esjs::get(obj, "headers");
    if (!esjs::isObject(h)) return;
    for (const std::string& key : esjs::ownKeys(h)) {
        req.headers.emplace_back(key, esjs::toString(esjs::get(h, key.c_str())));
    }
}

// es_fetch(request, callback): request = { url, method?, headers?, body?,
// responseType? }. Runs the request off the main thread and calls back with
// { ok, status, statusText, headers, arrayBuffer | text, error? }. The bridge
// wraps this in a Promise. responseType 'text' returns a string; everything else
// returns an ArrayBuffer (the bridge decodes text/json from it on demand).
esjs::Val js_fetch(const esjs::Args& a) {
    if (a.size() < 2 || !esjs::isObject(a[0]) || !esjs::isFunction(a[1])) return esjs::undefined();
    HostState& h = host();
    FetchRequest req;
    req.id = h.nextFetchId++;
    req.url = fetchStrProp(a[0], "url", "");
    req.method = fetchStrProp(a[0], "method", "GET");
    req.wantText = fetchStrProp(a[0], "responseType", "arraybuffer") == "text";
    readFetchHeaders(a[0], req);
    const esjs::Val body = esjs::get(a[0], "body");
    if (esjs::isString(body)) {
        const esjs::Utf8 text(body);
        req.body.assign(text.c_str(), text.c_str() + text.size());
    } else if (!esjs::isNullish(body)) {
        readByteSource(body, req.body);
    }

    h.fetchCallbacks[req.id] = esjs::Ref(a[1]);
    if (req.url.empty()) {
        FetchResult err;
        err.id = req.id;
        err.error = "es_fetch: missing url";
        deliverFetch(std::move(err));
    } else {
        h.platform->startFetch(req);
    }
    return esjs::undefined();
}

esjs::Val makeFetchResult(const FetchResult& r) {
    const esjs::Val o = esjs::object();
    esjs::set(o, "ok", esjs::boolean(r.ok));
    esjs::set(o, "status", esjs::int32(r.status));
    esjs::set(o, "statusText", esjs::string(r.statusText));
    if (!r.error.empty()) esjs::set(o, "error", esjs::string(r.error));
    const esjs::Val headers = esjs::object();
    for (const auto& kv : r.headers) esjs::set(headers, kv.first.c_str(), esjs::string(kv.second));
    esjs::set(o, "headers", headers);
    if (r.isText) {
        esjs::set(o, "text", esjs::string(std::string_view(reinterpret_cast<const char*>(r.body.data()), r.body.size())));
    } else {
        esjs::set(o, "arrayBuffer", esjs::arrayBufferCopy(r.body.data(), r.body.size()));
    }
    return o;
}

// es_wsOpen(url, onEvent) -> id: onEvent({ type: 'open' | 'message' | 'error' | 'close',
// data?: string | ArrayBuffer, code?, reason? }). 'close' is always the last event.
esjs::Val js_wsOpen(const esjs::Args& a) {
    if (a.size() < 2 || !esjs::isFunction(a[1])) return esjs::throwTypeError("es_wsOpen(url, onEvent)");
    const std::string u = esjs::toString(a[0]);
    const int id = wsOpen(u, [](WsEvent e) {
        std::lock_guard<std::mutex> lk(g_wsMutex);
        g_wsQueue.push(std::move(e));
    });
    host().wsCallbacks[id] = esjs::Ref(a[1]);
    return esjs::int32(id);
}

esjs::Val js_wsSend(const esjs::Args& a) {
    if (a.size() < 2) return esjs::boolean(false);
    const int32_t id = esjs::toInt32(a[0]);
    if (esjs::isString(a[1])) {
        const esjs::Utf8 text(a[1]);
        return esjs::boolean(wsSend(id, reinterpret_cast<const uint8_t*>(text.c_str()), text.size(), true));
    }
    std::vector<uint8_t> bytes;
    readByteSource(a[1], bytes);
    return esjs::boolean(wsSend(id, bytes.data(), bytes.size(), false));
}

esjs::Val js_wsClose(const esjs::Args& a) {
    if (a.size() < 1) return esjs::undefined();
    const int32_t id = esjs::toInt32(a[0]);
    const int32_t code = a.size() > 1 && !esjs::isUndefined(a[1]) ? esjs::toInt32(a[1]) : 1000;
    const std::string reason = a.size() > 2 && esjs::isString(a[2]) ? esjs::toString(a[2]) : std::string();
    wsClose(id, code, reason);
    return esjs::undefined();
}

}  // namespace

void drainSockets(HostState& h) {
    std::queue<WsEvent> events;
    { std::lock_guard<std::mutex> lk(g_wsMutex); events.swap(g_wsQueue); }
    if (events.empty()) return;
    esjs::Enter enter;
    while (!events.empty()) {
        WsEvent e = std::move(events.front());
        events.pop();
        auto it = h.wsCallbacks.find(e.id);
        if (it == h.wsCallbacks.end()) continue;
        esjs::Scope scope;
        const esjs::Val o = esjs::object();
        const char* type = e.kind == WsEvent::Kind::Open ? "open"
            : e.kind == WsEvent::Kind::Error ? "error"
            : e.kind == WsEvent::Kind::Close ? "close" : "message";
        esjs::set(o, "type", esjs::string(type));
        if (e.kind == WsEvent::Kind::Text) {
            esjs::set(o, "data", esjs::string(std::string_view(reinterpret_cast<const char*>(e.data.data()), e.data.size())));
        } else if (e.kind == WsEvent::Kind::Binary) {
            esjs::set(o, "data", esjs::arrayBufferCopy(e.data.data(), e.data.size()));
        }
        if (e.kind == WsEvent::Kind::Close) esjs::set(o, "code", esjs::int32(e.code));
        if (!e.reason.empty()) esjs::set(o, "reason", esjs::string(e.reason));
        // A close is the last event: the callback is released once it has run.
        esjs::Ref cb = e.kind == WsEvent::Kind::Close ? std::move(it->second) : esjs::Ref(it->second.get());
        if (e.kind == WsEvent::Kind::Close) h.wsCallbacks.erase(it);
        esjs::call(cb.get(), esjs::undefined(), 1, &o, "es_wsOpen event");
    }
}

void drainFetches(HostState& h) {
    std::queue<FetchResult> done;
    { std::lock_guard<std::mutex> lk(g_fetchMutex); done.swap(g_fetchQueue); }
    if (done.empty()) return;
    esjs::Enter enter;
    while (!done.empty()) {
        const FetchResult r = std::move(done.front());
        done.pop();
        auto it = h.fetchCallbacks.find(r.id);
        if (it == h.fetchCallbacks.end()) continue;   // never happens, but stay safe
        esjs::Ref cb = std::move(it->second);
        h.fetchCallbacks.erase(it);
        esjs::Scope scope;
        const esjs::Val arg = makeFetchResult(r);
        esjs::call(cb.get(), esjs::undefined(), 1, &arg, "es_fetch callback");
    }
}

void registerNetBindings(HostState& h, esjs::Val global) {
    bindGlobal(global, "es_fetch", js_fetch, 2);
    bindGlobal(global, "es_wsOpen", js_wsOpen, 2);
    bindGlobal(global, "es_wsSend", js_wsSend, 2);
    bindGlobal(global, "es_wsClose", js_wsClose, 3);
}

// Thread-safe: the platform's HTTP completion (any thread) queues its reply here;
// the frame loop drains it on the JS thread (drainFetches). No JS is touched here.
void deliverFetch(FetchResult result) {
    std::lock_guard<std::mutex> lk(g_fetchMutex);
    g_fetchQueue.push(std::move(result));
}

}  // namespace eshost
