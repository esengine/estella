// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    main_android.cpp
 * @brief   The Android glue for the JS host: NativeActivity, the APK's assets,
 *          Vulkan-backed Dawn, touch, and the ALooper frame loop.
 * @details Everything else — Dawn bring-up, the es_* bindings, the SDK bundle and
 *          the frame — is in host_core.cpp, shared with the iOS glue.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#include <android_native_app_glue.h>
#include <android/log.h>
#include <android/input.h>
#include <android/asset_manager.h>
#include <android/native_window.h>

#include "host_core.hpp"

#define LOG_TAG "EstellaSDK"

using esengine::u32;
using esengine::u8;
using esengine::WebGPUDevice;

namespace {

struct AndroidPlatform final : eshost::Platform {
    AAssetManager* assets = nullptr;        // APK assets/ — the game + its content
    ANativeWindow* window = nullptr;
    std::string cache;                      // app private dir — SDK bytecode cache

    // Read an APK asset (assets/<path>) fully into a buffer; empty if missing.
    std::vector<u8> readAsset(const char* path) override {
        std::vector<u8> out;
        if (!assets) return out;
        AAsset* asset = AAssetManager_open(assets, path, AASSET_MODE_BUFFER);
        if (!asset) return out;
        off_t len = AAsset_getLength(asset);
        if (len > 0) {
            out.resize((size_t)len);
            AAsset_read(asset, out.data(), (size_t)len);
        }
        AAsset_close(asset);
        return out;
    }

    std::string cacheDir() override { return cache; }

    WGPUBackendType backend() const override { return WGPUBackendType_Vulkan; }

    WebGPUDevice::NativeSurface surface() override {
        return {WebGPUDevice::NativeWindowKind::AndroidWindow, window};
    }

    void surfaceSize(u32& width, u32& height) override {
        width = window ? (u32)ANativeWindow_getWidth(window) : 0;
        height = window ? (u32)ANativeWindow_getHeight(window) : 0;
    }

    void log(bool error, const char* message) override {
        __android_log_print(error ? ANDROID_LOG_ERROR : ANDROID_LOG_INFO, LOG_TAG, "%s", message);
    }
};

AndroidPlatform g_platform;

int32_t onInput(android_app*, AInputEvent* ev) {
    if (!eshost::booted() || AInputEvent_getType(ev) != AINPUT_EVENT_TYPE_MOTION) return 0;
    const int32_t action = AMotionEvent_getAction(ev) & AMOTION_EVENT_ACTION_MASK;
    const float x = AMotionEvent_getX(ev, 0);
    const float y = AMotionEvent_getY(ev, 0);
    int type;
    switch (action) {
        case AMOTION_EVENT_ACTION_DOWN:
        case AMOTION_EVENT_ACTION_POINTER_DOWN: type = 0; break;
        case AMOTION_EVENT_ACTION_MOVE:         type = 1; break;
        case AMOTION_EVENT_ACTION_UP:
        case AMOTION_EVENT_ACTION_POINTER_UP:   type = 2; break;
        default:                                type = 3; break;
    }
    eshost::touch(type, 0, x, y);
    return 1;
}

void onAppCmd(android_app* app, int32_t cmd) {
    switch (cmd) {
        case APP_CMD_INIT_WINDOW:
            // First time: boot the engine. Afterwards (screen-on): just rebind the
            // new window surface — the engine + JS World stay alive.
            if (app->window) {
                g_platform.window = app->window;
                if (!eshost::booted()) eshost::boot(g_platform);
                else eshost::bindSurface();
            }
            break;
        case APP_CMD_TERM_WINDOW:
            // Screen-off / backgrounded: the window is gone, stop presenting to it.
            eshost::surfaceLost();
            g_platform.window = nullptr;
            break;
        default:
            break;
    }
}

}  // namespace

void android_main(android_app* app) {
    g_platform.assets = app->activity->assetManager;   // APK assets/ (game.js + content)
    if (app->activity->internalDataPath) g_platform.cache = app->activity->internalDataPath;
    app->onAppCmd = onAppCmd;
    app->onInputEvent = onInput;
    while (true) {
        int events;
        android_poll_source* source;
        // Poll (0) while we can render; block (-1) when there's no surface (screen
        // off) so we wait for the next window event instead of spinning.
        int timeoutMs = (eshost::booted() && eshost::surfaceBound()) ? 0 : -1;
        while (ALooper_pollOnce(timeoutMs, nullptr, &events, (void**)&source) >= 0) {
            if (source) source->process(app, source);
            if (app->destroyRequested) return;
            timeoutMs = 0;
        }
        eshost::frame();
    }
}
