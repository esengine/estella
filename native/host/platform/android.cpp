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
#include <android/font.h>
#include <android/font_matcher.h>
#include <android/native_window.h>
#include <android/performance_hint.h>
#include <jni.h>
#include <unistd.h>

#include <chrono>
#include <cstdarg>
#include <thread>

#include "Host.hpp"
#include "media/glyph_raster.hpp"   // GLYPH_BOLD / GLYPH_ITALIC, for the font match

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

    // Android's own font matcher (NDK, API 29+) picks the file: it knows the
    // installed families, applies weight/italic, and — the part worth having —
    // falls back per codepoint, so CJK text resolves to Noto without the host
    // hard-coding a single font path.
    eshost::FontFile loadFont(const std::string& family, u32 codepoint, int style) override {
        eshost::FontFile out;
        AFontMatcher* matcher = AFontMatcher_create();
        if (!matcher) return out;
        AFontMatcher_setStyle(matcher, (style & eshost::GLYPH_BOLD) ? AFONT_WEIGHT_BOLD : AFONT_WEIGHT_NORMAL,
                              (style & eshost::GLYPH_ITALIC) != 0);
        // The matcher takes the text to cover as UTF-16; one codepoint is one unit
        // below U+10000 and a surrogate pair above it.
        uint16_t text[2];
        uint32_t length = 0;
        if (codepoint >= 0x10000) {
            const uint32_t v = codepoint - 0x10000;
            text[length++] = (uint16_t)(0xD800 + (v >> 10));
            text[length++] = (uint16_t)(0xDC00 + (v & 0x3FF));
        } else {
            text[length++] = (uint16_t)(codepoint ? codepoint : 'A');
        }
        AFont* font = AFontMatcher_match(matcher, family.empty() ? "sans-serif" : family.c_str(),
                                         text, length, nullptr);
        AFontMatcher_destroy(matcher);
        if (!font) return out;

        if (const char* path = AFont_getFontFilePath(font)) {
            out.path = path;
            out.faceIndex = (int)AFont_getCollectionIndex(font);
            if (FILE* f = fopen(path, "rb")) {
                fseek(f, 0, SEEK_END);
                const long size = ftell(f);
                fseek(f, 0, SEEK_SET);
                if (size > 0) {
                    out.bytes.resize((size_t)size);
                    if (fread(out.bytes.data(), 1, out.bytes.size(), f) != out.bytes.size()) out.bytes.clear();
                }
                fclose(f);
            }
        }
        AFont_close(font);
        if (out.bytes.empty()) out.path.clear();
        return out;
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

// Performance hints (ADPF)
//
// Left to itself the governor infers demand from trailing utilization, which it
// samples over ~200ms — so a steady frame loop reads as ordinary background load
// and settles at a fraction of the available clock, however hard it is working.
// (A touch is what raises the floor, which is why one makes the frame rate jump.)
// A hint session states the thing utilization cannot: this thread has a deadline.
// The loop then reports what each frame actually cost, and the system ramps on
// that instead of on a guess. Busy-waiting to fake demand is the alternative the
// platform documentation explicitly warns against.
struct PerformanceHints {
    APerformanceHintSession* session = nullptr;

    // The host steps the SDK at a fixed 60 Hz, so that is the deadline to state.
    static constexpr int64_t kFrameBudgetNanos = 16'666'667;

    void open() {
        if (__builtin_available(android 31, *)) {
            APerformanceHintManager* manager = APerformanceHint_getManager();
            if (!manager) return;   // no session on a device (or emulator) without one
            // The frame loop's own thread, and it lives as long as the app does —
            // the session wants long-lived tids, not ones that come and go.
            const int32_t tid = static_cast<int32_t>(gettid());
            session = APerformanceHint_createSession(manager, &tid, 1, kFrameBudgetNanos);
        }
        __android_log_print(session ? ANDROID_LOG_INFO : ANDROID_LOG_WARN, LOG_TAG,
                            "perf hints: %s", session ? "session up (ADPF)" : "unavailable");
    }

    void report(std::chrono::steady_clock::duration frame) {
        if (!session) return;
        const auto nanos = std::chrono::duration_cast<std::chrono::nanoseconds>(frame).count();
        if (nanos <= 0) return;   // the API rejects a non-positive duration
        if (__builtin_available(android 31, *)) {
            APerformanceHint_reportActualWorkDuration(session, nanos);
        }
    }

    ~PerformanceHints() {
        if (!session) return;
        if (__builtin_available(android 31, *)) APerformanceHint_closeSession(session);
    }
};

// =============================================================================
// The window a game gets: no system bars, and the display cutout included
// =============================================================================
//
// Left to the platform default, the activity keeps the status bar (clock,
// battery, signal) painted over the game and — since the window never asks for
// the cutout — is letterboxed away from the notch edge, so a 2670px screen hands
// the renderer 2530px. iOS states the same thing declaratively (UIStatusBarHidden
// + prefersStatusBarHidden); this is the Android half of that one decision.
//
// The framework accepts these only on the UI thread, and NativeActivity's own
// callbacks are the one place native code runs there — hence riding
// onWindowFocusChanged, which is also exactly when a sticky-immersive window has
// to hide the bars again (the user swipes them back, or another app hands focus
// over). The glue's own handler is kept and called: it is what posts
// APP_CMD_GAINED_FOCUS to the frame loop.

void (*g_glueWindowFocusChanged)(ANativeActivity*, int) = nullptr;

/** Call `method` on `obj` if this platform version has it; false if it does not
 *  (a missing method leaves a pending exception, which the caller must clear). */
bool callVoidIfPresent(JNIEnv* env, jobject obj, const char* name, const char* sig, ...) {
    jclass cls = env->GetObjectClass(obj);
    const jmethodID method = env->GetMethodID(cls, name, sig);
    env->DeleteLocalRef(cls);
    if (!method) {
        env->ExceptionClear();
        return false;
    }
    va_list args;
    va_start(args, sig);
    env->CallVoidMethodV(obj, method, args);
    va_end(args);
    return true;
}

/** Hide the system bars and take the cutout area, through whichever API this
 *  platform version has: WindowInsetsController from 30, the deprecated
 *  systemUiVisibility flags below it. */
void hideSystemBars(JNIEnv* env, jobject window, jobject decorView) {
    // API 30+. setDecorFitsSystemWindows(false) is what makes the window lay out
    // edge to edge; without it the bars hide but the game keeps their space.
    if (callVoidIfPresent(env, window, "setDecorFitsSystemWindows", "(Z)V", JNI_FALSE)) {
        jclass viewCls = env->GetObjectClass(decorView);
        const jmethodID getController = env->GetMethodID(
            viewCls, "getWindowInsetsController", "()Landroid/view/WindowInsetsController;");
        env->DeleteLocalRef(viewCls);
        if (!getController) { env->ExceptionClear(); return; }
        jobject controller = env->CallObjectMethod(decorView, getController);
        if (!controller) return;

        jclass typeCls = env->FindClass("android/view/WindowInsets$Type");
        const jmethodID systemBars = env->GetStaticMethodID(typeCls, "systemBars", "()I");
        const jint bars = env->CallStaticIntMethod(typeCls, systemBars);
        env->DeleteLocalRef(typeCls);

        callVoidIfPresent(env, controller, "hide", "(I)V", bars);
        // BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE: a swipe from the edge shows the
        // bars over the game for a moment, then they leave again on their own.
        callVoidIfPresent(env, controller, "setSystemBarsBehavior", "(I)V", jint{2});
        env->DeleteLocalRef(controller);
        return;
    }

    // Below 30: View.setSystemUiVisibility. Deprecated, and the only way there.
    constexpr jint LAYOUT_STABLE = 0x0100, LAYOUT_HIDE_NAVIGATION = 0x0200,
                   LAYOUT_FULLSCREEN = 0x0400, HIDE_NAVIGATION = 0x0002,
                   FULLSCREEN = 0x0004, IMMERSIVE_STICKY = 0x1000;
    callVoidIfPresent(env, decorView, "setSystemUiVisibility", "(I)V",
                      LAYOUT_STABLE | LAYOUT_HIDE_NAVIGATION | LAYOUT_FULLSCREEN
                          | HIDE_NAVIGATION | FULLSCREEN | IMMERSIVE_STICKY);
}

/** Let the window lay out into the display cutout (API 28+), so the renderer is
 *  handed the whole screen instead of the letterbox beside the notch. */
void useDisplayCutout(JNIEnv* env, jobject window) {
    jclass windowCls = env->GetObjectClass(window);
    const jmethodID getAttributes = env->GetMethodID(
        windowCls, "getAttributes", "()Landroid/view/WindowManager$LayoutParams;");
    env->DeleteLocalRef(windowCls);
    if (!getAttributes) { env->ExceptionClear(); return; }

    jobject params = env->CallObjectMethod(window, getAttributes);
    if (!params) return;
    jclass paramsCls = env->GetObjectClass(params);
    const jfieldID mode = env->GetFieldID(paramsCls, "layoutInDisplayCutoutMode", "I");
    env->DeleteLocalRef(paramsCls);
    if (mode) {
        env->SetIntField(params, mode, 1);   // LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        callVoidIfPresent(env, window, "setAttributes", "(Landroid/view/WindowManager$LayoutParams;)V", params);
    } else {
        env->ExceptionClear();   // pre-28: no such field, and no cutout to take
    }
    env->DeleteLocalRef(params);
}

void onWindowFocusChanged(ANativeActivity* activity, int hasFocus) {
    // activity->env is the UI thread's JNI context, which is the thread this
    // callback arrives on — no attach, and the locals below are freed on return.
    if (hasFocus && activity->env) {
        JNIEnv* env = activity->env;
        jclass activityCls = env->GetObjectClass(activity->clazz);
        const jmethodID getWindow = env->GetMethodID(activityCls, "getWindow", "()Landroid/view/Window;");
        env->DeleteLocalRef(activityCls);
        if (getWindow) {
            jobject window = env->CallObjectMethod(activity->clazz, getWindow);
            if (window) {
                useDisplayCutout(env, window);
                jclass windowCls = env->GetObjectClass(window);
                const jmethodID getDecorView = env->GetMethodID(windowCls, "getDecorView", "()Landroid/view/View;");
                env->DeleteLocalRef(windowCls);
                if (getDecorView) {
                    jobject decorView = env->CallObjectMethod(window, getDecorView);
                    if (decorView) {
                        hideSystemBars(env, window, decorView);
                        env->DeleteLocalRef(decorView);
                    }
                } else {
                    env->ExceptionClear();
                }
                env->DeleteLocalRef(window);
            }
        } else {
            env->ExceptionClear();
        }
    }
    if (g_glueWindowFocusChanged) g_glueWindowFocusChanged(activity, hasFocus);
}

}  // namespace

void android_main(android_app* app) {
    g_platform.assets = app->activity->assetManager;   // APK assets/ (the exported project)
    g_platform.vm = app->activity->vm;                  // for JNI HttpURLConnection (es_fetch)
    if (app->activity->internalDataPath) g_platform.cache = app->activity->internalDataPath;
    app->onAppCmd = onAppCmd;
    app->onInputEvent = onInput;
    // Chained, not replaced: the glue's handler is what wakes the frame loop on
    // focus. Installed before the activity can be focused, so the first callback
    // already goes through ours.
    g_glueWindowFocusChanged = app->activity->callbacks->onWindowFocusChanged;
    app->activity->callbacks->onWindowFocusChanged = onWindowFocusChanged;
    PerformanceHints hints;
    hints.open();
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
        // Timed around the frame alone: the poll above blocks while the screen is
        // off, and reporting that wait as work would tell the system this frame
        // took seconds.
        const auto begin = std::chrono::steady_clock::now();
        eshost::frame();
        hints.report(std::chrono::steady_clock::now() - begin);
    }
}
