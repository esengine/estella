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
#include <jni.h>

#include <thread>

#include "host_core.hpp"

#define LOG_TAG "EstellaSDK"

using esengine::u32;
using esengine::u8;
using esengine::WebGPUDevice;

namespace {

// Read a java.io.InputStream fully into `out`, reusing one byte[] buffer.
void jniReadStream(JNIEnv* env, jobject stream, std::vector<u8>& out) {
    if (!stream) return;
    jclass isCls = env->GetObjectClass(stream);
    jmethodID readM = env->GetMethodID(isCls, "read", "([B)I");
    jbyteArray buf = env->NewByteArray(16384);
    while (true) {
        jint n = env->CallIntMethod(stream, readM, buf);
        if (env->ExceptionCheck()) { env->ExceptionClear(); break; }
        if (n <= 0) break;
        jbyte* elems = env->GetByteArrayElements(buf, nullptr);
        out.insert(out.end(), reinterpret_cast<u8*>(elems), reinterpret_cast<u8*>(elems) + n);
        env->ReleaseByteArrayElements(buf, elems, JNI_ABORT);
    }
    jmethodID closeM = env->GetMethodID(isCls, "close", "()V");
    env->CallVoidMethod(stream, closeM);
    if (env->ExceptionCheck()) env->ExceptionClear();
    env->DeleteLocalRef(buf);
    env->DeleteLocalRef(isCls);
}

// Perform one HTTP request through java.net.HttpURLConnection (the OS owns TLS).
// Runs on a JNI-attached background thread; fills `r`.
void performHttp(JNIEnv* env, const eshost::FetchRequest& req, eshost::FetchResult& r) {
    jclass urlCls = env->FindClass("java/net/URL");
    jstring jurl = env->NewStringUTF(req.url.c_str());
    jobject urlObj = env->NewObject(urlCls, env->GetMethodID(urlCls, "<init>", "(Ljava/lang/String;)V"), jurl);
    env->DeleteLocalRef(jurl);
    if (env->ExceptionCheck() || !urlObj) { env->ExceptionClear(); r.error = "invalid url"; env->DeleteLocalRef(urlCls); return; }

    jobject conn = env->CallObjectMethod(urlObj, env->GetMethodID(urlCls, "openConnection", "()Ljava/net/URLConnection;"));
    env->DeleteLocalRef(urlObj);
    env->DeleteLocalRef(urlCls);
    if (env->ExceptionCheck() || !conn) { env->ExceptionClear(); r.error = "openConnection failed"; return; }

    jclass httpCls = env->FindClass("java/net/HttpURLConnection");
    jstring jmethod = env->NewStringUTF(req.method.c_str());
    env->CallVoidMethod(conn, env->GetMethodID(httpCls, "setRequestMethod", "(Ljava/lang/String;)V"), jmethod);
    env->DeleteLocalRef(jmethod);
    if (env->ExceptionCheck()) env->ExceptionClear();

    jmethodID setPropM = env->GetMethodID(httpCls, "setRequestProperty", "(Ljava/lang/String;Ljava/lang/String;)V");
    for (const auto& kv : req.headers) {
        jstring k = env->NewStringUTF(kv.first.c_str());
        jstring v = env->NewStringUTF(kv.second.c_str());
        env->CallVoidMethod(conn, setPropM, k, v);
        env->DeleteLocalRef(k);
        env->DeleteLocalRef(v);
    }
    if (env->ExceptionCheck()) env->ExceptionClear();

    if (!req.body.empty()) {
        env->CallVoidMethod(conn, env->GetMethodID(httpCls, "setDoOutput", "(Z)V"), JNI_TRUE);
        jobject os = env->CallObjectMethod(conn, env->GetMethodID(httpCls, "getOutputStream", "()Ljava/io/OutputStream;"));
        if (!env->ExceptionCheck() && os) {
            jbyteArray b = env->NewByteArray(static_cast<jsize>(req.body.size()));
            env->SetByteArrayRegion(b, 0, static_cast<jsize>(req.body.size()), reinterpret_cast<const jbyte*>(req.body.data()));
            jclass osCls = env->GetObjectClass(os);
            env->CallVoidMethod(os, env->GetMethodID(osCls, "write", "([B)V"), b);
            env->CallVoidMethod(os, env->GetMethodID(osCls, "close", "()V"));
            env->DeleteLocalRef(b);
            env->DeleteLocalRef(osCls);
            env->DeleteLocalRef(os);
        }
        if (env->ExceptionCheck()) env->ExceptionClear();
    }

    jint code = env->CallIntMethod(conn, env->GetMethodID(httpCls, "getResponseCode", "()I"));
    if (env->ExceptionCheck()) { env->ExceptionClear(); r.error = "no response"; env->DeleteLocalRef(httpCls); env->DeleteLocalRef(conn); return; }
    r.status = static_cast<int>(code);
    r.ok = code >= 200 && code < 300;

    jmethodID keyM = env->GetMethodID(httpCls, "getHeaderFieldKey", "(I)Ljava/lang/String;");
    jmethodID valM = env->GetMethodID(httpCls, "getHeaderField", "(I)Ljava/lang/String;");
    for (int i = 0; i < 64; ++i) {
        jstring k = static_cast<jstring>(env->CallObjectMethod(conn, keyM, i));
        jstring v = static_cast<jstring>(env->CallObjectMethod(conn, valM, i));
        if (!k && !v) { break; }
        if (k && v) {
            const char* kc = env->GetStringUTFChars(k, nullptr);
            const char* vc = env->GetStringUTFChars(v, nullptr);
            r.headers.emplace_back(kc ? kc : "", vc ? vc : "");
            if (kc) env->ReleaseStringUTFChars(k, kc);
            if (vc) env->ReleaseStringUTFChars(v, vc);
        }
        if (k) env->DeleteLocalRef(k);
        if (v) env->DeleteLocalRef(v);
    }

    jobject stream = env->CallObjectMethod(conn, env->GetMethodID(httpCls,
        r.ok ? "getInputStream" : "getErrorStream", "()Ljava/io/InputStream;"));
    if (env->ExceptionCheck()) { env->ExceptionClear(); stream = nullptr; }
    jniReadStream(env, stream, r.body);
    if (stream) env->DeleteLocalRef(stream);

    env->CallVoidMethod(conn, env->GetMethodID(httpCls, "disconnect", "()V"));
    if (env->ExceptionCheck()) env->ExceptionClear();
    env->DeleteLocalRef(httpCls);
    env->DeleteLocalRef(conn);
}

struct AndroidPlatform final : eshost::Platform {
    AAssetManager* assets = nullptr;        // APK assets/ — the game + its content
    ANativeWindow* window = nullptr;
    JavaVM* vm = nullptr;                    // for JNI HttpURLConnection off-thread
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

    // A detached JNI thread runs the request; deliverFetch is thread-safe and the
    // JS callback runs back on the main thread in drainFetches.
    void startFetch(const eshost::FetchRequest& req) override {
        JavaVM* jvm = vm;
        if (!jvm) {
            eshost::FetchResult r; r.id = req.id; r.isText = req.wantText; r.error = "no JavaVM";
            eshost::deliverFetch(std::move(r));
            return;
        }
        std::thread([jvm, req]() {
            eshost::FetchResult r;
            r.id = req.id;
            r.isText = req.wantText;
            JNIEnv* env = nullptr;
            if (jvm->AttachCurrentThread(&env, nullptr) == JNI_OK && env) {
                performHttp(env, req, r);
                jvm->DetachCurrentThread();
            } else {
                r.error = "jni attach failed";
            }
            eshost::deliverFetch(std::move(r));
        }).detach();
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
        case APP_CMD_PAUSE:
            eshost::setVisible(false);   // suspend audio + auto-pause the game
            break;
        case APP_CMD_RESUME:
            eshost::setVisible(true);
            break;
        case APP_CMD_LOW_MEMORY:
            eshost::memoryWarning();     // SDK residency caches trim
            break;
        default:
            break;
    }
}

}  // namespace

void android_main(android_app* app) {
    g_platform.assets = app->activity->assetManager;   // APK assets/ (game.js + content)
    g_platform.vm = app->activity->vm;                  // for JNI HttpURLConnection (es_fetch)
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
