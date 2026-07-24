// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    host_core.hpp
 * @brief   The platform-independent JS host: Dawn bring-up, the es_* native
 *          bindings, the SDK bundle + game boot, and the frame.
 * @details Three layers run a native Estella game, and only the first is C++:
 *          1. This host — boots Dawn, installs the es_* bindings as globals,
 *             feeds host touch to JS, reads packaged assets, and renders.
 *          2. The SDK bundle (dist/index.native.bundled.js, embedded): the real
 *             esengine TS SDK — createNativeApp / World / Input — as `ESEngine`.
 *          3. The game (game.js, a packaged asset loaded at runtime): developer
 *             content. It calls ESEngine.createNativeApp(__esNativeBridge).
 *
 *          Everything that differs between Android and iOS lives behind
 *          {@link eshost::Platform}; the glue (js/main_android.cpp,
 *          js/main_ios.mm) implements it and owns the event loop.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include <string>
#include <vector>

#include "esengine/core/Types.hpp"
#include "esengine/renderer/webgpu/WebGPUDevice.hpp"

namespace eshost {

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
};

/** @brief Boots Dawn, EstellaContext, QuickJS, the SDK bundle and game.js. Call
 *         once, when a window first exists; @p platform must outlive the host.
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

bool booted();

/** Whether a surface is currently bound — false while the window is gone, which is
 *  when an event loop should block for events instead of spinning on frames. */
bool surfaceBound();

}  // namespace eshost
