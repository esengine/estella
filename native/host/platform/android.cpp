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
#include <dlfcn.h>
#include <android/log.h>
#include <sys/system_properties.h>
#include <android/input.h>
#include <android/asset_manager.h>
#include <android/font.h>
#include <android/font_matcher.h>
#include <android/native_window.h>
#include <android/choreographer.h>
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
    std::string cache;                      // getCacheDir() — the system may reclaim it
    std::string data;                       // internalDataPath — files/, survives
    std::string logs;                       // Android/data/<pkg>/files — a player can open this

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

    std::string dataDir() override { return data; }

    std::string logDir() override { return logs; }

    /**
     * `Android/media/<pkg>/` first, then Downloads.
     *
     * An app's own directory under `Android/media` belongs to the shared media
     * collection rather than to app-private storage: a file manager lists it, and
     * ordinary file IO can write it with no permission and no MediaStore round
     * trip. `Android/data` — where the record itself lives — is none of those
     * things since Android 11. Downloads is the fallback for devices that still
     * allow a direct write there; both are tried and whichever works is recorded.
     */
    std::vector<std::string> publicDirs() override {
        std::vector<std::string> out;
        // externalDataPath is <root>/Android/data/<pkg>/files; its sibling under
        // Android/media is the same package's public corner.
        const std::string mark = "/Android/data/";
        const size_t at = logs.find(mark);
        if (at != std::string::npos) {
            std::string pkg = logs.substr(at + mark.size());
            const size_t slash = pkg.find('/');
            if (slash != std::string::npos) pkg = pkg.substr(0, slash);
            out.push_back(logs.substr(0, at) + "/Android/media/" + pkg);
            out.push_back(logs.substr(0, at) + "/Download");
        }
        return out;
    }

    /** Model, Android release and ABI, from the system properties every device
     *  answers — no JNI round trip, so this works before anything else is up. */
    std::string describe() override {
        char model[PROP_VALUE_MAX] = {0}, release[PROP_VALUE_MAX] = {0}, abi[PROP_VALUE_MAX] = {0};
        __system_property_get("ro.product.model", model);
        __system_property_get("ro.build.version.release", release);
        __system_property_get("ro.product.cpu.abi", abi);
        return std::string(model) + ", Android " + release + ", " + abi;
    }

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

        // What the matcher actually gave us: the system font is a single variable
        // file, so a bold request comes back as the regular instance and the
        // rasterizer has to embolden it itself.
        const bool wantBold = (style & eshost::GLYPH_BOLD) != 0;
        const bool wantItalic = (style & eshost::GLYPH_ITALIC) != 0;
        out.syntheticBold = wantBold && AFont_getWeight(font) < AFONT_WEIGHT_SEMI_BOLD;
        out.syntheticItalic = wantItalic && !AFont_isItalic(font);

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

    // -- The editing surface: com.estella.host.TextEditor ---------------------
    //
    // An IME commits composed text through an InputConnection, which only a Java
    // View has — so the keyboard's own side of a field is a small Java class in
    // the APK, and this is the call across. The class handles its own threading
    // (every method posts to the UI thread), so these can be called from the
    // frame loop like any other platform call.

    /** Set once the shim class is loaded and its natives registered (UI thread). */
    jobject editor = nullptr;          // global ref to the TextEditor instance
    jmethodID editorFocus = nullptr;
    jmethodID editorBlur = nullptr;
    jmethodID editorWrite = nullptr;

    bool hasTextEditor() const override { return editor != nullptr; }

    void textEditorFocus(const std::string& value, int selectionStart, int selectionEnd,
                         bool multiline, int maxLength, bool password) override {
        withEditor([&](JNIEnv* env) {
            jstring text = env->NewStringUTF(value.c_str());
            env->CallVoidMethod(editor, editorFocus, text, (jint)selectionStart, (jint)selectionEnd,
                                (jboolean)multiline, (jint)maxLength, (jboolean)password);
            env->DeleteLocalRef(text);
        });
    }

    void textEditorBlur() override {
        withEditor([&](JNIEnv* env) { env->CallVoidMethod(editor, editorBlur); });
    }

    void textEditorWrite(const std::string& value, int selectionStart, int selectionEnd) override {
        withEditor([&](JNIEnv* env) {
            jstring text = env->NewStringUTF(value.c_str());
            env->CallVoidMethod(editor, editorWrite, text, (jint)selectionStart, (jint)selectionEnd);
            env->DeleteLocalRef(text);
        });
    }

    /** Run `body` with a JNIEnv for THIS thread (the frame loop's, which is not
     *  the UI thread — the shim posts from there). */
    template <typename F>
    void withEditor(F&& body) {
        if (!editor || !vm) return;
        JNIEnv* env = nullptr;
        if (vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK) {
            if (vm->AttachCurrentThread(&env, nullptr) != JNI_OK || !env) return;
        }
        body(env);
        if (env->ExceptionCheck()) {
            env->ExceptionDescribe();
            env->ExceptionClear();
        }
    }
};

AndroidPlatform g_platform;

// -- The shim's reports, on the UI thread -------------------------------------
// Queued as POD; the frame loop hands them to JS (see TextEditorBindings.cpp).

void jniTextState(JNIEnv* env, jclass, jstring value, jint selectionStart, jint selectionEnd,
                  jboolean composing) {
    const char* utf8 = value ? env->GetStringUTFChars(value, nullptr) : nullptr;
    eshost::deliverTextEditorState(utf8 ? utf8 : "", (int)selectionStart, (int)selectionEnd,
                                   composing != JNI_FALSE);
    if (utf8) env->ReleaseStringUTFChars(value, utf8);
}

void jniTextSubmit(JNIEnv*, jclass) { eshost::deliverTextEditorSubmit(); }
void jniTextCancel(JNIEnv*, jclass) { eshost::deliverTextEditorCancel(); }

/**
 * Load com.estella.host.TextEditor, register its natives and construct it.
 *
 * Runs on the frame-loop thread, before boot binds the es_textEditor_* entry
 * points — the surface has to exist by then or the SDK correctly concludes there
 * is none. FindClass would fail here (off the UI thread it resolves through the
 * SYSTEM class loader, which knows nothing of the APK), so the app's own loader
 * is asked by name instead. Nothing touches a View: the shim posts all of that
 * to the UI thread itself.
 */
void attachTextEditor(ANativeActivity* activity) {
    if (g_platform.editor || !activity->vm) return;
    JNIEnv* env = nullptr;
    if (activity->vm->AttachCurrentThread(&env, nullptr) != JNI_OK || !env) return;

    jclass activityCls = env->GetObjectClass(activity->clazz);
    const jmethodID getClassLoader =
        env->GetMethodID(activityCls, "getClassLoader", "()Ljava/lang/ClassLoader;");
    env->DeleteLocalRef(activityCls);
    if (!getClassLoader) { env->ExceptionClear(); return; }
    jobject loader = env->CallObjectMethod(activity->clazz, getClassLoader);
    jclass loaderCls = env->FindClass("java/lang/ClassLoader");
    const jmethodID loadClass =
        env->GetMethodID(loaderCls, "loadClass", "(Ljava/lang/String;)Ljava/lang/Class;");
    env->DeleteLocalRef(loaderCls);
    jstring name = env->NewStringUTF("com.estella.host.TextEditor");
    jclass cls = (jclass)env->CallObjectMethod(loader, loadClass, name);
    env->DeleteLocalRef(name);
    env->DeleteLocalRef(loader);
    if (!cls || env->ExceptionCheck()) {
        env->ExceptionClear();
        __android_log_print(ANDROID_LOG_WARN, LOG_TAG,
                            "text editor: com.estella.host.TextEditor not in the APK — typing is off");
        return;
    }
    const JNINativeMethod natives[] = {
        {"nativeState", "(Ljava/lang/String;IIZ)V", (void*)jniTextState},
        {"nativeSubmit", "()V", (void*)jniTextSubmit},
        {"nativeCancel", "()V", (void*)jniTextCancel},
    };
    if (env->RegisterNatives(cls, natives, 3) != JNI_OK) {
        env->ExceptionClear();
        env->DeleteLocalRef(cls);
        return;
    }

    const jmethodID ctor = env->GetMethodID(cls, "<init>", "(Landroid/app/Activity;)V");
    g_platform.editorFocus = env->GetMethodID(cls, "focus", "(Ljava/lang/String;IIZIZ)V");
    g_platform.editorBlur = env->GetMethodID(cls, "blur", "()V");
    g_platform.editorWrite = env->GetMethodID(cls, "write", "(Ljava/lang/String;II)V");
    if (!ctor || !g_platform.editorFocus || !g_platform.editorBlur || !g_platform.editorWrite) {
        env->ExceptionClear();
        env->DeleteLocalRef(cls);
        return;
    }
    jobject instance = env->NewObject(cls, ctor, activity->clazz);
    if (instance) g_platform.editor = env->NewGlobalRef(instance);
    if (instance) env->DeleteLocalRef(instance);
    env->DeleteLocalRef(cls);
    __android_log_print(ANDROID_LOG_INFO, LOG_TAG, "text editor: soft keyboard up (IME)");
}

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

// Asking for frames, and stopping. Declared here so the lifecycle handler below
// reads in the order things happen rather than after the machinery it drives —
// see FrameDriver.
void framesSurface(bool has);
void framesResumed(bool is);

void onAppCmd(android_app* app, int32_t cmd) {
    switch (cmd) {
        case APP_CMD_INIT_WINDOW:
            // First time: boot the engine. Afterwards (screen-on): just rebind the
            // new window surface — the engine + JS World stay alive.
            if (app->window) {
                g_platform.window = app->window;
                if (!eshost::booted()) eshost::boot(g_platform);
                else eshost::bindSurface();
                // Ask for frames only once there is something to present to, the
                // same order iOS unpauses its display link in.
                framesSurface(eshost::surfaceBound());
            }
            break;
        case APP_CMD_TERM_WINDOW:
            // Screen-off / backgrounded: the window is gone, stop presenting to it.
            framesSurface(false);
            eshost::surfaceLost();
            g_platform.window = nullptr;
            break;
        case APP_CMD_PAUSE:
            framesResumed(false);        // and stop drawing one nobody is looking at
            eshost::setVisible(false);   // suspend audio + auto-pause the game
            break;
        case APP_CMD_RESUME:
            framesResumed(true);
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
//
// Resolved by hand, through dlsym, rather than called directly.
//
// ADPF is API 33 and this host builds against the manifest's floor, so the NDK
// marks those four symbols `unavailable`: a hard compile error, and no
// `__builtin_available` guard changes that — the annotation is not "call me
// under a check", it is "this build cannot see me". Raising the build target is
// what makes them callable, and that is precisely the mistake being fixed here:
// at android-33 every availability guard in this file became dead code and every
// guarded symbol became a load-time requirement, so the released host could not
// dlopen on Android 10 or 11 at all.
//
// The NDK's own answer is ANDROID_WEAK_API_DEFS, which turns such symbols into
// weak references. Looking them up here instead keeps the decision in the code
// that depends on it, where it is visible, rather than in a toolchain flag whose
// absence would silently restore the same class of failure.
struct PerformanceHints {
    void* session = nullptr;

    // One display refresh. The Choreographer is what calls the frame, so the
    // deadline is the panel's cadence, whatever it happens to be.
    static constexpr int64_t kFrameBudgetNanos = 16'666'667;

    // Opaque on purpose: the header's typedefs come with the same availability
    // annotations, and nothing here needs to know what a session is.
    using GetManagerFn = void* (*)();
    using CreateSessionFn = void* (*)(void*, const int32_t*, size_t, int64_t);
    using ReportFn = int (*)(void*, int64_t);
    using CloseFn = void (*)(void*);

    ReportFn reportFn = nullptr;
    CloseFn closeFn = nullptr;

    void open() {
        // RTLD_DEFAULT: libandroid is already loaded — this asks whether THIS
        // platform version exports the symbols, which is the actual question.
        const auto getManager = reinterpret_cast<GetManagerFn>(
            dlsym(RTLD_DEFAULT, "APerformanceHint_getManager"));
        const auto createSession = reinterpret_cast<CreateSessionFn>(
            dlsym(RTLD_DEFAULT, "APerformanceHint_createSession"));
        reportFn = reinterpret_cast<ReportFn>(
            dlsym(RTLD_DEFAULT, "APerformanceHint_reportActualWorkDuration"));
        closeFn = reinterpret_cast<CloseFn>(
            dlsym(RTLD_DEFAULT, "APerformanceHint_closeSession"));

        if (getManager && createSession && reportFn && closeFn) {
            if (void* manager = getManager()) {
                // The frame loop's own thread, and it lives as long as the app
                // does — the session wants long-lived tids, not ones that come
                // and go.
                const int32_t tid = static_cast<int32_t>(gettid());
                session = createSession(manager, &tid, 1, kFrameBudgetNanos);
            }
        }
        __android_log_print(session ? ANDROID_LOG_INFO : ANDROID_LOG_WARN, LOG_TAG,
                            "perf hints: %s", session ? "session up (ADPF)" : "unavailable");
    }

    void report(std::chrono::steady_clock::duration frame) {
        if (!session) return;
        const auto nanos = std::chrono::duration_cast<std::chrono::nanoseconds>(frame).count();
        if (nanos <= 0) return;   // the API rejects a non-positive duration
        reportFn(session, nanos);
    }

    ~PerformanceHints() {
        if (session) closeFn(session);
    }
};

// =============================================================================
// The frame source
// =============================================================================
//
// The display drives the frame, and nothing else does. That is what iOS already
// says with a CADisplayLink and what the web says with requestAnimationFrame;
// this is the Android third of the same sentence, and it is a Choreographer.
//
// It replaces a loop that polled with a zero timeout and called frame()
// immediately, forever, trusting the swapchain's FIFO present to be the thing
// that blocked. That holds right up until a present does NOT block — a surface
// mid-teardown answers "GetCurrentTexture was not called this frame prior to
// Present" and returns — and then the only brake is gone and the loop runs as
// fast as the CPU allows. One backgrounded app was measured 11.5 million frames
// in, holding a quarter of a core to render about one frame a second. A vsync
// source cannot fail that way: no callback, no frame.
//
// Two conditions, both required, exactly the pair iOS pauses its display link on:
// there has to be a surface to present to, and the activity has to be the one the
// user is looking at. Either alone is not enough — pressing HOME leaves the
// surface alive, so a driver gated on the surface only goes on rendering the game
// at the full panel rate onto a window nobody can see. (Measured: 121 fps from the
// home screen.) The host already treats PAUSE as "not visible" by suspending audio
// and the game clock; this makes rendering agree with the other two.
struct FrameDriver {
    AChoreographer* choreographer = nullptr;
    PerformanceHints* hints = nullptr;
    /// A callback is in flight. Guards against posting twice for one vsync, which
    /// would double the frame rate for as long as both chains lived.
    bool posted = false;
    bool hasSurface = false;
    /// Starts true, and only APP_CMD_PAUSE clears it. Waiting for a RESUME to
    /// arrive first is what broke this once: a launch that never delivered one
    /// left the gate shut and the game rendered nothing at all. The safe default
    /// is the one whose failure is recoverable — a missed RESUME then costs
    /// nothing, where a missed PAUSE is the thing actually being guarded against,
    /// and PAUSE always arrives because the OS is what sends it.
    bool resumed = true;
    /// Derived from the two above; kept so a callback already in flight can tell
    /// it was cancelled.
    bool running = false;

    /// Must be called on the thread that will receive callbacks (the glue's own,
    /// which has a prepared looper).
    void attach() {
        choreographer = AChoreographer_getInstance();
        if (!choreographer) {
            __android_log_print(ANDROID_LOG_ERROR, LOG_TAG,
                                "no Choreographer on this thread — nothing will drive frames");
        }
    }

    void setSurface(bool has) { hasSurface = has; sync(); }
    void setResumed(bool is) { resumed = is; sync(); }

    /// Start or stop asking for frames, to match the two conditions. An already
    /// posted callback still arrives and is ignored — there is no API to cancel
    /// one, and dropping it is what pausing means anyway.
    void sync() {
        const bool want = hasSurface && resumed;
        if (want == running) return;
        running = want;
        // Transitions only, so this is a handful of lines per run — and it is the
        // one place that can explain a black screen, which is otherwise silent.
        __android_log_print(ANDROID_LOG_INFO, LOG_TAG, "frames: %s (surface=%d resumed=%d)",
                            running ? "running" : "paused", (int)hasSurface, (int)resumed);
        if (running) post();
    }

    void post() {
        if (!choreographer || posted || !running) return;
        posted = true;
        if (__builtin_available(android 29, *)) {
            AChoreographer_postFrameCallback64(choreographer, &FrameDriver::onVsync64, this);
        } else {
            // Deprecated in 29 and the only one that exists below it. minSdk is 26,
            // so this branch is the two releases the 64-bit call cannot serve — not
            // an oversight, which is why the warning is turned off rather than the
            // call changed.
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
            AChoreographer_postFrameCallback(choreographer, &FrameDriver::onVsync32, this);
#pragma clang diagnostic pop
        }
    }

private:
    void tick() {
        posted = false;
        if (!running) return;
        // Timed around the frame alone, and re-posted after it: asking for the
        // next vsync first would let a frame that overran queue behind itself.
        const auto begin = std::chrono::steady_clock::now();
        eshost::frame();
        if (hints) hints->report(std::chrono::steady_clock::now() - begin);
        post();
    }

    static void onVsync64(int64_t, void* data) { static_cast<FrameDriver*>(data)->tick(); }
    static void onVsync32(long, void* data) { static_cast<FrameDriver*>(data)->tick(); }
};

FrameDriver g_frames;

void framesSurface(bool has) { g_frames.setSurface(has); }
void framesResumed(bool is) { g_frames.setResumed(is); }

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

/**
 * `Context.getCacheDir()`, asked rather than assembled.
 *
 * ANativeActivity hands over internalDataPath and externalDataPath and stops
 * there, so the cache directory has to come over JNI. Deriving it from
 * internalDataPath by swapping `files` for `cache` would be a guess about a
 * layout that has already moved once (`/data/data` to `/data/user/0`), and the
 * guess fails silently — as a directory that is simply never written.
 *
 * Empty on failure, which disables the bytecode cache and the hot-update store:
 * both regenerate, so a slower boot is the whole cost.
 */
std::string queryCacheDir(ANativeActivity* activity) {
    if (!activity || !activity->vm || !activity->clazz) return {};
    JNIEnv* env = nullptr;
    if (activity->vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK) {
        if (activity->vm->AttachCurrentThread(&env, nullptr) != JNI_OK || !env) return {};
    }
    std::string out;
    jclass ctxCls = env->GetObjectClass(activity->clazz);
    jmethodID getCacheDir = env->GetMethodID(ctxCls, "getCacheDir", "()Ljava/io/File;");
    if (getCacheDir) {
        if (jobject file = env->CallObjectMethod(activity->clazz, getCacheDir)) {
            jclass fileCls = env->GetObjectClass(file);
            jmethodID getPath = env->GetMethodID(fileCls, "getAbsolutePath", "()Ljava/lang/String;");
            if (getPath) {
                if (jstring path = (jstring)env->CallObjectMethod(file, getPath)) {
                    if (const char* utf8 = env->GetStringUTFChars(path, nullptr)) {
                        out = utf8;
                        env->ReleaseStringUTFChars(path, utf8);
                    }
                    env->DeleteLocalRef(path);
                }
            }
            env->DeleteLocalRef(fileCls);
            env->DeleteLocalRef(file);
        }
    }
    env->DeleteLocalRef(ctxCls);
    if (env->ExceptionCheck()) {
        env->ExceptionClear();
        return {};
    }
    return out;
}

}  // namespace

void android_main(android_app* app) {
    g_platform.assets = app->activity->assetManager;   // APK assets/ (the exported project)
    g_platform.vm = app->activity->vm;                  // for JNI HttpURLConnection (es_fetch)
    // Before boot: whether there is an editing surface decides whether the
    // es_textEditor_* entry points are bound at all.
    attachTextEditor(app->activity);
    // files/ holds what a player keeps; cache/ is the system's to reclaim.
    if (app->activity->internalDataPath) g_platform.data = app->activity->internalDataPath;
    g_platform.cache = queryCacheDir(app->activity);
    // The boot record goes where a person can reach it without a cable.
    if (app->activity->externalDataPath) g_platform.logs = app->activity->externalDataPath;
    app->onAppCmd = onAppCmd;
    app->onInputEvent = onInput;
    // Chained, not replaced: the glue's handler is what wakes the frame loop on
    // focus. Installed before the activity can be focused, so the first callback
    // already goes through ours.
    g_glueWindowFocusChanged = app->activity->callbacks->onWindowFocusChanged;
    app->activity->callbacks->onWindowFocusChanged = onWindowFocusChanged;
    PerformanceHints hints;
    hints.open();
    g_frames.hints = &hints;
    g_frames.attach();

    // Nothing but waiting. Frames arrive as Choreographer callbacks and input as
    // looper events, both dispatched from inside the poll — so there is no state
    // this loop has to sample, and therefore no reason for it to ever spin.
    while (true) {
        int events;
        android_poll_source* source;
        const int id = ALooper_pollOnce(-1, nullptr, &events, (void**)&source);
        if (id == ALOOPER_POLL_ERROR) {
            __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, "looper error — leaving the frame loop");
            return;
        }
        if (id >= 0 && source) source->process(app, source);
        if (app->destroyRequested) {
            framesResumed(false);
            return;
        }
    }
}
