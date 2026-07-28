// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Runtime.hpp
 * @brief   The host's INTERNAL surface: the state every part of it shares, and
 *          the QuickJS plumbing the binding TUs are written against.
 * @details Not part of the host's contract with a platform — that is Host.hpp.
 *          This is what Host.cpp and the binding TUs share: one state struct, the
 *          JS runtime that owns the language-level environment QuickJS does not
 *          ship (console, timers, a clock), and the value readers every binding
 *          needs. A binding TU includes this and nothing else of the host.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "Host.hpp"
#include "media/native_audio.hpp"

extern "C" {
#include "quickjs.h"
}

#include "esengine/core/EstellaContext.hpp"
#include "esengine/ecs/Registry.hpp"
#include "esengine/renderer/webgpu/WebGPUDevice.hpp"

#include <chrono>
#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

namespace eshost {

/** A pending setTimeout / setInterval callback. QuickJS is only the language: the
 *  timers, like console, are the host's job. */
struct Timer {
    int64_t id;
    double due;        ///< nowMs() deadline.
    double interval;   ///< Repeat period; 0 for a one-shot.
    JSValue fn;
};

/**
 * Everything one running host owns. Single-instance by construction (a native app
 * has one window and one JS runtime), reached through {@link host}.
 */
struct HostState {
    Platform* platform = nullptr;

    // — Graphics: Dawn, and the engine context drawing through it —
    WGPUInstance instance = nullptr;
    WGPUAdapter adapter = nullptr;
    WGPUDevice device = nullptr;
    esengine::WebGPUDevice* gfx = nullptr;
    esengine::EstellaContext* ctx = nullptr;
    esengine::ecs::Registry* registry = nullptr;

    // — Script: the QuickJS runtime the SDK and the game run in —
    JSRuntime* rt = nullptr;
    JSContext* js = nullptr;
    std::vector<Timer> timers;
    int64_t nextTimerId = 1;
    std::unordered_map<int, JSValue> fetchCallbacks;   ///< in-flight es_fetch id -> JS callback
    int nextFetchId = 1;

    AudioEngine audio;              ///< native sound (miniaudio); silent if no device
    std::string cacheDir;           ///< app private dir — SDK bytecode cache + asset cache

    esengine::f32 w = 0, h = 0;
    bool ready = false;             ///< engine + JS booted once
    bool surfaceReady = false;      ///< a live window surface is bound (false while screen off)
    uint64_t frame = 0;
    /// When the last frame was stepped, for the delta the next one reports. Unset
    /// until the first frame and cleared whenever the surface goes away, so a
    /// resume does not hand the game the time the app spent in the background.
    std::chrono::steady_clock::time_point lastFrameAt{};
    bool haveLastFrame = false;
};

/** The running host. Valid from the first line of {@link boot}; a binding can only
 *  run after that, so bindings dereference it without checking. */
HostState& host();

/** Whether {@link host} is usable at all — for the entry points an event loop may
 *  call before boot (or after a failed one). */
bool hostAlive();

/** Installs the state singleton. Called once, by boot(). */
void createHost(Platform& platform);

// =============================================================================
// Logging — the platform's log sink, printf-shaped
// =============================================================================

void hostLog(bool error, const char* fmt, ...);

#define ESHOST_LOGI(...) ::eshost::hostLog(false, __VA_ARGS__)
#define ESHOST_LOGE(...) ::eshost::hostLog(true, __VA_ARGS__)

// =============================================================================
// The JS runtime
// =============================================================================

/** Monotonic milliseconds — the host clock behind performance.now() and timers. */
double nowMs();

/**
 * Bring up QuickJS with the environment the SDK expects but the language does not
 * provide (console, timers, performance), install every es_* binding, then
 * evaluate the SDK bundle and bootstrap.js. Leaves the packaged project's own
 * scripts and init() to {@link runPackagedGame}.
 */
void initRuntime(HostState& h);

/** Evaluate the packaged project (scripts.js, then init()). Returns false when the
 *  package carries no export to run — already logged. */
bool runPackagedGame(HostState& h);

/** Bind one global function. */
void bindGlobal(HostState& h, JSValue global, const char* name, JSCFunction* fn, int argc);

/** Report a pending JS exception through the platform log, with its stack. */
void logJsError(JSContext* ctx, const char* where);

/** Evaluate a global script; exceptions are logged, not propagated. */
void evalJs(HostState& h, const char* src, const char* name);

/** Call a global function by name; missing is a no-op, exceptions are logged. */
void callJs(HostState& h, const char* fn, int argc, JSValue* argv);

/** One turn of the host's event loop: microtasks, then timers, then whatever
 *  microtasks those timers queued. */
void pumpJs(HostState& h);

// =============================================================================
// Value readers shared by the binding TUs
// =============================================================================

/**
 * Read a byte source into @p out, whatever shape the SDK handed over: a raw
 * ArrayBuffer (audio clip bytes, cache writes), a typed-array view (texture
 * pixels), or a plain JS number array.
 */
void readByteSource(JSContext* ctx, JSValueConst v, std::vector<esengine::u8>& out);

/** A packaged, project-relative file. Empty when missing or before boot. */
std::vector<esengine::u8> readAsset(HostState& h, const char* path);

}  // namespace eshost
