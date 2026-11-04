// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    esjs.hpp
 * @brief   The JS engine the native host runs, behind one small surface.
 * @details Every binding the host has, hand-written or generated, is written
 *          against this file and nothing else of the engine. One build carries one
 *          engine, chosen when the host is built:
 *
 *            * V8, where a JIT is allowed (desktop, Android): the SDK and the game
 *              run compiled, as they do in a browser.
 *            * QuickJS-ng, where it is not (iOS): an interpreter, small and fast to
 *              start.
 *
 *          The surface is what the bindings actually use — values, objects, arrays,
 *          byte buffers, functions, calls — and the lifetime rule is V8's, because
 *          it is the one that cannot be emulated the other way round:
 *
 *            * A {@link Val} lives as long as the {@link Scope} it was made in. A
 *              native function runs inside one, and so does every host entry
 *              ({@link Enter}); nothing is freed by hand.
 *            * A value kept past that — a timer's callback, a pending fetch's — is
 *              held by a {@link Ref}.
 *
 *          Every call here must happen inside an {@link Enter}.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace esjs {

// =============================================================================
// Values
// =============================================================================

/** A JS value, valid until the {@link Scope} that made it closes. The bits are the
 *  engine's own handle; only the backend reads them. A default-constructed Val is
 *  not a value: ask for {@link undefined} when you mean undefined. */
struct Val {
    alignas(8) unsigned char bits[16] = {};
};

/** A native function's arguments. Reading past the end gives undefined, as a JS
 *  function reading a missing parameter does. */
class Args {
public:
    int size() const { return argc_; }
    Val operator[](int i) const;

    // Backend-internal: what the engine handed the trampoline.
    const void* impl_ = nullptr;
    int argc_ = 0;
};

/** A function JS can call. Return {@link undefined} for no value, or what a
 *  `throw*` call returned to raise an exception. */
using NativeFn = Val (*)(const Args&);

Val undefined();
Val null();
Val boolean(bool v);
Val number(double v);
Val int32(int32_t v);
Val uint32(uint32_t v);
/** As a JS number: exact up to 2^53, which every id that crosses is. */
Val int64(int64_t v);
Val string(std::string_view utf8);
Val object();
Val array();
/** An ArrayBuffer holding a copy of the bytes. */
Val arrayBufferCopy(const void* data, size_t size);
/** An ArrayBuffer over memory the host owns and keeps alive for as long as JS can
 *  reach it — the heap arena, a component's storage. Zero-copy; writes from JS
 *  land in that memory. */
Val arrayBufferWrap(void* data, size_t size);

/** Raise a TypeError / Error in the calling JS. Return what these return. */
Val throwTypeError(const char* message);
Val throwError(const char* message);

bool isUndefined(Val v);
bool isNull(Val v);
inline bool isNullish(Val v) { return isUndefined(v) || isNull(v); }
bool isBool(Val v);
bool isNumber(Val v);
bool isString(Val v);
bool isFunction(Val v);
bool isObject(Val v);
bool isArray(Val v);

/** JS's own conversions (ToNumber, ToInt32, ToUint32, ToBoolean, ToString). A
 *  conversion that throws (a Symbol, a throwing valueOf) answers 0 / false / "". */
double toNumber(Val v);
int32_t toInt32(Val v);
uint32_t toUint32(Val v);
int64_t toInt64(Val v);
bool toBool(Val v);
std::string toString(Val v);

/** A value's UTF-8, for the length of a statement: no copy on an engine whose
 *  strings are already UTF-8. */
class Utf8 {
public:
    explicit Utf8(Val v);
    ~Utf8();
    Utf8(const Utf8&) = delete;
    Utf8& operator=(const Utf8&) = delete;
    const char* c_str() const { return data_ ? data_ : ""; }
    size_t size() const { return size_; }
    std::string_view view() const { return {c_str(), size_}; }
    explicit operator bool() const { return data_ != nullptr; }

private:
    const char* data_ = nullptr;
    size_t size_ = 0;
    std::string own_;            ///< where an engine that must convert puts the bytes
};

/** The bytes behind an ArrayBuffer or any view of one (a typed array, a DataView):
 *  the engine's own memory, writable, valid while the value is. False for anything
 *  else. */
struct Bytes {
    uint8_t* data = nullptr;
    size_t size = 0;
};
bool bytesOf(Val v, Bytes* out);

// =============================================================================
// Objects
// =============================================================================

Val global();
/** `obj[key]`; undefined when absent, or when @p obj is not an object. */
Val get(Val obj, const char* key);
void set(Val obj, const char* key, Val value);
Val getAt(Val obj, uint32_t index);
void setAt(Val obj, uint32_t index, Val value);
/** `obj.length`, as a uint32 (0 when absent). */
uint32_t lengthOf(Val obj);
/** The object's own enumerable string keys, in JS order. */
std::vector<std::string> ownKeys(Val obj);
/** `obj[name] = <native function>`. */
void setFunction(Val obj, const char* name, NativeFn fn, int argc);

/**
 * `fn.call(self, ...argv)`. An exception is logged under @p where and answered
 * with false — every host entry treats a throwing callback the same way, so it is
 * done here once. @p result, when given, receives the return value.
 */
bool call(Val fn, Val self, int argc, const Val* argv, const char* where, Val* result = nullptr);

// =============================================================================
// Lifetimes
// =============================================================================

/** A region whose values are released when it closes. Native functions run in one
 *  already; open one in a loop that makes many values per iteration. */
class Scope {
public:
    Scope();
    ~Scope();
    Scope(const Scope&) = delete;
    Scope& operator=(const Scope&) = delete;

private:
    alignas(16) unsigned char storage_[64];
};

/** A value kept past its scope. Move-only; releasing an empty Ref is a no-op, and
 *  so is releasing one after the engine is gone (process exit). */
class Ref {
public:
    Ref() = default;
    explicit Ref(Val v);
    ~Ref();
    Ref(Ref&& o) noexcept : handle_(o.handle_) { o.handle_ = nullptr; }
    Ref& operator=(Ref&& o) noexcept;
    Ref(const Ref&) = delete;
    Ref& operator=(const Ref&) = delete;

    Val get() const;
    void reset();
    explicit operator bool() const { return handle_ != nullptr; }

private:
    void* handle_ = nullptr;
};

// =============================================================================
// The engine
// =============================================================================

/** Where the engine's own messages go: an uncaught exception, a rejected cache. */
using Logger = void (*)(bool error, const char* message);

/** The startup snapshot an engine built with external startup data needs, handed
 *  over before {@link init} (V8 on Android). The bytes are copied. A no-op for an
 *  engine that has its snapshot built in, or none. */
void setStartupSnapshot(const uint8_t* data, size_t size);

/** Bring the engine up: one runtime, one context, for the process. @p exePath is
 *  where an engine that ships data files beside the binary looks for them. */
void init(Logger log, const char* exePath);
bool alive();

/** "V8 10.0.139.9", "QuickJS-ng 0.10.1" — for the boot record. */
std::string engineName();
/** Whether this engine compiles JS to machine code. */
bool hasJit();

/**
 * The host stepping into JS: from a frame, an input event, a drained callback.
 * Binds the engine to the calling thread (a platform may hand the next frame to a
 * different one — Android recreates its glue thread) and opens a {@link Scope}.
 * Nests freely.
 */
class Enter {
public:
    Enter();
    ~Enter();
    Enter(const Enter&) = delete;
    Enter& operator=(const Enter&) = delete;

private:
    alignas(16) unsigned char storage_[160];
};

/** Run what promises queued. app.tick() is async: its systems run here. */
void pumpMicrotasks();
/** Run the engine's own deferred work (a JIT's background compile results, idle
 *  GC). A no-op for an engine that has none. */
void pumpEngine();

/** Evaluate a global script; an exception is logged under @p name. */
bool run(std::string_view source, const char* name);

/** How {@link runCached} treated the cache it was handed. */
enum class CacheUse { None, Used, Rejected };

/**
 * Evaluate a global script through a compile cache. @p cache (may be empty) is a
 * blob an earlier {@link runCached} produced for the SAME source on the SAME
 * engine build; one the engine declines is reported, with @p why, and the script
 * is compiled instead. @p fresh, when given and the cache was not used, receives a
 * new blob to store for next time.
 */
bool runCached(std::string_view source, const char* name,
               const uint8_t* cache, size_t cacheSize,
               CacheUse* use, std::string* why, std::vector<uint8_t>* fresh);

/** What a cache blob is called on disk, so caches from different engines (or
 *  engine builds) never meet: "qjsbc", "v8cache". */
const char* cacheTag();

}  // namespace esjs
