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
#include <jni.h>
#include <unistd.h>

#include <chrono>
#include <cstdarg>
#include <string>
#include <thread>

#include "Host.hpp"
#include "media/glyph_raster.hpp"   // GLYPH_BOLD / GLYPH_ITALIC, for the font match
#include "platform/touch_stream.hpp"
#include "platform/android_device.hpp"

#define LOG_TAG "EstellaSDK"

using esengine::u32;
using esengine::u8;
using esengine::WebGPUDevice;

namespace {

/** Clear the pending Java exception and say what it was: a bare "no response"
 *  hid that Android refused cleartext HTTP to a LAN CDN. */
std::string takeJavaException(JNIEnv* env) {
    jthrowable ex = env->ExceptionOccurred();
    env->ExceptionClear();
    if (!ex) return "unknown error";
    jclass cls = env->GetObjectClass(ex);
    auto text = static_cast<jstring>(env->CallObjectMethod(ex, env->GetMethodID(cls, "toString", "()Ljava/lang/String;")));
    std::string out = "unknown error";
    if (!env->ExceptionCheck() && text) {
        const char* s = env->GetStringUTFChars(text, nullptr);
        out = s ? s : out;
        if (s) env->ReleaseStringUTFChars(text, s);
    }
    env->ExceptionClear();
    if (text) env->DeleteLocalRef(text);
    env->DeleteLocalRef(cls);
    env->DeleteLocalRef(ex);
    return out;
}

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
    if (env->ExceptionCheck()) { r.error = takeJavaException(env); env->DeleteLocalRef(httpCls); env->DeleteLocalRef(conn); return; }
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

void framesTargetRate(float fps);   // FrameDriver, below

struct AndroidPlatform final : eshost::Platform {
    void setTargetFrameRate(float fps) override { framesTargetRate(fps); }
    eshost::AndroidDevice device;
    int deviceCapabilities() const override { return device.capabilities(); }
    bool startMotion(bool a, bool g, int interval) override { return device.start(a, g, interval); }
    void stopMotion() override { device.stop(); }
    bool pollMotion(eshost::MotionState& out) override { return device.poll(out); }
    bool vibrate(int duration, int intensity) override { return device.vibrate(duration, intensity); }
    bool keepScreenOn(bool enabled) override { return device.keepScreenOn(enabled); }
    AAssetManager* assets = nullptr;        // APK assets/ — the game + its content
    ANativeWindow* window = nullptr;
    ARect contentRect{};

    SafeInsets safeAreaInsets() const override {
        if (!window || contentRect.right <= contentRect.left || contentRect.bottom <= contentRect.top) return {};
        const int width = ANativeWindow_getWidth(window), height = ANativeWindow_getHeight(window);
        const auto clamp = [](int value, int limit) { return (float)(value < 0 ? 0 : value > limit ? limit : value); };
        return { clamp(contentRect.top, height), clamp(height - contentRect.bottom, height),
                 clamp(contentRect.left, width), clamp(width - contentRect.right, width) };
    }
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

    /**
     * `Locale.getDefault().toLanguageTag()` — 'zh-Hans-CN' on a phone set to
     * Simplified Chinese.
     *
     * The process default rather than the system property: it is what follows a
     * per-app language (Android 13) and a language changed while the game is in
     * the background. java.util.Locale is a boot class, so FindClass resolves it
     * from the frame loop's thread, where an app class would not.
     */
    std::string language() override {
        if (!vm) return {};
        JNIEnv* env = nullptr;
        if (vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK) {
            if (vm->AttachCurrentThread(&env, nullptr) != JNI_OK || !env) return {};
        }
        std::string out;
        if (jclass cls = env->FindClass("java/util/Locale")) {
            const jmethodID getDefault = env->GetStaticMethodID(cls, "getDefault", "()Ljava/util/Locale;");
            const jmethodID toTag = env->GetMethodID(cls, "toLanguageTag", "()Ljava/lang/String;");
            jobject locale = getDefault && toTag ? env->CallStaticObjectMethod(cls, getDefault) : nullptr;
            if (locale && !env->ExceptionCheck()) {
                if (auto tag = static_cast<jstring>(env->CallObjectMethod(locale, toTag))) {
                    if (const char* utf8 = env->GetStringUTFChars(tag, nullptr)) {
                        out = utf8;
                        env->ReleaseStringUTFChars(tag, utf8);
                    }
                    env->DeleteLocalRef(tag);
                }
            }
            if (locale) env->DeleteLocalRef(locale);
            env->DeleteLocalRef(cls);
        }
        if (env->ExceptionCheck()) {
            env->ExceptionClear();
            return {};
        }
        return out;
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
    eshost::FontMatch matchFont(const std::string& family, u32 codepoint, int style) override {
        eshost::FontMatch out;
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
        }
        AFont_close(font);
        return out;
    }

    // -- The platform's own rasterizer: com.estella.host.GlyphPainter ----------
    //
    // For a face stb_truetype cannot read: Android 16's system CJK font has CFF2
    // outlines, so without this the native path drew no system CJK text at all.
    // The same face the matcher chose is drawn by android.graphics, as Core Text
    // draws it on Apple (Platform::drawGlyph).

    jclass glyphPainter = nullptr;     // global ref, set by attachJavaShims
    jmethodID glyphPainterDraw = nullptr;

    bool drawGlyph(const std::string& family, u32 codepoint, int style, esengine::f32 pixelSize, int supersample,
                   int padding, GlyphCoverage& out) override {
        if (!glyphPainter || !vm) return false;
        const eshost::FontMatch face = matchFont(family, codepoint, style);
        if (face.path.empty()) return false;
        JNIEnv* env = nullptr;
        if (vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK) {
            if (vm->AttachCurrentThread(&env, nullptr) != JNI_OK || !env) return false;
        }
        jstring path = env->NewStringUTF(face.path.c_str());
        jfloatArray metrics = env->NewFloatArray(6);
        auto alpha = (jbyteArray)env->CallStaticObjectMethod(
            glyphPainter, glyphPainterDraw, path, (jint)face.faceIndex, (jint)codepoint, (jfloat)pixelSize,
            (jint)supersample, (jint)padding, (jboolean)face.syntheticBold, (jboolean)face.syntheticItalic, metrics);
        bool ok = false;
        if (env->ExceptionCheck()) {
            env->ExceptionDescribe();
            env->ExceptionClear();
        } else if (alpha) {
            float m[6] = {};
            env->GetFloatArrayRegion(metrics, 0, 6, m);
            out.width = (int)m[0];
            out.height = (int)m[1];
            out.advance = m[2];
            out.bearingX = m[3];
            out.bearingY = m[4];
            out.blank = m[5] != 0.0f;
            const jsize n = env->GetArrayLength(alpha);
            if (out.blank) {
                ok = true;
            } else if (out.width > 0 && out.height > 0 && n == (jsize)out.width * out.height) {
                out.alpha.resize((size_t)n);
                env->GetByteArrayRegion(alpha, 0, n, reinterpret_cast<jbyte*>(out.alpha.data()));
                ok = true;
            }
            env->DeleteLocalRef(alpha);
        }
        env->DeleteLocalRef(metrics);
        env->DeleteLocalRef(path);
        return ok;
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

    // -- The app's own Java, by name: com.estella.host.NativeChannel -----------
    //
    // An ad SDK, a store, a sign-in library are Java and are the project's. The
    // class keeps the registry and does its own threading (a handler runs on the
    // UI thread and answers from wherever its SDK calls back), so these are plain
    // calls from the frame loop.

    jclass channel = nullptr;          // global ref, set by attachJavaShims
    jmethodID channelHas = nullptr;
    jmethodID channelCall = nullptr;

    bool nativeHas(const std::string& method) override {
        bool known = false;
        withChannel([&](JNIEnv* env) {
            jstring name = env->NewStringUTF(method.c_str());
            known = env->CallStaticBooleanMethod(channel, channelHas, name) != JNI_FALSE;
            env->DeleteLocalRef(name);
        });
        return known;
    }

    bool nativeCall(int id, const std::string& method, const std::string& args) override {
        bool started = false;
        withChannel([&](JNIEnv* env) {
            jstring name = env->NewStringUTF(method.c_str());
            // As bytes: a JNI string is modified UTF-8, and JSON is not.
            jbyteArray json = env->NewByteArray((jsize)args.size());
            if (json) env->SetByteArrayRegion(json, 0, (jsize)args.size(), reinterpret_cast<const jbyte*>(args.data()));
            started = env->CallStaticBooleanMethod(channel, channelCall, (jint)id, name, json) != JNI_FALSE;
            env->DeleteLocalRef(json);
            env->DeleteLocalRef(name);
        });
        return started;
    }

    template <typename F>
    void withChannel(F&& body) {
        if (!channel || !vm) return;
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
 * One of the APK's own classes (the shims in native/android/java), as a local ref;
 * null when the APK does not carry it. FindClass would fail on this thread (off
 * the UI thread it resolves through the SYSTEM class loader, which knows nothing
 * of the APK), so the app's own loader is asked by name instead.
 */
jclass loadAppClass(JNIEnv* env, ANativeActivity* activity, const char* name) {
    jclass activityCls = env->GetObjectClass(activity->clazz);
    const jmethodID getClassLoader =
        env->GetMethodID(activityCls, "getClassLoader", "()Ljava/lang/ClassLoader;");
    env->DeleteLocalRef(activityCls);
    if (!getClassLoader) { env->ExceptionClear(); return nullptr; }
    jobject loader = env->CallObjectMethod(activity->clazz, getClassLoader);
    jclass loaderCls = env->FindClass("java/lang/ClassLoader");
    const jmethodID loadClass =
        env->GetMethodID(loaderCls, "loadClass", "(Ljava/lang/String;)Ljava/lang/Class;");
    env->DeleteLocalRef(loaderCls);
    jstring jname = env->NewStringUTF(name);
    jclass cls = (jclass)env->CallObjectMethod(loader, loadClass, jname);
    env->DeleteLocalRef(jname);
    env->DeleteLocalRef(loader);
    if (!cls || env->ExceptionCheck()) {
        env->ExceptionClear();
        return nullptr;
    }
    return cls;
}

/**
 * Load com.estella.host.TextEditor, register its natives and construct it.
 *
 * Runs on the frame-loop thread, before boot binds the es_textEditor_* entry
 * points — the surface has to exist by then or the SDK correctly concludes there
 * is none. Nothing touches a View: the shim posts all of that to the UI thread
 * itself.
 */
void attachTextEditor(JNIEnv* env, ANativeActivity* activity) {
    if (g_platform.editor) return;
    jclass cls = loadAppClass(env, activity, "com.estella.host.TextEditor");
    if (!cls) {
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

/** Load com.estella.host.GlyphPainter (see AndroidPlatform::drawGlyph). Static methods only, so no instance. */
void attachGlyphPainter(JNIEnv* env, ANativeActivity* activity) {
    if (g_platform.glyphPainter) return;
    jclass cls = loadAppClass(env, activity, "com.estella.host.GlyphPainter");
    const jmethodID draw = cls ? env->GetStaticMethodID(cls, "draw", "(Ljava/lang/String;IIFIIZZ[F)[B") : nullptr;
    if (!draw) {
        env->ExceptionClear();
        if (cls) env->DeleteLocalRef(cls);
        __android_log_print(ANDROID_LOG_WARN, LOG_TAG,
                            "glyphs: com.estella.host.GlyphPainter not in the APK — a face the shared parser cannot "
                            "read draws nothing");
        return;
    }
    g_platform.glyphPainter = (jclass)env->NewGlobalRef(cls);
    g_platform.glyphPainterDraw = draw;
    env->DeleteLocalRef(cls);
}

// -- The channel's answers, on whatever thread the app's SDK called back on ----
// Queued as POD; the frame loop hands them to JS (see ChannelBindings.cpp).

std::string jniBytes(JNIEnv* env, jbyteArray bytes) {
    if (!bytes) return {};
    const jsize size = env->GetArrayLength(bytes);
    std::string out(static_cast<size_t>(size), ' ');
    if (size > 0) env->GetByteArrayRegion(bytes, 0, size, reinterpret_cast<jbyte*>(out.data()));
    return out;
}

std::string jniName(JNIEnv* env, jstring text) {
    const char* utf8 = text ? env->GetStringUTFChars(text, nullptr) : nullptr;
    std::string out = utf8 ? utf8 : "";
    if (utf8) env->ReleaseStringUTFChars(text, utf8);
    return out;
}

void jniChannelReply(JNIEnv* env, jclass, jint id, jboolean ok, jbyteArray payload) {
    eshost::deliverNativeReply((int)id, ok != JNI_FALSE, jniBytes(env, payload));
}

void jniChannelEvent(JNIEnv* env, jclass, jstring name, jbyteArray payload) {
    eshost::deliverNativeEvent(jniName(env, name), jniBytes(env, payload));
}

/**
 * Load com.estella.host.NativeChannel, register its natives and let the app's
 * plugins register what they answer. Before boot, so that a script asking what
 * it can call during its own start is told the truth.
 */
void attachNativeChannel(JNIEnv* env, ANativeActivity* activity) {
    if (g_platform.channel) return;
    jclass cls = loadAppClass(env, activity, "com.estella.host.NativeChannel");
    if (!cls) {
        __android_log_print(ANDROID_LOG_WARN, LOG_TAG,
                            "native channel: com.estella.host.NativeChannel not in the APK — the app's Java cannot be called");
        return;
    }
    const JNINativeMethod natives[] = {
        {"nativeReply", "(IZ[B)V", (void*)jniChannelReply},
        {"nativeEvent", "(Ljava/lang/String;[B)V", (void*)jniChannelEvent},
    };
    const jmethodID attach = env->GetStaticMethodID(cls, "attach", "(Landroid/app/Activity;)V");
    const jmethodID has = env->GetStaticMethodID(cls, "has", "(Ljava/lang/String;)Z");
    const jmethodID call = env->GetStaticMethodID(cls, "call", "(ILjava/lang/String;[B)Z");
    if (!attach || !has || !call || env->RegisterNatives(cls, natives, 2) != JNI_OK) {
        env->ExceptionClear();
        env->DeleteLocalRef(cls);
        return;
    }
    env->CallStaticVoidMethod(cls, attach, activity->clazz);
    if (env->ExceptionCheck()) {
        env->ExceptionDescribe();
        env->ExceptionClear();
    }
    g_platform.channelHas = has;
    g_platform.channelCall = call;
    g_platform.channel = (jclass)env->NewGlobalRef(cls);
    env->DeleteLocalRef(cls);
}

/** The APK's Java shims, loaded once on the frame-loop thread before boot binds what they answer. */
void attachJavaShims(ANativeActivity* activity) {
    if (!activity->vm) return;
    JNIEnv* env = nullptr;
    if (activity->vm->AttachCurrentThread(&env, nullptr) != JNI_OK || !env) return;
    attachTextEditor(env, activity);
    attachGlyphPainter(env, activity);
    attachNativeChannel(env, activity);
}

// The decoder's own copies of the MotionEvent constants, held against the NDK's
// so a test that cannot include <android/input.h> is still testing this ABI.
static_assert(eshost::input::kMotionActionMask == AMOTION_EVENT_ACTION_MASK);
static_assert(eshost::input::kMotionPointerIndexMask == AMOTION_EVENT_ACTION_POINTER_INDEX_MASK);
static_assert(eshost::input::kMotionPointerIndexShift == AMOTION_EVENT_ACTION_POINTER_INDEX_SHIFT);
static_assert(eshost::input::kMotionActionDown == AMOTION_EVENT_ACTION_DOWN);
static_assert(eshost::input::kMotionActionUp == AMOTION_EVENT_ACTION_UP);
static_assert(eshost::input::kMotionActionMove == AMOTION_EVENT_ACTION_MOVE);
static_assert(eshost::input::kMotionActionCancel == AMOTION_EVENT_ACTION_CANCEL);
static_assert(eshost::input::kMotionActionPointerDown == AMOTION_EVENT_ACTION_POINTER_DOWN);
static_assert(eshost::input::kMotionActionPointerUp == AMOTION_EVENT_ACTION_POINTER_UP);

// One finger is one id, for the whole gesture: Android's own pointer id is that
// identity, and the coordinates come from the pointer the action names — reading
// index 0 reports every finger at the first one's position.
int32_t onInput(android_app*, AInputEvent* ev) {
    if (!eshost::booted() || AInputEvent_getType(ev) != AINPUT_EVENT_TYPE_MOTION) return 0;
    const eshost::input::MotionAction act = eshost::input::decodeMotion(AMotionEvent_getAction(ev));
    if (!act.handled) return 0;
    const size_t count = AMotionEvent_getPointerCount(ev);
    const auto send = [&](size_t index) {
        eshost::touch(act.phase, AMotionEvent_getPointerId(ev, index),
                      AMotionEvent_getX(ev, index), AMotionEvent_getY(ev, index));
    };
    if (act.allPointers) {
        for (size_t i = 0; i < count; ++i) send(i);
    } else if (static_cast<size_t>(act.index) < count) {
        send(static_cast<size_t>(act.index));
    }
    return 1;
}

// Asking for frames, and stopping. Declared here so the lifecycle handler below
// reads in the order things happen rather than after the machinery it drives —
// see FrameDriver.
void framesSurface(bool has);
void framesResumed(bool is);

// Tells the system what rate the game is meant to run at, so the panel settles on a refresh the game can hold: a 120 Hz panel
// left at 120 holds every present to an 8.3 ms grid, and a frame the cap spaces 16.7 ms apart then lands a vsync early or late
// at random. 60 Hz is an exact fraction of 120 Hz and of 60 Hz, so the system can hold it on either. ANativeWindow_setFrameRate is API 30; the manifest floor is 29,
// so it is looked up like PerformanceHints' symbols rather than made a load-time requirement.
void hintFrameRate(ANativeWindow* window, float fps) {
    constexpr int8_t kCompatibilityDefault = 0;   // ANATIVEWINDOW_FRAME_RATE_COMPATIBILITY_DEFAULT
    using SetFrameRateFn = int32_t (*)(ANativeWindow*, float, int8_t);
    // From libnativewindow, which exports it: RTLD_DEFAULT searches only what this
    // namespace loaded globally, and on a current device that is not the library
    // this symbol lives in — the lookup came back empty on Android 16 and the hint
    // was never given, which is the 120 Hz cadence problem above, every frame.
    static void* const nativeWindow = dlopen("libnativewindow.so", RTLD_NOW | RTLD_LOCAL);
    auto set = nativeWindow ? reinterpret_cast<SetFrameRateFn>(dlsym(nativeWindow, "ANativeWindow_setFrameRate")) : nullptr;
    if (!set) set = reinterpret_cast<SetFrameRateFn>(dlsym(RTLD_DEFAULT, "ANativeWindow_setFrameRate"));
    if (!window || !set) {
        if (window) __android_log_print(ANDROID_LOG_WARN, LOG_TAG, "frame rate hint: unavailable (API < 30)");
        return;
    }
    const int32_t result = set(window, fps, kCompatibilityDefault);   // 0 fps = no preference: the panel's own rate
    __android_log_print(result == 0 ? ANDROID_LOG_INFO : ANDROID_LOG_WARN, LOG_TAG,
                        "frame rate hint: %.0f fps (%s)", fps, result == 0 ? "accepted" : "refused");
}

// What the game wants until it says otherwise (App.setTargetFrameRate -> es_setTargetFrameRate): a phone holds 60 by default,
// where the web and the desktop take the display's rate, since a phone's panel is often 120 Hz and its battery and heat pay
// for every frame past what the game was made for.
constexpr float kDefaultFps = 60.0f;
float g_targetFps = kDefaultFps;

void onAppCmd(android_app* app, int32_t cmd) {
    // NativeActivity supplies a content rectangle in window pixels; the glue
    // updates it before delivering CONTENT_RECT_CHANGED, including rotation.
    g_platform.contentRect = app->contentRect;
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
                hintFrameRate(app->window, g_targetFps);   // per window: a recreated surface forgets it
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

    // The deadline a session opens with: one 60 Hz refresh, the default cap.
    // updateTarget() moves it with the cap.
    static constexpr int64_t kFrameBudgetNanos = 16'666'667;

    // Opaque on purpose: the header's typedefs come with the same availability
    // annotations, and nothing here needs to know what a session is.
    using GetManagerFn = void* (*)();
    using CreateSessionFn = void* (*)(void*, const int32_t*, size_t, int64_t);
    using ReportFn = int (*)(void*, int64_t);
    using CloseFn = void (*)(void*);

    ReportFn reportFn = nullptr;
    ReportFn updateTargetFn = nullptr;   // APerformanceHint_updateTargetWorkDuration: the same shape as report
    CloseFn closeFn = nullptr;
    int64_t targetNanos = kFrameBudgetNanos;

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
        updateTargetFn = reinterpret_cast<ReportFn>(
            dlsym(RTLD_DEFAULT, "APerformanceHint_updateTargetWorkDuration"));

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

    /// The deadline is the frame budget the pacer holds, so it follows the cap.
    void updateTarget(std::chrono::steady_clock::duration budget) {
        const int64_t nanos = std::chrono::duration_cast<std::chrono::nanoseconds>(budget).count();
        if (!session || !updateTargetFn || nanos <= 0 || nanos == targetNanos) return;
        targetNanos = nanos;
        updateTargetFn(session, nanos);
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
// One clock paces a frame: the swapchain's Fifo present, which blocks until the
// display takes the frame. The loop in android_main serves input, waits until
// eshost::untilFrameDue() says a frame is due (the game's cap, held as a cadence,
// and a floor against a present that stops blocking — FramePacer.hpp), and
// otherwise calls frame() back to back. The desktop loop is the same loop.
//
// It used to be a Choreographer callback, posted again after each frame. With a
// present that also blocks that is two clocks: a frame whose present waited past
// the next vsync asked for a callback only after it, which then came a vsync
// later again. A 15 ms frame on a 60 Hz cadence ran at 30 fps, every interval
// 33 ms, on a Snapdragon 8 Elite; issue #105 measured 33/50/66 ms in a real game.
//
// Two conditions, both required, exactly the pair iOS pauses its display link on:
// there has to be a surface to present to, and the activity has to be the one the
// user is looking at. Either alone is not enough — pressing HOME leaves the
// surface alive, so a loop gated on the surface only goes on rendering the game
// at the full panel rate onto a window nobody can see. (Measured: 121 fps from the
// home screen.) The host already treats PAUSE as "not visible" by suspending audio
// and the game clock; this makes rendering agree with the other two. While either
// is missing the loop blocks in the poll: no frames, and no spinning.
struct FrameGate {
    bool hasSurface = false;
    /// Starts true, and only APP_CMD_PAUSE clears it. Waiting for a RESUME to
    /// arrive first is what broke this once: a launch that never delivered one
    /// left the gate shut and the game rendered nothing at all. The safe default
    /// is the one whose failure is recoverable — a missed RESUME then costs
    /// nothing, where a missed PAUSE is the thing actually being guarded against,
    /// and PAUSE always arrives because the OS is what sends it.
    bool resumed = true;
    /// Derived from the two above: whether the loop draws.
    bool running = false;

    void setSurface(bool has) { hasSurface = has; sync(); }
    void setResumed(bool is) { resumed = is; sync(); }

    void sync() {
        const bool want = hasSurface && resumed;
        if (want == running) return;
        running = want;
        // Transitions only, so this is a handful of lines per run — and it is the
        // one place that can explain a black screen, which is otherwise silent.
        __android_log_print(ANDROID_LOG_INFO, LOG_TAG, "frames: %s (surface=%d resumed=%d)",
                            running ? "running" : "paused", (int)hasSurface, (int)resumed);
    }
};

FrameGate g_frames;

/// The cap itself is the pacer's (es_setTargetFrameRate set it before calling this); the OS is told here, the one part only
/// the platform can do.
void framesTargetRate(float fps) {
    if (fps == g_targetFps) return;
    g_targetFps = fps;
    hintFrameRate(g_platform.window, fps);
}
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

/**
 * An app's stdout and stderr go nowhere on Android, and a native library that
 * reports a fatal error by printing it and aborting (V8 does exactly that) then
 * dies with a backtrace and no reason. Route both into logcat, line by line, once
 * per process — before anything that could print.
 */
static void forwardStdioToLog() {
    static bool started = false;
    if (started) return;
    int fds[2];
    if (pipe(fds) != 0) return;
    started = true;
    setvbuf(stdout, nullptr, _IOLBF, 0);
    setvbuf(stderr, nullptr, _IONBF, 0);
    dup2(fds[1], STDOUT_FILENO);
    dup2(fds[1], STDERR_FILENO);
    close(fds[1]);
    std::thread([fd = fds[0]] {
        char buf[1024];
        std::string line;
        for (;;) {
            const ssize_t n = read(fd, buf, sizeof(buf));
            if (n <= 0) break;
            for (ssize_t i = 0; i < n; ++i) {
                if (buf[i] == '\n') {
                    __android_log_write(ANDROID_LOG_WARN, LOG_TAG, line.c_str());
                    line.clear();
                } else {
                    line += buf[i];
                }
            }
        }
    }).detach();
}

void android_main(android_app* app) {
    forwardStdioToLog();
    g_platform.device.activity = app->activity;
    g_platform.assets = app->activity->assetManager;   // APK assets/ (the exported project)
    g_platform.vm = app->activity->vm;                  // for JNI HttpURLConnection (es_fetch)
    // Before boot: whether there is an editing surface decides whether the
    // es_textEditor_* entry points are bound at all.
    attachJavaShims(app->activity);
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
    eshost::framePacer().setTarget(kDefaultFps);

    // The frame loop (see FrameGate). Each turn waits for input or for the next
    // frame to fall due, whichever comes first, serves every event already queued,
    // and then draws if a frame is due. Drawing does not wait for the queue to run
    // dry: a touch panel reporting at 240-480 Hz keeps it non-empty, and a loop
    // that drew only on a timed-out poll starved frames for up to a second while a
    // finger was down.
    using Clock = std::chrono::steady_clock;
    while (true) {
        int timeoutMs = -1;   // not drawing: sleep until the OS has something
        if (g_frames.running) {
            const auto wait = eshost::untilFrameDue();
            // Rounded up: waking early only goes round the loop again.
            timeoutMs = wait > Clock::duration::zero()
                ? (int)std::chrono::duration_cast<std::chrono::milliseconds>(wait + std::chrono::microseconds(999)).count()
                : 0;
        }
        for (;;) {
            int events;
            android_poll_source* source;
            const int id = ALooper_pollOnce(timeoutMs, nullptr, &events, (void**)&source);
            if (id == ALOOPER_POLL_TIMEOUT) break;
            if (id == ALOOPER_POLL_ERROR) {
                __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, "looper error — leaving the frame loop");
                return;
            }
            if (id >= 0 && source) source->process(app, source);
            if (app->destroyRequested) {
                g_platform.device.stop();
                g_platform.device.activity = nullptr;
                framesResumed(false);
                return;
            }
            timeoutMs = 0;   // the rest of what is queued, without waiting for more
        }
        if (!g_frames.running || eshost::untilFrameDue() > Clock::duration::zero()) continue;
        hints.updateTarget(eshost::framePacer().budget());
        const auto begin = Clock::now();
        eshost::frame();
        hints.report(Clock::now() - begin);
    }
}
