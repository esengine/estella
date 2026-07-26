// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Host.hpp
 * @brief   The host's public contract: the platform seam every OS answers, and
 *          the handful of entry points its event loop drives.
 * @details Three layers run a native Estella game, and only the first is C++:
 *          1. This host — boots Dawn, installs the es_* bindings as globals,
 *             feeds host touch to JS, reads packaged assets, and renders.
 *          2. The SDK bundle (dist/index.native.bundled.js, embedded): the real
 *             esengine TS SDK — createNativeApp / World / Input — as `ESEngine`.
 *          3. The game: an editor export (game.config.json + cooked assets +
 *             scenes) packaged with the app, booted by bootstrap.js through
 *             ESEngine.initNativeGame.
 *
 *          The host itself is split by concern: Runtime.hpp owns the QuickJS
 *          runtime and the shared state, bindings/ owns the es_* surface (one TU
 *          per pillar), and Host.cpp owns boot, the frame and lifecycle.
 *          Everything that differs between Android and iOS lives behind
 *          {@link eshost::Platform}; the glue (platform/android.cpp,
 *          platform/ios.mm) implements it and owns the event loop.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include <string>
#include <utility>
#include <vector>

#include "esengine/core/Types.hpp"
#include "esengine/renderer/webgpu/WebGPUDevice.hpp"

namespace eshost {

/** One HTTP request the host performs off the main thread. `id` matches the
 *  reply back to its JS callback; `wantText` selects a string vs ArrayBuffer body. */
struct FetchRequest {
    int id = 0;
    std::string method;     ///< GET / POST / ...
    std::string url;
    std::vector<std::pair<std::string, std::string>> headers;
    std::vector<esengine::u8> body;
    bool wantText = false;
};

/** The reply the platform hands back via {@link deliverFetch}. A non-empty
 *  `error` rejects the JS promise; otherwise the body is delivered per `isText`. */
struct FetchResult {
    int id = 0;
    bool ok = false;
    int status = 0;
    std::string statusText;
    std::vector<std::pair<std::string, std::string>> headers;
    std::vector<esengine::u8> body;
    bool isText = false;
    std::string error;
};

/**
 * A font file the glyph rasterizer can parse. `path` identifies it (the cache
 * key — empty means the platform found nothing), `faceIndex` selects a face
 * inside a collection (.ttc), and `bytes` is the file, read only the first time
 * a path is seen.
 */
struct FontFile {
    std::string path;
    std::vector<esengine::u8> bytes;
    int faceIndex = 0;
};

/**
 * @brief The platform seam: what the host needs that Android and iOS answer
 *        differently. The glue implements it; host_core owns everything else.
 */
struct Platform {
    virtual ~Platform() = default;

    /** A packaged, project-relative file — the APK's `assets/` on Android, the
     *  app bundle on iOS. Empty when missing. Backs NativeBridge.readFile. */
    virtual std::vector<esengine::u8> readAsset(const char* path) = 0;

    /** Writable private directory for the SDK bytecode cache; empty disables it. */
    virtual std::string cacheDir() = 0;

    /** The backend Dawn must pick: Vulkan on Android, Metal on iOS. */
    virtual WGPUBackendType backend() const = 0;

    /** The live window (`ANativeWindow*` / `CAMetalLayer*`) and its pixel size. */
    virtual esengine::WebGPUDevice::NativeSurface surface() = 0;
    virtual void surfaceSize(esengine::u32& width, esengine::u32& height) = 0;

    virtual void log(bool error, const char* message) = 0;

    /** A font for @p family that covers @p codepoint, with @p style's bold/italic
     *  bits (see GLYPH_BOLD / GLYPH_ITALIC) applied to the match. Empty `path`
     *  when the platform has nothing — the glyph then simply does not draw.
     *
     *  This is the ONLY per-OS part of text: which file to open. Android asks its
     *  font matcher (which handles CJK fallback), iOS asks Core Text; the
     *  rasterization and the SDF conversion are shared (see media/glyph_raster.hpp). */
    virtual FontFile loadFont(const std::string& family, esengine::u32 codepoint, int style) = 0;

    /** Perform an HTTP request off the main thread (NSURLSession / a JNI
     *  HttpURLConnection), then hand the reply back through {@link deliverFetch}
     *  with the same `req.id`. The OS owns the TLS stack, so this is where native
     *  networking necessarily differs between iOS and Android. */
    virtual void startFetch(const FetchRequest& req) = 0;

    /**
     * The OS text-editing surface: a soft keyboard with its IME. A platform that
     * has one overrides these and reports what the user did through
     * {@link deliverTextEditorState} / Submit / Cancel; one that does not leaves
     * the defaults, `hasTextEditor()` stays false, the es_textEditor_* entry
     * points are never bound, and the SDK sees a realm where fields render but
     * cannot be typed into.
     *
     * The surface OWNS the value and the selection while a field is focused —
     * an IME composes into it, and the app's own edits go through `write`.
     */
    virtual bool hasTextEditor() const { return false; }
    virtual void textEditorFocus(const std::string& /*value*/, int /*selectionStart*/,
                                 int /*selectionEnd*/, bool /*multiline*/,
                                 int /*maxLength*/, bool /*password*/) {}
    virtual void textEditorBlur() {}
    virtual void textEditorWrite(const std::string& /*value*/, int /*selectionStart*/,
                                 int /*selectionEnd*/) {}
};

/** Deliver an HTTP reply for a {@link Platform::startFetch}. Thread-safe: the
 *  platform calls it from whatever thread its completion runs on; the result is
 *  queued and the JS callback runs on the next frame, on the JS thread. */
void deliverFetch(FetchResult result);

/** The editing surface's whole state, after the user (or its IME) changed it.
 *  Thread-safe, like {@link deliverFetch}: the platform calls it from its UI
 *  thread and the JS side is told on the next frame. `composing` is true while an
 *  IME preedit sits inside `value`. */
void deliverTextEditorState(std::string value, int selectionStart, int selectionEnd, bool composing);
/** The keyboard's done/go key on a single-line field. Thread-safe. */
void deliverTextEditorSubmit();
/** The keyboard was dismissed without committing (back gesture, done). Thread-safe. */
void deliverTextEditorCancel();

/** @brief Boots Dawn, EstellaContext, QuickJS, the SDK bundle and the packaged
 *         project. Call once, when a window first exists; @p platform must
 *         outlive the host.
 *  @return false if any stage failed (the reason is already logged). */
bool boot(Platform& platform);

/** @brief (Re)binds the swapchain to Platform::surface(). Needed on first boot and
 *         again whenever the window is recreated — an Android screen-off/on
 *         destroys it, an iOS layer resize invalidates its size. */
bool bindSurface();

/** @brief The window is gone (backgrounded / screen off); stop presenting until
 *         the next bindSurface(). The engine and the JS World stay alive. */
void surfaceLost();

/** @brief Runs the game's update + one rendered, presented frame. No-op until
 *         boot() has succeeded and a surface is bound. */
void frame();

/** @brief Feeds one touch to the game. @p type: 0 start / 1 move / 2 end / 3 cancel.
 *         Coordinates are in surface pixels, top-left origin (as on the web). */
void touch(int type, int id, float x, float y);

/** @brief The app went to background (@p visible false) or returned to foreground.
 *         Suspends/resumes the audio device natively and pushes the signal to JS,
 *         where the Lifecycle plugin auto-pauses the game. No-op before boot. */
void setVisible(bool visible);

/** @brief The OS reported memory pressure; asks the SDK's residency caches to
 *         drop evictable entries (the audio buffer cache). No-op before boot. */
void memoryWarning();

bool booted();

/** Whether a surface is currently bound — false while the window is gone, which is
 *  when an event loop should block for events instead of spinning on frames. */
bool surfaceBound();

}  // namespace eshost
