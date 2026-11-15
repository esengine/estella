// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "ByteStream.hpp"
#include "TlsAndroid.hpp"

#include <jni.h>

#include <algorithm>
#include <atomic>
#include <cstdlib>
#include <cstring>
#include <vector>

namespace eshost {
namespace {

std::atomic<JavaVM*> g_vm{nullptr};
constexpr jint kChunk = 16384;

class Attached {
public:
    Attached() {
        JavaVM* vm = g_vm.load();
        if (!vm) return;
        if (vm->GetEnv(reinterpret_cast<void**>(&env_), JNI_VERSION_1_6) == JNI_OK) return;
        mine_ = vm->AttachCurrentThread(&env_, nullptr) == JNI_OK;
        if (!mine_) env_ = nullptr;
    }
    ~Attached() {
        if (mine_) g_vm.load()->DetachCurrentThread();
    }
    Attached(const Attached&) = delete;
    Attached& operator=(const Attached&) = delete;

    JNIEnv* env() const { return env_; }

private:
    JNIEnv* env_ = nullptr;
    bool mine_ = false;
};

std::string thrown(JNIEnv* env) {
    jthrowable error = env->ExceptionOccurred();
    env->ExceptionClear();
    if (!error) return "unknown error";
    jclass cls = env->GetObjectClass(error);
    auto text = static_cast<jstring>(env->CallObjectMethod(error, env->GetMethodID(cls, "toString", "()Ljava/lang/String;")));
    std::string out = "unknown error";
    if (!env->ExceptionCheck() && text) {
        if (const char* chars = env->GetStringUTFChars(text, nullptr)) {
            out = chars;
            env->ReleaseStringUTFChars(text, chars);
        }
    }
    env->ExceptionClear();
    if (text) env->DeleteLocalRef(text);
    env->DeleteLocalRef(cls);
    env->DeleteLocalRef(error);
    return out;
}

class AndroidTlsStream final : public ByteStream {
public:
    AndroidTlsStream(JNIEnv* env, jobject socket, jobject in, jobject out)
        : socket_(env->NewGlobalRef(socket)), in_(env->NewGlobalRef(in)), out_(env->NewGlobalRef(out)) {
        jclass inClass = env->GetObjectClass(in);
        jclass outClass = env->GetObjectClass(out);
        jclass socketClass = env->GetObjectClass(socket);
        read_ = env->GetMethodID(inClass, "read", "([BII)I");
        write_ = env->GetMethodID(outClass, "write", "([BII)V");
        flush_ = env->GetMethodID(outClass, "flush", "()V");
        close_ = env->GetMethodID(socketClass, "close", "()V");
        env->DeleteLocalRef(inClass);
        env->DeleteLocalRef(outClass);
        env->DeleteLocalRef(socketClass);
    }

    ~AndroidTlsStream() override {
        Attached thread;
        JNIEnv* env = thread.env();
        if (!env) return;
        closeSocket(env);
        env->DeleteGlobalRef(socket_);
        env->DeleteGlobalRef(in_);
        env->DeleteGlobalRef(out_);
    }

    bool sendAll(const uint8_t* data, size_t len) override {
        Attached thread;
        JNIEnv* env = thread.env();
        if (!env) return false;
        while (len > 0) {
            const jint n = static_cast<jint>(std::min<size_t>(len, kChunk));
            jbyteArray bytes = env->NewByteArray(n);
            if (!bytes) { env->ExceptionClear(); return false; }
            env->SetByteArrayRegion(bytes, 0, n, reinterpret_cast<const jbyte*>(data));
            env->CallVoidMethod(out_, write_, bytes, 0, n);
            env->DeleteLocalRef(bytes);
            if (env->ExceptionCheck()) { env->ExceptionClear(); return false; }
            data += n;
            len -= static_cast<size_t>(n);
        }
        env->CallVoidMethod(out_, flush_);
        if (env->ExceptionCheck()) { env->ExceptionClear(); return false; }
        return true;
    }

    bool recvAll(uint8_t* data, size_t len) override {
        while (len > 0) {
            if (at_ == pending_.size() && !fill()) return false;
            const size_t n = std::min(len, pending_.size() - at_);
            std::memcpy(data, pending_.data() + at_, n);
            at_ += n;
            data += n;
            len -= n;
        }
        return true;
    }

    void shutdown() override {
        Attached thread;
        if (JNIEnv* env = thread.env()) closeSocket(env);
    }

private:
    void closeSocket(JNIEnv* env) {
        env->CallVoidMethod(socket_, close_);
        if (env->ExceptionCheck()) env->ExceptionClear();
    }

    bool fill() {
        Attached thread;
        JNIEnv* env = thread.env();
        if (!env) return false;
        jbyteArray bytes = env->NewByteArray(kChunk);
        if (!bytes) { env->ExceptionClear(); return false; }
        const jint got = env->CallIntMethod(in_, read_, bytes, 0, kChunk);
        const bool failed = env->ExceptionCheck();
        if (failed) env->ExceptionClear();
        if (!failed && got > 0) {
            pending_.resize(static_cast<size_t>(got));
            env->GetByteArrayRegion(bytes, 0, got, reinterpret_cast<jbyte*>(pending_.data()));
            at_ = 0;
        }
        env->DeleteLocalRef(bytes);
        return !failed && got > 0;
    }

    jobject socket_;
    jobject in_;
    jobject out_;
    jmethodID read_ = nullptr;
    jmethodID write_ = nullptr;
    jmethodID flush_ = nullptr;
    jmethodID close_ = nullptr;
    std::vector<uint8_t> pending_;
    size_t at_ = 0;
};

}  // namespace

void androidTlsInit(JavaVM* vm) { g_vm = vm; }

std::unique_ptr<ByteStream> dialTls(const std::string& host, const std::string& port, std::string& why) {
    Attached thread;
    JNIEnv* env = thread.env();
    if (!env) {
        why = "no Java VM to open a TLS socket through";
        return nullptr;
    }
    if (env->PushLocalFrame(16) != JNI_OK) {
        env->ExceptionClear();
        why = "out of memory";
        return nullptr;
    }
    std::unique_ptr<ByteStream> stream;
    const auto refuse = [&](const char* step) {
        why = host + ":" + port + ": " + (env->ExceptionCheck() ? thrown(env) : std::string(step));
    };
    do {
        jclass factoryClass = env->FindClass("javax/net/ssl/SSLSocketFactory");
        jclass socketClass = env->FindClass("javax/net/ssl/SSLSocket");
        jclass parametersClass = env->FindClass("javax/net/ssl/SSLParameters");
        if (!factoryClass || !socketClass || !parametersClass) { refuse("no TLS socket classes"); break; }

        jobject factory = env->CallStaticObjectMethod(factoryClass,
            env->GetStaticMethodID(factoryClass, "getDefault", "()Ljavax/net/SocketFactory;"));
        if (env->ExceptionCheck() || !factory) { refuse("no TLS socket factory"); break; }

        jstring name = env->NewStringUTF(host.c_str());
        jobject socket = env->CallObjectMethod(factory,
            env->GetMethodID(factoryClass, "createSocket", "(Ljava/lang/String;I)Ljava/net/Socket;"),
            name, static_cast<jint>(std::atoi(port.c_str())));
        if (env->ExceptionCheck() || !socket) { refuse("could not connect"); break; }

        jobject parameters = env->CallObjectMethod(socket,
            env->GetMethodID(socketClass, "getSSLParameters", "()Ljavax/net/ssl/SSLParameters;"));
        if (env->ExceptionCheck() || !parameters) { refuse("no TLS parameters"); break; }
        jstring https = env->NewStringUTF("HTTPS");
        env->CallVoidMethod(parameters,
            env->GetMethodID(parametersClass, "setEndpointIdentificationAlgorithm", "(Ljava/lang/String;)V"), https);
        env->CallVoidMethod(socket,
            env->GetMethodID(socketClass, "setSSLParameters", "(Ljavax/net/ssl/SSLParameters;)V"), parameters);
        if (env->ExceptionCheck()) { refuse("could not ask for the host name to be checked"); break; }

        const auto closeAndRefuse = [&](const char* step) {
            refuse(step);
            env->CallVoidMethod(socket, env->GetMethodID(socketClass, "close", "()V"));
            if (env->ExceptionCheck()) env->ExceptionClear();
        };
        env->CallVoidMethod(socket, env->GetMethodID(socketClass, "startHandshake", "()V"));
        if (env->ExceptionCheck()) { closeAndRefuse("the TLS handshake failed"); break; }
        env->CallVoidMethod(socket, env->GetMethodID(socketClass, "setTcpNoDelay", "(Z)V"), static_cast<jboolean>(JNI_TRUE));
        if (env->ExceptionCheck()) env->ExceptionClear();

        jobject in = env->CallObjectMethod(socket, env->GetMethodID(socketClass, "getInputStream", "()Ljava/io/InputStream;"));
        if (env->ExceptionCheck() || !in) { closeAndRefuse("no input stream"); break; }
        jobject out = env->CallObjectMethod(socket, env->GetMethodID(socketClass, "getOutputStream", "()Ljava/io/OutputStream;"));
        if (env->ExceptionCheck() || !out) { closeAndRefuse("no output stream"); break; }
        stream = std::make_unique<AndroidTlsStream>(env, socket, in, out);
    } while (false);
    env->PopLocalFrame(nullptr);
    return stream;
}

}  // namespace eshost
