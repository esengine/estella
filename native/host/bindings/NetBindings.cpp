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

std::string fetchStrProp(JSContext* ctx, JSValueConst obj, const char* key, const char* dflt) {
    JSValue v = JS_GetPropertyStr(ctx, obj, key);
    std::string out = dflt ? dflt : "";
    if (JS_IsString(v)) {
        if (const char* s = JS_ToCString(ctx, v)) { out = s; JS_FreeCString(ctx, s); }
    }
    JS_FreeValue(ctx, v);
    return out;
}

void readFetchHeaders(JSContext* ctx, JSValueConst obj, FetchRequest& req) {
    JSValue h = JS_GetPropertyStr(ctx, obj, "headers");
    if (JS_IsObject(h)) {
        JSPropertyEnum* tab = nullptr;
        uint32_t len = 0;
        if (JS_GetOwnPropertyNames(ctx, &tab, &len, h, JS_GPN_STRING_MASK | JS_GPN_ENUM_ONLY) == 0) {
            for (uint32_t i = 0; i < len; ++i) {
                const char* key = JS_AtomToCString(ctx, tab[i].atom);
                JSValue val = JS_GetProperty(ctx, h, tab[i].atom);
                const char* vs = JS_ToCString(ctx, val);
                if (key && vs) req.headers.emplace_back(key, vs);
                if (vs) JS_FreeCString(ctx, vs);
                if (key) JS_FreeCString(ctx, key);
                JS_FreeValue(ctx, val);
            }
            JS_FreePropertyEnum(ctx, tab, len);
        }
    }
    JS_FreeValue(ctx, h);
}

// es_fetch(request, callback): request = { url, method?, headers?, body?,
// responseType? }. Runs the request off the main thread and calls back with
// { ok, status, statusText, headers, arrayBuffer | text, error? }. The bridge
// wraps this in a Promise. responseType 'text' returns a string; everything else
// returns an ArrayBuffer (the bridge decodes text/json from it on demand).
JSValue js_fetch(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (argc < 2 || !JS_IsObject(argv[0]) || !JS_IsFunction(ctx, argv[1])) return JS_UNDEFINED;
    HostState& h = host();
    FetchRequest req;
    req.id = h.nextFetchId++;
    req.url = fetchStrProp(ctx, argv[0], "url", "");
    req.method = fetchStrProp(ctx, argv[0], "method", "GET");
    req.wantText = fetchStrProp(ctx, argv[0], "responseType", "arraybuffer") == "text";
    readFetchHeaders(ctx, argv[0], req);
    JSValue body = JS_GetPropertyStr(ctx, argv[0], "body");
    if (JS_IsString(body)) {
        size_t len = 0;
        if (const char* s = JS_ToCStringLen(ctx, &len, body)) {
            req.body.assign(s, s + len);
            JS_FreeCString(ctx, s);
        }
    } else if (!JS_IsUndefined(body) && !JS_IsNull(body)) {
        readByteSource(ctx, body, req.body);
    }
    JS_FreeValue(ctx, body);

    h.fetchCallbacks[req.id] = JS_DupValue(ctx, argv[1]);
    if (req.url.empty()) {
        FetchResult err;
        err.id = req.id;
        err.error = "es_fetch: missing url";
        deliverFetch(std::move(err));
    } else {
        h.platform->startFetch(req);
    }
    return JS_UNDEFINED;
}

JSValue makeFetchResult(HostState& h, const FetchResult& r) {
    JSValue o = JS_NewObject(h.js);
    JS_SetPropertyStr(h.js, o, "ok", JS_NewBool(h.js, r.ok));
    JS_SetPropertyStr(h.js, o, "status", JS_NewInt32(h.js, r.status));
    JS_SetPropertyStr(h.js, o, "statusText", JS_NewString(h.js, r.statusText.c_str()));
    if (!r.error.empty()) JS_SetPropertyStr(h.js, o, "error", JS_NewString(h.js, r.error.c_str()));
    JSValue headers = JS_NewObject(h.js);
    for (const auto& kv : r.headers) {
        JS_SetPropertyStr(h.js, headers, kv.first.c_str(), JS_NewString(h.js, kv.second.c_str()));
    }
    JS_SetPropertyStr(h.js, o, "headers", headers);
    if (r.isText) {
        JS_SetPropertyStr(h.js, o, "text",
            JS_NewStringLen(h.js, reinterpret_cast<const char*>(r.body.data()), r.body.size()));
    } else {
        JS_SetPropertyStr(h.js, o, "arrayBuffer",
            JS_NewArrayBufferCopy(h.js, r.body.data(), r.body.size()));
    }
    return o;
}

}  // namespace

void drainFetches(HostState& h) {
    jsEntry(h);
    std::queue<FetchResult> done;
    { std::lock_guard<std::mutex> lk(g_fetchMutex); done.swap(g_fetchQueue); }
    while (!done.empty()) {
        const FetchResult r = std::move(done.front());
        done.pop();
        auto it = h.fetchCallbacks.find(r.id);
        if (it == h.fetchCallbacks.end()) continue;   // never happens, but stay safe
        JSValue cb = it->second;
        h.fetchCallbacks.erase(it);
        JSValue arg = makeFetchResult(h, r);
        JSValue ret = JS_Call(h.js, cb, JS_UNDEFINED, 1, &arg);
        if (JS_IsException(ret)) logJsError(h.js, "es_fetch callback");
        JS_FreeValue(h.js, ret);
        JS_FreeValue(h.js, arg);
        JS_FreeValue(h.js, cb);
    }
}

void registerNetBindings(HostState& h, JSValue global) {
    bindGlobal(h, global, "es_fetch", js_fetch, 2);
}

// Thread-safe: the platform's HTTP completion (any thread) queues its reply here;
// the frame loop drains it on the JS thread (drainFetches). No JS is touched here.
void deliverFetch(FetchResult result) {
    std::lock_guard<std::mutex> lk(g_fetchMutex);
    g_fetchQueue.push(std::move(result));
}

}  // namespace eshost
