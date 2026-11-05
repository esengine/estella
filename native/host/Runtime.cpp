// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Runtime.cpp
 * @brief   The JS runtime the host owns: the environment the language does not
 *          ship, the binding installation, and the boot of the SDK + game.
 * @details A JS engine is a language, not a runtime — no console, no timers, no
 *          clock. Those are the host's job and they live here, beside the eval
 *          helpers and the compile cache that makes a ~700 KB SDK bundle load in
 *          milliseconds instead of seconds. The engine itself (V8, or QuickJS
 *          where no JIT is allowed) is behind js/esjs.hpp.
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

#if defined(__ANDROID__) && !defined(ES_ENABLE_PHYSX)
#include <dlfcn.h>
#endif

#include <chrono>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <ctime>

using namespace esengine;

// PhysX's copy of the 3D physics surface (es_physx3d_*), generated beside the
// host's own wrappers. Where PhysX is linked into this binary (a desktop host) it
// is registered directly; an Android host ships it as libestella_physx.so, which
// only a PhysX project's package carries (see loadPhysXLibrary).
void esn_register_functions_physx3d(esjs::Val global);

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
    // steady_clock, as the frame delta already uses (Host.cpp): monotonic on every
    // platform and needing no per-OS spelling, where clock_gettime needed one.
    const auto since = std::chrono::steady_clock::now().time_since_epoch();
    return std::chrono::duration<double, std::milli>(since).count();
}

// =============================================================================
// Value readers
// =============================================================================

void readByteSource(esjs::Val v, std::vector<u8>& out) {
    // An ArrayBuffer or any view of one (texture pixels, audio clip bytes, cache
    // writes) is read straight out of the engine's memory…
    esjs::Bytes bytes;
    if (esjs::bytesOf(v, &bytes)) {
        out.assign(bytes.data, bytes.data + bytes.size);
        return;
    }
    // …and a plain JS number array element by element.
    const uint32_t len = esjs::isObject(v) ? esjs::lengthOf(v) : 0;
    out.resize(len);
    esjs::Scope scope;
    for (uint32_t i = 0; i < len; ++i) out[i] = static_cast<u8>(esjs::toInt32(esjs::getAt(v, i)));
}

// =============================================================================
// The environment an engine does not ship: console, timers, a clock
// =============================================================================

namespace {

#if defined(__ANDROID__) && !defined(ES_ENABLE_PHYSX)
/**
 * PhysX, on Android, is a library of its own: 4.9 MB per ABI that a project on
 * Jolt should not download. The export packs libestella_physx.so into lib/<abi>/
 * only for a project whose 3D solver is PhysX, and the app's linker namespace
 * finds it there by its bare name. It links against this host for the engine
 * surface and the heap, and registers its es_physx3d_* wrappers when called.
 *
 * Absent is the normal case, not an error: the SDK then answers a PhysX project
 * with Jolt and says so (sdk/src/ecs/bridge/nativeSideModules.ts).
 */
void loadPhysXLibrary(esjs::Val global) {
    void* lib = dlopen("libestella_physx.so", RTLD_NOW | RTLD_LOCAL);
    if (lib == nullptr) return;
    using Register = void (*)(esjs::Val*);
    auto reg = reinterpret_cast<Register>(dlsym(lib, "estella_physx_register"));
    if (reg == nullptr) {
        ESHOST_LOGE("libestella_physx.so has no estella_physx_register: %s", dlerror());
        return;
    }
    reg(&global);
    ESHOST_LOGI("PhysX loaded (libestella_physx.so)");
}
#endif

esjs::Val consoleWrite(const esjs::Args& a, bool error) {
    std::string line;
    for (int i = 0; i < a.size(); ++i) {
        if (!line.empty()) line += ' ';
        line += esjs::toString(a[i]);
    }
    hostLog(error, "%s", line.c_str());
    return esjs::undefined();
}
esjs::Val js_consoleLog(const esjs::Args& a) { return consoleWrite(a, false); }
esjs::Val js_consoleError(const esjs::Args& a) { return consoleWrite(a, true); }

esjs::Val addTimer(const esjs::Args& a, bool repeat) {
    if (!esjs::isFunction(a[0])) return esjs::int64(0);
    double delay = a.size() > 1 ? esjs::toNumber(a[1]) : 0;
    if (!(delay >= 0)) delay = 0;                      // also catches NaN
    HostState& h = host();
    const int64_t id = h.nextTimerId++;
    // A zero-delay interval would fire forever within one pump; clamp as browsers do.
    h.timers.push_back(Timer{id, nowMs() + delay, repeat ? (delay > 1 ? delay : 1) : 0, esjs::Ref(a[0])});
    return esjs::int64(id);
}
esjs::Val js_setTimeout(const esjs::Args& a) { return addTimer(a, false); }
esjs::Val js_setInterval(const esjs::Args& a) { return addTimer(a, true); }
esjs::Val js_clearTimer(const esjs::Args& a) {
    const int64_t id = esjs::toInt64(a[0]);
    HostState& h = host();
    for (auto it = h.timers.begin(); it != h.timers.end(); ++it) {
        if (it->id != id) continue;
        h.timers.erase(it);
        break;
    }
    return esjs::undefined();
}

esjs::Val js_performanceNow(const esjs::Args&) { return esjs::number(nowMs()); }

/** Fire the timers that came due. Callbacks may add or clear timers, so they run
 *  off a snapshot — each holding its own reference, so a callback that clears its
 *  own interval does not release the function it is running. */
void pumpTimers(HostState& h) {
    const double now = nowMs();
    std::vector<esjs::Ref> due;
    for (auto it = h.timers.begin(); it != h.timers.end();) {
        if (it->due > now) { ++it; continue; }
        if (it->interval > 0) {
            due.emplace_back(it->fn.get());
            it->due = now + it->interval;
            ++it;
        } else {
            due.push_back(std::move(it->fn));
            it = h.timers.erase(it);
        }
    }
    for (esjs::Ref& fn : due) {
        esjs::Scope scope;
        esjs::call(fn.get(), esjs::undefined(), 0, nullptr, "timer callback");
    }
}

// FNV-1a of the bundle — a changed SDK invalidates its compile cache.
uint64_t hashBytes(const char* p, size_t n) {
    uint64_t h = 1469598103934665603ull;
    for (size_t i = 0; i < n; i++) { h ^= (uint8_t)p[i]; h *= 1099511628211ull; }
    return h;
}

/**
 * The payload of a [8-byte hash][cache] blob, if its hash is the one we want. A
 * blob that does not match is simply not used — the caller falls through to the
 * next source and ultimately to compiling.
 */
bool cachePayload(const std::vector<u8>& blob, uint64_t want, const char* origin,
                  const u8** data, size_t* size) {
    // Every rejection says why. Falling back to a compile is CORRECT but can cost
    // seconds of black screen on an interpreter's first launch, so a build that
    // shipped a cache the host then declined has to be able to say so — silence
    // here is how such a build passes for a working one.
    if (blob.empty()) return false;
    if (blob.size() <= sizeof(uint64_t)) {
        ESHOST_LOGI("SDK bundle: ignoring %s — %zu bytes is not a [hash][cache] blob", origin, blob.size());
        return false;
    }
    uint64_t got = 0;
    std::memcpy(&got, blob.data(), sizeof(got));
    if (got != want) {
        ESHOST_LOGI("SDK bundle: ignoring %s — built against a different bundle "
                    "(%016llx, want %016llx)", origin,
                    (unsigned long long)got, (unsigned long long)want);
        return false;
    }
    *data = blob.data() + sizeof(got);
    *size = blob.size() - sizeof(got);
    return true;
}

std::vector<u8> readFile(const std::string& path) {
    std::vector<u8> blob;
    FILE* f = path.empty() ? nullptr : fopen(path.c_str(), "rb");
    if (!f) return blob;
    fseek(f, 0, SEEK_END);
    const long sz = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (sz > 0) {
        blob.resize((size_t)sz);
        if (fread(blob.data(), 1, blob.size(), f) != blob.size()) blob.clear();
    }
    fclose(f);
    return blob;
}

/**
 * Evaluate the SDK bundle, skipping the compile whenever a cache for it exists.
 * On an interpreter that compile is the black screen after an install (~14 s for
 * the ~700 KB bundle on a phone); on a JIT it is far less, but still not nothing.
 * Two sources, in order of how early they are available:
 *
 *   1. A cache built with the app (`assets/esengine.native.<tag>`), so the FIRST
 *      launch is already fast. Present only where the build machine can produce
 *      one for the engine the device runs.
 *   2. The cache this device wrote on an earlier launch.
 *
 * With neither, the source is compiled — and the cache written on the way out, so
 * the second source works next time. Every blob is tagged with a hash of the
 * bundle it was built from, so a stale one is skipped rather than trusted; the
 * engine checks its own build on top. File: [8-byte hash][cache].
 */
bool evalCachedScript(HostState& h, const char* src, size_t srcLen, const char* filename,
                      const std::string& cachePath, const std::string& shippedAsset) {
    const uint64_t want = hashBytes(src, srcLen);
    const u8* data = nullptr;
    size_t size = 0;
    const char* origin = nullptr;

    const std::vector<u8> shipped = readAsset(h, shippedAsset.c_str());
    const std::vector<u8> cached = readFile(cachePath);
    if (cachePayload(shipped, want, "the cache shipped with the app", &data, &size)) {
        origin = "the cache shipped with the app";
    } else if (cachePayload(cached, want, "the cache this device wrote", &data, &size)) {
        origin = "the cache this device wrote";
    }

    if (!origin) bootNote("bundle: no compile cache — compiling on device, expect a slower first launch");
    esjs::CacheUse use = esjs::CacheUse::None;
    std::string why;
    std::vector<u8> fresh;
    const bool ok = esjs::runCached(std::string_view(src, srcLen), filename, data, size,
                                    &use, &why, cachePath.empty() ? nullptr : &fresh);
    if (use == esjs::CacheUse::Used) {
        ESHOST_LOGI("SDK bundle: loaded from %s", origin);
        bootNote("bundle: %s", origin);
    } else if (use == esjs::CacheUse::Rejected) {
        ESHOST_LOGE("SDK bundle: %s did not load (%s) — compiled instead", origin, why.c_str());
        bootNote("bundle: %s rejected — compiled on device", origin);
    }
    if (!fresh.empty()) {
        if (FILE* f = fopen(cachePath.c_str(), "wb")) {
            fwrite(&want, sizeof(want), 1, f);
            fwrite(fresh.data(), 1, fresh.size(), f);
            fclose(f);
            ESHOST_LOGI("SDK bundle: compiled + cached (%zu bytes)", fresh.size());
        }
    }
    return ok;
}

void engineLog(bool error, const char* message) { hostLog(error, "%s", message); }

}  // namespace

// =============================================================================
// Eval helpers
// =============================================================================

void evalJs(HostState&, const std::string& src, const char* name) {
    esjs::Enter enter;
    esjs::run(src, name);
}

void callJs(HostState&, const char* fn, int argc, const esjs::Val* argv) {
    esjs::Enter enter;
    const esjs::Val global = esjs::global();
    const esjs::Val f = esjs::get(global, fn);
    if (esjs::isFunction(f)) esjs::call(f, global, argc, argv, fn);
}

void pumpJs(HostState& h) {
    esjs::Enter enter;
    esjs::pumpMicrotasks();
    pumpTimers(h);
    esjs::pumpMicrotasks();
    esjs::pumpEngine();
}

void bindGlobal(esjs::Val global, const char* name, esjs::NativeFn fn, int argc) {
    esjs::setFunction(global, name, fn, argc);
}

// =============================================================================
// Bring-up
// =============================================================================

void initRuntime(HostState& h) {
    const double t0 = nowMs();
#if defined(ESJS_V8_SNAPSHOT_ASSET)
    // This V8 keeps its startup snapshot outside the library, and an isolate made
    // without it dies on the spot ("Failed to deserialize the V8 snapshot blob").
    const std::vector<u8> snapshot = readAsset(h, ESJS_V8_SNAPSHOT_ASSET);
    if (snapshot.empty()) {
        ESHOST_LOGE("JS engine: the package carries no %s — the V8 runtime cannot start",
                    ESJS_V8_SNAPSHOT_ASSET);
    }
    esjs::setStartupSnapshot(snapshot.data(), snapshot.size());
#endif
    esjs::init(engineLog, nullptr);
    ESHOST_LOGI("JS engine: %s%s", esjs::engineName().c_str(), esjs::hasJit() ? " (JIT)" : " (interpreter)");
    bootNote("engine: %s", esjs::engineName().c_str());

    esjs::Enter enter;
    const esjs::Val global = esjs::global();
    esjs::set(global, "W", esjs::number(h.w));
    esjs::set(global, "H", esjs::number(h.h));
    esjs::set(global, "S", esjs::number(h.w < h.h ? h.w : h.h));

    // The host environment the SDK expects but an engine (a language, not a
    // runtime) does not provide: console, timers and a monotonic clock. Without
    // them a rejected promise is silent and the asset cache's setTimeout throws.
    const esjs::Val console = esjs::object();
    for (const char* name : {"log", "info", "debug", "trace"}) esjs::setFunction(console, name, js_consoleLog, 1);
    for (const char* name : {"warn", "error"}) esjs::setFunction(console, name, js_consoleError, 1);
    esjs::set(global, "console", console);

    bindGlobal(global, "setTimeout", js_setTimeout, 2);
    bindGlobal(global, "setInterval", js_setInterval, 2);
    bindGlobal(global, "clearTimeout", js_clearTimer, 1);
    bindGlobal(global, "clearInterval", js_clearTimer, 1);
    const esjs::Val perf = esjs::object();
    esjs::setFunction(perf, "now", js_performanceNow, 0);
    esjs::set(global, "performance", perf);

    // The es_* surface, one pillar at a time (see Bindings.hpp). The heap comes
    // first: it is what the generated entry points marshal buffers through.
    registerHeapBindings(h, global);
    registerEcsBindings(h, global);
    registerRenderBindings(h, global);
    registerAssetBindings(h, global);
    registerAudioBindings(h, global);
    registerInputBindings(h, global);
#if defined(ESTELLA_DESKTOP)
    registerSteamBindings(h, global);
#endif
#if defined(ESTELLA_DESKTOP) || defined(__ANDROID__)
    // Where a package can carry compiled systems: a desktop app beside its
    // executable, an APK in lib/<abi>/ (the system linker finds it by name).
    // Without these the SDK falls back to the wasm install, which a native core
    // cannot serve — every @compiled system then stays interpreted.
    registerAotBindings(h, global);
#endif
    registerNetBindings(h, global);
    registerDeviceBindings(h, global);
    registerTextEditorBindings(h, global);

    // The generated halves: per-component accessors, then the engine's binding
    // entry points — both from the same reflection the web's embind bindings come
    // from, so the SDK reaches the engine by the same names on either platform.
    esn_register(global);
    esn_register_functions(global);
#if defined(ES_ENABLE_PHYSX)
    esn_register_functions_physx3d(global);
#elif defined(__ANDROID__)
    loadPhysXLibrary(global);
#endif

    // Layer 1: the real SDK bundle, embedded — installs `ESEngine`.
    const double tCtx = nowMs();
    const std::string cacheName = std::string("esengine.native.") + esjs::cacheTag();
    const std::string cachePath = h.cacheDir.empty() ? std::string() : (h.cacheDir + "/" + cacheName);
    evalCachedScript(h, kSdkBundleJS, kSdkBundleSize, "esengine.native.js", cachePath, cacheName);
    const double tBundle = nowMs();

    // Layer 2: the host bootstrap — the bridge over the es_* bindings, and the
    // default init/update that boots a packaged project.
    evalJs(h, kHostBootstrapJS, "bootstrap.js");
    ESHOST_LOGI("boot ms — engine + bindings: %.0f | SDK bundle eval: %.0f", tCtx - t0, tBundle - tCtx);
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
        evalJs(h, std::string(reinterpret_cast<const char*>(scripts.data()), scripts.size()),
               "scripts.js");
    }
    const double tScripts = nowMs();
    callJs(h, "init", 0, nullptr);
    pumpJs(h);
    ESHOST_LOGI("boot ms — project scripts: %.0f | init(): %.0f", tScripts - t0, nowMs() - tScripts);
    return true;
}

}  // namespace eshost
