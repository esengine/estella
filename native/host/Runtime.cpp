// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Runtime.cpp
 * @brief   The QuickJS runtime the host owns: the environment the language does
 *          not ship, the binding installation, and the boot of the SDK + game.
 * @details QuickJS is a language, not a runtime — no console, no timers, no
 *          clock. Those are the host's job and they live here, beside the eval
 *          helpers and the bytecode cache that makes a ~700 KB SDK bundle load in
 *          milliseconds instead of seconds.
 *
 *          Three layers are stacked here, in order: the SDK bundle (embedded,
 *          installs `ESEngine`), bootstrap.js (embedded, installs the bridge and
 *          the default init/update), and the packaged project (read off the
 *          device).
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#include "Bindings.hpp"
#include "BootLog.hpp"

#include "esn_shim.hpp"          // esn_register / esn_register_functions
#include "esengine_bundle.h"     // the real SDK, bundled: installs globalThis.ESEngine
#include "host_bootstrap.h"      // bootstrap.js, embedded

#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <ctime>

using namespace esengine;

namespace eshost {

// =============================================================================
// The state singleton
// =============================================================================

namespace {
HostState* g_host = nullptr;
}

HostState& host() { return *g_host; }
bool hostAlive() { return g_host != nullptr; }

void createHost(Platform& platform) {
    static HostState state;
    g_host = &state;
    state.platform = &platform;
    state.cacheDir = platform.cacheDir();
    state.dataDir = platform.dataDir();
}

void hostLog(bool error, const char* fmt, ...) {
    char buf[1024];
    va_list args;
    va_start(args, fmt);
    vsnprintf(buf, sizeof(buf), fmt, args);
    va_end(args);
    if (g_host && g_host->platform) g_host->platform->log(error, buf);
    // …and into the boot record, so what a developer reads over a cable and what
    // a player can send are the same lines.
    bootLogLine(error, buf);
}

double nowMs() {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1000.0 + ts.tv_nsec / 1e6;
}

// =============================================================================
// Value readers
// =============================================================================

void readByteSource(JSContext* ctx, JSValueConst v, std::vector<u8>& out) {
    // Raw ArrayBuffer first — a typed-array view is not one, so it falls through.
    size_t rawSize = 0;
    if (uint8_t* raw = JS_GetArrayBuffer(ctx, &rawSize, v)) {
        out.assign(raw, raw + rawSize);
        return;
    }
    JS_FreeValue(ctx, JS_GetException(ctx));   // not a raw ArrayBuffer — try a view

    size_t byteOffset = 0, byteLen = 0, bytesPerEl = 0;
    JSValue ab = JS_GetTypedArrayBuffer(ctx, v, &byteOffset, &byteLen, &bytesPerEl);
    if (!JS_IsException(ab)) {
        size_t abSize = 0;
        uint8_t* base = JS_GetArrayBuffer(ctx, &abSize, ab);
        if (base && byteOffset + byteLen <= abSize) {
            out.assign(base + byteOffset, base + byteOffset + byteLen);
        }
        JS_FreeValue(ctx, ab);
        return;
    }
    JS_FreeValue(ctx, ab);
    JS_FreeValue(ctx, JS_GetException(ctx));   // not a typed array — clear + index it
    uint32_t len = 0;
    JSValue lv = JS_GetPropertyStr(ctx, v, "length");
    JS_ToUint32(ctx, &len, lv);
    JS_FreeValue(ctx, lv);
    out.resize(len);
    for (uint32_t i = 0; i < len; ++i) {
        JSValue el = JS_GetPropertyUint32(ctx, v, i);
        int32_t iv = 0;
        JS_ToInt32(ctx, &iv, el);
        out[i] = (u8)iv;
        JS_FreeValue(ctx, el);
    }
}

// =============================================================================
// The environment QuickJS does not ship: console, timers, a clock
// =============================================================================

namespace {

JSValue jsConsoleWrite(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv, bool error) {
    std::string line;
    for (int i = 0; i < argc; ++i) {
        const char* s = JS_ToCString(ctx, argv[i]);
        if (!s) continue;
        if (!line.empty()) line += ' ';
        line += s;
        JS_FreeCString(ctx, s);
    }
    hostLog(error, "%s", line.c_str());
    return JS_UNDEFINED;
}
JSValue js_consoleLog(JSContext* ctx, JSValueConst t, int argc, JSValueConst* argv) {
    return jsConsoleWrite(ctx, t, argc, argv, false);
}
JSValue js_consoleError(JSContext* ctx, JSValueConst t, int argc, JSValueConst* argv) {
    return jsConsoleWrite(ctx, t, argc, argv, true);
}

JSValue jsAddTimer(JSContext* ctx, int argc, JSValueConst* argv, bool repeat) {
    if (argc < 1 || !JS_IsFunction(ctx, argv[0])) return JS_NewInt64(ctx, 0);
    double delay = 0;
    if (argc > 1) JS_ToFloat64(ctx, &delay, argv[1]);
    if (!(delay >= 0)) delay = 0;                      // also catches NaN
    HostState& h = host();
    const int64_t id = h.nextTimerId++;
    // A zero-delay interval would fire forever within one pump; clamp as browsers do.
    h.timers.push_back(Timer{id, nowMs() + delay, repeat ? (delay > 1 ? delay : 1) : 0,
                             JS_DupValue(ctx, argv[0])});
    return JS_NewInt64(ctx, id);
}
JSValue js_setTimeout(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    return jsAddTimer(ctx, argc, argv, false);
}
JSValue js_setInterval(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    return jsAddTimer(ctx, argc, argv, true);
}
JSValue js_clearTimer(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    int64_t id = 0;
    if (argc > 0) JS_ToInt64(ctx, &id, argv[0]);
    HostState& h = host();
    for (auto it = h.timers.begin(); it != h.timers.end(); ++it) {
        if (it->id != id) continue;
        JS_FreeValue(h.js, it->fn);
        h.timers.erase(it);
        break;
    }
    return JS_UNDEFINED;
}

JSValue js_performanceNow(JSContext* ctx, JSValueConst, int, JSValueConst*) {
    return JS_NewFloat64(ctx, nowMs());
}

/** Drain QuickJS's microtask queue. app.tick() is async: its synchronous prefix
 *  (finishPlugins, resource inserts) runs on call, but the systems run in jobs. */
void pumpJobs(HostState& h) {
    JSContext* c;
    while (JS_ExecutePendingJob(h.rt, &c) > 0) { /* ran a job */ }
}

/** Fire the timers that came due. Callbacks may add or clear timers, so they run
 *  off a snapshot rather than while iterating. */
void pumpTimers(HostState& h) {
    const double now = nowMs();
    std::vector<Timer> due;
    for (auto it = h.timers.begin(); it != h.timers.end();) {
        if (it->due > now) { ++it; continue; }
        due.push_back(*it);
        if (it->interval > 0) { it->due = now + it->interval; ++it; }
        else it = h.timers.erase(it);
    }
    for (Timer& t : due) {
        JSValue r = JS_Call(h.js, t.fn, JS_UNDEFINED, 0, nullptr);
        if (JS_IsException(r)) logJsError(h.js, "timer callback");
        JS_FreeValue(h.js, r);
        if (t.interval <= 0) JS_FreeValue(h.js, t.fn);   // the erased entry's reference
    }
}

// FNV-1a of the bundle — a changed SDK invalidates its bytecode cache.
uint64_t hashBytes(const char* p, size_t n) {
    uint64_t h = 1469598103934665603ull;
    for (size_t i = 0; i < n; i++) { h ^= (uint8_t)p[i]; h *= 1099511628211ull; }
    return h;
}

/**
 * Read a [8-byte hash][bytecode] blob, if its hash is the one we want. A blob that
 * does not match, or does not load, is simply not used — the caller falls through
 * to the next source and ultimately to compiling.
 */
bool tryBytecode(HostState& h, const u8* blob, size_t size, uint64_t want,
                 const char* origin, JSValue& out) {
    // Every rejection says why. Falling back to a parse is CORRECT but costs
    // seconds of black screen on first launch, so a build that shipped bytecode
    // the host then declined has to be able to say so — silence here is how such a
    // build passes for a working one.
    if (size <= sizeof(uint64_t)) {
        ESHOST_LOGI("SDK bundle: ignoring %s — %zu bytes is not a [hash][bytecode] blob", origin, size);
        return false;
    }
    uint64_t got = 0;
    std::memcpy(&got, blob, sizeof(got));
    if (got != want) {
        ESHOST_LOGI("SDK bundle: ignoring %s — built against a different bundle "
                    "(%016llx, want %016llx)", origin,
                    (unsigned long long)got, (unsigned long long)want);
        return false;
    }

    JSValue fn = JS_ReadObject(h.js, blob + sizeof(got), size - sizeof(got), JS_READ_OBJ_BYTECODE);
    if (JS_IsException(fn)) {
        JSValue e = JS_GetException(h.js);
        const char* msg = JS_ToCString(h.js, e);
        ESHOST_LOGE("SDK bundle: %s did not load (%s) — falling back to a parse", origin, msg ? msg : "?");
        if (msg) JS_FreeCString(h.js, msg);
        JS_FreeValue(h.js, e);
        return false;
    }
    ESHOST_LOGI("SDK bundle: loaded from %s", origin);
    bootNote("bundle: %s", origin);
    out = JS_EvalFunction(h.js, fn);
    return true;
}

/**
 * Evaluate a global script, skipping the parse whenever bytecode for it exists.
 * QuickJS is an interpreter: parsing the ~700 KB SDK bundle costs ~14 s on a
 * device, and that parse is the black screen after an install. Three sources, in
 * order of how early they are available:
 *
 *   1. Bytecode built with the app (`assets/esengine.native.bc`), so the FIRST
 *      launch is already fast. Present only if the build machine could produce it.
 *   2. Bytecode this device compiled on an earlier launch.
 *   3. The source, parsed — and cached on the way out, so step 2 works next time.
 *
 * Every source is tagged with a hash of the bundle it was built from, so a stale
 * one is skipped rather than trusted. Cache file: [8-byte hash][bytecode].
 */
JSValue evalCachedScript(HostState& h, const char* src, size_t srcLen, const char* filename,
                         const std::string& cachePath, const char* shippedAsset) {
    const uint64_t want = hashBytes(src, srcLen);
    JSValue out;

    if (shippedAsset) {
        const std::vector<u8> blob = readAsset(h, shippedAsset);
        if (!blob.empty() && tryBytecode(h, blob.data(), blob.size(), want,
                                         "bytecode shipped with the app", out)) {
            return out;
        }
    }

    if (!cachePath.empty()) {
        FILE* f = fopen(cachePath.c_str(), "rb");
        if (f) {
            std::vector<u8> blob;
            fseek(f, 0, SEEK_END);
            const long sz = ftell(f);
            fseek(f, 0, SEEK_SET);
            if (sz > 0) {
                blob.resize((size_t)sz);
                if (fread(blob.data(), 1, blob.size(), f) != blob.size()) blob.clear();
            }
            fclose(f);
            if (!blob.empty() && tryBytecode(h, blob.data(), blob.size(), want,
                                             "bytecode cache", out)) {
                return out;
            }
        }
    }

    // Parse once (slow), cache the bytecode, run.
    // No bytecode from either source: this launch pays the parse. Said plainly,
    // because it is seconds of black screen and the question it raises ("did it
    // crash?") is the one the record exists to answer.
    bootNote("bundle: NO bytecode — parsing on device, expect a slow first launch");
    JSValue fn = JS_Eval(h.js, src, srcLen, filename, JS_EVAL_TYPE_GLOBAL | JS_EVAL_FLAG_COMPILE_ONLY);
    if (JS_IsException(fn)) return fn;
    if (!cachePath.empty()) {
        size_t bcLen = 0;
        uint8_t* bc = JS_WriteObject(h.js, &bcLen, fn, JS_WRITE_OBJ_BYTECODE);
        if (bc) {
            FILE* f = fopen(cachePath.c_str(), "wb");
            if (f) { fwrite(&want, sizeof(want), 1, f); fwrite(bc, 1, bcLen, f); fclose(f); }
            js_free(h.js, bc);
            ESHOST_LOGI("SDK bundle: compiled + cached bytecode (%zu bytes)", bcLen);
        }
    }
    return JS_EvalFunction(h.js, fn);   // consumes fn
}

}  // namespace

// =============================================================================
// Eval helpers
// =============================================================================

void logJsError(JSContext* ctx, const char* where) {
    JSValue e = JS_GetException(ctx);
    const char* s = JS_ToCString(ctx, e);
    ESHOST_LOGE("JS error in %s: %s", where, s ? s : "?");
    if (s) JS_FreeCString(ctx, s);
    // The stack too: a bare message ("Maximum call stack size exceeded") says
    // nothing about which SDK path produced it, and a device is where you find out.
    JSValue stack = JS_GetPropertyStr(ctx, e, "stack");
    if (!JS_IsUndefined(stack) && !JS_IsException(stack)) {
        const char* st = JS_ToCString(ctx, stack);
        if (st) { ESHOST_LOGE("  stack: %s", st); JS_FreeCString(ctx, st); }
    }
    JS_FreeValue(ctx, stack);
    JS_FreeValue(ctx, e);
}

// QuickJS detects JS stack overflow by comparing the current C stack pointer
// against a top it records ONCE, at JS_NewRuntime. The runtime outlives the
// thread that made it: on Android an activity recreate keeps the process (and
// the booted engine) but hands every later JS call to a NEW glue thread, whose
// stack ASLR may map more than the 1MB budget below the recorded top — at which
// point every call, however flat, throws "Maximum call stack size exceeded"
// forever. Re-anchoring at each host→JS entry is the API's own answer to a
// runtime crossing threads, and costs one stack-pointer read.
void jsEntry(HostState& h) {
    JS_UpdateStackTop(h.rt);
}

void evalJs(HostState& h, const char* src, const char* name) {
    jsEntry(h);
    JSValue r = JS_Eval(h.js, src, strlen(src), name, JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(r)) logJsError(h.js, name);
    JS_FreeValue(h.js, r);
}

void callJs(HostState& h, const char* fn, int argc, JSValue* argv) {
    jsEntry(h);
    JSValue global = JS_GetGlobalObject(h.js);
    JSValue f = JS_GetPropertyStr(h.js, global, fn);
    if (JS_IsFunction(h.js, f)) {
        JSValue r = JS_Call(h.js, f, global, argc, argv);
        if (JS_IsException(r)) logJsError(h.js, fn);
        JS_FreeValue(h.js, r);
    }
    JS_FreeValue(h.js, f);
    JS_FreeValue(h.js, global);
}

void pumpJs(HostState& h) {
    jsEntry(h);
    pumpJobs(h);
    pumpTimers(h);
    pumpJobs(h);
}

void bindGlobal(HostState& h, JSValue global, const char* name, JSCFunction* fn, int argc) {
    JS_SetPropertyStr(h.js, global, name, JS_NewCFunction(h.js, fn, name, argc));
}

// =============================================================================
// Bring-up
// =============================================================================

void initRuntime(HostState& h) {
    const double t0 = nowMs();
    h.rt = JS_NewRuntime();
    h.js = JS_NewContext(h.rt);
    JSValue global = JS_GetGlobalObject(h.js);

    JS_SetPropertyStr(h.js, global, "W", JS_NewFloat64(h.js, h.w));
    JS_SetPropertyStr(h.js, global, "H", JS_NewFloat64(h.js, h.h));
    JS_SetPropertyStr(h.js, global, "S", JS_NewFloat64(h.js, h.w < h.h ? h.w : h.h));

    // The host environment the SDK expects but QuickJS (a language, not a runtime)
    // does not provide: console, timers and a monotonic clock. Without them a
    // rejected promise is silent and the asset cache's setTimeout throws.
    JSValue console = JS_NewObject(h.js);
    for (const char* name : {"log", "info", "debug", "trace"}) {
        JS_SetPropertyStr(h.js, console, name, JS_NewCFunction(h.js, js_consoleLog, name, 1));
    }
    for (const char* name : {"warn", "error"}) {
        JS_SetPropertyStr(h.js, console, name, JS_NewCFunction(h.js, js_consoleError, name, 1));
    }
    JS_SetPropertyStr(h.js, global, "console", console);

    bindGlobal(h, global, "setTimeout", js_setTimeout, 2);
    bindGlobal(h, global, "setInterval", js_setInterval, 2);
    bindGlobal(h, global, "clearTimeout", js_clearTimer, 1);
    bindGlobal(h, global, "clearInterval", js_clearTimer, 1);
    JSValue perf = JS_NewObject(h.js);
    JS_SetPropertyStr(h.js, perf, "now", JS_NewCFunction(h.js, js_performanceNow, "now", 0));
    JS_SetPropertyStr(h.js, global, "performance", perf);

    // The es_* surface, one pillar at a time (see Bindings.hpp). The heap comes
    // first: it is what the generated entry points marshal buffers through.
    registerHeapBindings(h, global);
    registerEcsBindings(h, global);
    registerRenderBindings(h, global);
    registerAssetBindings(h, global);
    registerAudioBindings(h, global);
    registerInputBindings(h, global);
    registerNetBindings(h, global);
    registerTextEditorBindings(h, global);

    // The generated halves: per-component accessors, then the engine's binding
    // entry points — both from the same reflection the web's embind bindings come
    // from, so the SDK reaches the engine by the same names on either platform.
    esn_register(h.js, global);
    esn_register_functions(h.js, global);
    JS_FreeValue(h.js, global);

    // Layer 1: the real SDK bundle, embedded — installs `ESEngine`.
    const double tCtx = nowMs();
    std::string bcPath = h.cacheDir.empty() ? std::string() : (h.cacheDir + "/esengine.native.bc");
    JSValue br = evalCachedScript(h, kSdkBundleJS, strlen(kSdkBundleJS), "esengine.native.js",
                                  bcPath, "esengine.native.qjsbc");
    if (JS_IsException(br)) logJsError(h.js, "SDK bundle");
    JS_FreeValue(h.js, br);
    const double tBundle = nowMs();

    // Layer 2: the host bootstrap — the bridge over the es_* bindings, and the
    // default init/update that boots a packaged project.
    evalJs(h, kHostBootstrapJS, "bootstrap.js");
    ESHOST_LOGI("boot ms — qjs ctx: %.0f | SDK bundle eval: %.0f", tCtx - t0, tBundle - tCtx);
}

bool runPackagedGame(HostState& h) {
    // Layer 3: the game. The package IS an editor export — game.config.json,
    // the manifests, the cooked assets and the scenes — which boots through the
    // bootstrap's default init/update. There is no second way in: a hand-written
    // script would be a parallel content path that drifts from the one every real
    // game takes. The project's own scripts must register their components BEFORE
    // the scene loads, so they run first.
    const double t0 = nowMs();
    if (readAsset(h, "game.config.json").empty()) {
        ESHOST_LOGE("nothing to run: no game.config.json. Package a project "
                    "(Package Project -> Android / iOS) and ship it with "
                    "`cli native --content <dir>`.");
        return false;
    }
    std::vector<u8> scripts = readAsset(h, "scripts.js");
    if (!scripts.empty()) {
        evalJs(h, std::string(reinterpret_cast<const char*>(scripts.data()), scripts.size()).c_str(),
               "scripts.js");
    }
    const double tScripts = nowMs();
    callJs(h, "init", 0, nullptr);
    pumpJs(h);
    ESHOST_LOGI("boot ms — project scripts: %.0f | init(): %.0f", tScripts - t0, nowMs() - tScripts);
    return true;
}

}  // namespace eshost
