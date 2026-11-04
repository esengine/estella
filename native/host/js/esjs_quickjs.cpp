// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    esjs_quickjs.cpp
 * @brief   esjs over QuickJS-ng — the engine where no JIT is allowed (iOS).
 * @details QuickJS counts references and the surface counts scopes, so this file
 *          is the bridge between the two: every value it hands out that holds a
 *          reference is recorded on one stack of locals, and a closing scope (a
 *          native function returning, an {@link Enter} ending) releases what was
 *          recorded since it opened. A value written into an object or returned
 *          to JS is duplicated first, so the scope's release never takes a
 *          reference something else still holds.
 *
 *          The JS thread is one thread at a time (Android may change WHICH one),
 *          so the stack is a plain global.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#include "esjs.hpp"

extern "C" {
#include "quickjs.h"
}

#include <cstdlib>
#include <cstring>
#include <new>

namespace esjs {
namespace {

static_assert(sizeof(JSValue) <= sizeof(Val::bits), "a JSValue must fit a Val");

JSRuntime* g_rt = nullptr;
JSContext* g_ctx = nullptr;
Logger g_log = nullptr;
bool g_alive = false;
std::vector<JSValue> g_locals;

inline JSValue raw(Val v) {
    JSValue j;
    std::memcpy(&j, v.bits, sizeof(JSValue));
    return j;
}

inline Val borrowed(JSValue j) {
    Val v;
    std::memcpy(v.bits, &j, sizeof(JSValue));
    return v;
}

/** A value this file made (or was handed with a reference): released by the
 *  enclosing scope. */
inline Val local(JSValue j) {
    if (JS_VALUE_HAS_REF_COUNT(j)) g_locals.push_back(j);
    return borrowed(j);
}

void releaseTo(size_t mark) {
    while (g_locals.size() > mark) {
        JSValue j = g_locals.back();
        g_locals.pop_back();
        JS_FreeValue(g_ctx, j);
    }
}

void say(bool error, const std::string& s) {
    if (g_log) g_log(error, s.c_str());
}

std::string describe(JSValueConst e) {
    std::string out;
    if (const char* s = JS_ToCString(g_ctx, e)) {
        out = s;
        JS_FreeCString(g_ctx, s);
    } else {
        JS_FreeValue(g_ctx, JS_GetException(g_ctx));
        out = "?";
    }
    return out;
}

/** Report the pending exception, with its stack: a bare message ("Maximum call
 *  stack size exceeded") says nothing about which SDK path produced it. */
void reportException(const char* where) {
    JSValue e = JS_GetException(g_ctx);
    say(true, std::string("JS error in ") + where + ": " + describe(e));
    if (JS_IsObject(e)) {
        JSValue stack = JS_GetPropertyStr(g_ctx, e, "stack");
        if (JS_IsString(stack)) say(true, "  stack: " + describe(stack));
        else if (JS_IsException(stack)) JS_FreeValue(g_ctx, JS_GetException(g_ctx));
        JS_FreeValue(g_ctx, stack);
    }
    JS_FreeValue(g_ctx, e);
}

/** Drop a pending exception a lenient read does not report. */
void clearException() {
    JS_FreeValue(g_ctx, JS_GetException(g_ctx));
}

/** A read that may throw (a getter): its exception becomes undefined. */
Val readOrUndefined(JSValue j) {
    if (JS_IsException(j)) {
        clearException();
        return borrowed(JS_UNDEFINED);
    }
    return local(j);
}

struct Frame {
    JSValueConst* argv;
};

JSValue trampoline(JSContext*, JSValueConst, int argc, JSValueConst* argv, int, void* opaque) {
    Frame frame{argv};
    Args args;
    args.impl_ = &frame;
    args.argc_ = argc;
    const size_t mark = g_locals.size();
    const Val r = reinterpret_cast<NativeFn>(opaque)(args);
    JSValue out = raw(r);
    if (!JS_IsException(out)) out = JS_DupValue(g_ctx, out);   // survives the release below
    releaseTo(mark);
    return out;
}

struct ScopeState {
    size_t mark;
};
static_assert(sizeof(ScopeState) <= 64, "Scope storage");

}  // namespace

// =============================================================================
// Values
// =============================================================================

Val Args::operator[](int i) const {
    if (i < 0 || i >= argc_) return borrowed(JS_UNDEFINED);
    return borrowed(static_cast<const Frame*>(impl_)->argv[i]);
}

Val undefined() { return borrowed(JS_UNDEFINED); }
Val null() { return borrowed(JS_NULL); }
Val boolean(bool v) { return borrowed(JS_NewBool(g_ctx, v)); }
Val number(double v) { return local(JS_NewFloat64(g_ctx, v)); }
Val int32(int32_t v) { return borrowed(JS_NewInt32(g_ctx, v)); }
Val uint32(uint32_t v) { return local(JS_NewUint32(g_ctx, v)); }
Val int64(int64_t v) { return local(JS_NewInt64(g_ctx, v)); }
Val string(std::string_view s) { return readOrUndefined(JS_NewStringLen(g_ctx, s.data(), s.size())); }
Val object() { return local(JS_NewObject(g_ctx)); }
Val array() { return local(JS_NewArray(g_ctx)); }

Val arrayBufferCopy(const void* data, size_t size) {
    return local(JS_NewArrayBufferCopy(g_ctx, static_cast<const uint8_t*>(data), size));
}

Val arrayBufferWrap(void* data, size_t size) {
    return local(JS_NewArrayBuffer(g_ctx, static_cast<uint8_t*>(data), size, nullptr, nullptr, false));
}

Val throwTypeError(const char* message) { return borrowed(JS_ThrowTypeError(g_ctx, "%s", message)); }
Val throwError(const char* message) { return borrowed(JS_ThrowInternalError(g_ctx, "%s", message)); }

bool isUndefined(Val v) { return JS_IsUndefined(raw(v)); }
bool isNull(Val v) { return JS_IsNull(raw(v)); }
bool isBool(Val v) { return JS_IsBool(raw(v)); }
bool isNumber(Val v) { return JS_IsNumber(raw(v)); }
bool isString(Val v) { return JS_IsString(raw(v)); }
bool isFunction(Val v) { return JS_IsFunction(g_ctx, raw(v)); }
bool isObject(Val v) { return JS_IsObject(raw(v)); }
bool isArray(Val v) { return JS_IsArray(raw(v)); }

double toNumber(Val v) {
    double d = 0;
    if (JS_ToFloat64(g_ctx, &d, raw(v)) < 0) { clearException(); return 0; }
    return d;
}
int32_t toInt32(Val v) {
    int32_t i = 0;
    if (JS_ToInt32(g_ctx, &i, raw(v)) < 0) { clearException(); return 0; }
    return i;
}
uint32_t toUint32(Val v) {
    uint32_t u = 0;
    if (JS_ToUint32(g_ctx, &u, raw(v)) < 0) { clearException(); return 0; }
    return u;
}
int64_t toInt64(Val v) {
    int64_t i = 0;
    if (JS_ToInt64(g_ctx, &i, raw(v)) < 0) { clearException(); return 0; }
    return i;
}
bool toBool(Val v) {
    const int b = JS_ToBool(g_ctx, raw(v));
    if (b < 0) { clearException(); return false; }
    return b != 0;
}
std::string toString(Val v) {
    Utf8 s(v);
    return std::string(s.view());
}

Utf8::Utf8(Val v) {
    size_t len = 0;
    data_ = JS_ToCStringLen(g_ctx, &len, raw(v));
    if (!data_) { clearException(); return; }
    size_ = len;
}

Utf8::~Utf8() {
    if (data_ && g_alive) JS_FreeCString(g_ctx, data_);
}

bool bytesOf(Val v, Bytes* out) {
    const JSValue j = raw(v);
    if (!JS_IsObject(j)) return false;
    if (JS_IsArrayBuffer(j)) {
        size_t size = 0;
        uint8_t* data = JS_GetArrayBuffer(g_ctx, &size, j);
        if (!data && size != 0) { clearException(); return false; }
        out->data = data;
        out->size = size;
        return true;
    }
    size_t offset = 0, length = 0, perElement = 0;
    JSValue buffer = JS_GetTypedArrayBuffer(g_ctx, j, &offset, &length, &perElement);
    if (JS_IsException(buffer)) { clearException(); return false; }
    size_t size = 0;
    uint8_t* base = JS_GetArrayBuffer(g_ctx, &size, buffer);
    JS_FreeValue(g_ctx, buffer);   // the view keeps the buffer alive
    if (!base || offset + length > size) { if (!base) clearException(); return false; }
    out->data = base + offset;
    out->size = length;
    return true;
}

// =============================================================================
// Objects
// =============================================================================

Val global() { return local(JS_GetGlobalObject(g_ctx)); }

Val get(Val obj, const char* key) {
    if (!JS_IsObject(raw(obj))) return undefined();
    return readOrUndefined(JS_GetPropertyStr(g_ctx, raw(obj), key));
}

void set(Val obj, const char* key, Val value) {
    if (JS_SetPropertyStr(g_ctx, raw(obj), key, JS_DupValue(g_ctx, raw(value))) < 0) clearException();
}

Val getAt(Val obj, uint32_t index) {
    if (!JS_IsObject(raw(obj))) return undefined();
    return readOrUndefined(JS_GetPropertyUint32(g_ctx, raw(obj), index));
}

void setAt(Val obj, uint32_t index, Val value) {
    if (JS_SetPropertyUint32(g_ctx, raw(obj), index, JS_DupValue(g_ctx, raw(value))) < 0) clearException();
}

uint32_t lengthOf(Val obj) {
    const Val len = get(obj, "length");
    return isUndefined(len) ? 0 : toUint32(len);
}

std::vector<std::string> ownKeys(Val obj) {
    std::vector<std::string> keys;
    if (!JS_IsObject(raw(obj))) return keys;
    JSPropertyEnum* tab = nullptr;
    uint32_t len = 0;
    if (JS_GetOwnPropertyNames(g_ctx, &tab, &len, raw(obj), JS_GPN_STRING_MASK | JS_GPN_ENUM_ONLY) != 0) {
        clearException();
        return keys;
    }
    keys.reserve(len);
    for (uint32_t i = 0; i < len; ++i) {
        if (const char* k = JS_AtomToCString(g_ctx, tab[i].atom)) {
            keys.emplace_back(k);
            JS_FreeCString(g_ctx, k);
        }
    }
    JS_FreePropertyEnum(g_ctx, tab, len);
    return keys;
}

void setFunction(Val obj, const char* name, NativeFn fn, int argc) {
    JSValue f = JS_NewCClosure(g_ctx, trampoline, name, nullptr, argc, 0, reinterpret_cast<void*>(fn));
    JS_SetPropertyStr(g_ctx, raw(obj), name, f);
}

bool call(Val fn, Val self, int argc, const Val* argv, const char* where, Val* result) {
    std::vector<JSValue> args(static_cast<size_t>(argc > 0 ? argc : 0));
    for (int i = 0; i < argc; ++i) args[static_cast<size_t>(i)] = raw(argv[i]);
    JSValue r = JS_Call(g_ctx, raw(fn), raw(self), argc, args.data());
    if (JS_IsException(r)) {
        reportException(where);
        if (result) *result = undefined();
        return false;
    }
    const Val out = local(r);
    if (result) *result = out;
    return true;
}

// =============================================================================
// Lifetimes
// =============================================================================

Scope::Scope() { new (storage_) ScopeState{g_locals.size()}; }
Scope::~Scope() { if (g_alive) releaseTo(reinterpret_cast<ScopeState*>(storage_)->mark); }

Ref::Ref(Val v) : handle_(new JSValue(JS_DupValue(g_ctx, raw(v)))) {}

Ref::~Ref() { reset(); }

Ref& Ref::operator=(Ref&& o) noexcept {
    if (this != &o) {
        reset();
        handle_ = o.handle_;
        o.handle_ = nullptr;
    }
    return *this;
}

Val Ref::get() const { return handle_ ? borrowed(*static_cast<JSValue*>(handle_)) : undefined(); }

void Ref::reset() {
    if (!handle_) return;
    auto* j = static_cast<JSValue*>(handle_);
    if (g_alive) JS_FreeValue(g_ctx, *j);
    delete j;
    handle_ = nullptr;
}

// =============================================================================
// The engine
// =============================================================================

void init(Logger log, const char*) {
    g_log = log;
    g_rt = JS_NewRuntime();
    g_ctx = JS_NewContext(g_rt);
    g_alive = true;
    // Process exit destroys the host's statics after this runs, and their Refs
    // must not reach a runtime the C library is tearing down.
    std::atexit([] { g_alive = false; });
}

bool alive() { return g_alive; }

std::string engineName() { return std::string("QuickJS-ng ") + JS_GetVersion(); }

bool hasJit() { return false; }

namespace {
struct EnterState {
    size_t mark;
};
static_assert(sizeof(EnterState) <= 160, "Enter storage");
}  // namespace

// QuickJS detects JS stack overflow by comparing the C stack pointer against a top
// it records once, at JS_NewRuntime. The runtime outlives the thread that made it:
// on Android an activity recreate keeps the process but hands every later JS call
// to a NEW glue thread, whose stack ASLR may map below the recorded top — at which
// point every call, however flat, throws "Maximum call stack size exceeded"
// forever. Re-anchoring at each host entry is the API's own answer, and costs one
// stack-pointer read.
Enter::Enter() {
    JS_UpdateStackTop(g_rt);
    new (storage_) EnterState{g_locals.size()};
}

Enter::~Enter() {
    if (g_alive) releaseTo(reinterpret_cast<EnterState*>(storage_)->mark);
}

void pumpMicrotasks() {
    JSContext* c = nullptr;
    for (;;) {
        const int r = JS_ExecutePendingJob(g_rt, &c);
        if (r == 0) break;
        if (r < 0) reportException("promise job");   // the queue continues past it
    }
}

void pumpEngine() {}

bool run(std::string_view source, const char* name) {
    // JS_Eval reads a NUL-terminated buffer.
    const std::string src(source);
    JSValue r = JS_Eval(g_ctx, src.c_str(), src.size(), name, JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(r)) {
        reportException(name);
        return false;
    }
    JS_FreeValue(g_ctx, r);
    return true;
}

bool runCached(std::string_view source, const char* name, const uint8_t* cache, size_t cacheSize,
               CacheUse* use, std::string* why, std::vector<uint8_t>* fresh) {
    if (use) *use = CacheUse::None;
    JSValue fn = JS_UNDEFINED;
    if (cache && cacheSize) {
        fn = JS_ReadObject(g_ctx, cache, cacheSize, JS_READ_OBJ_BYTECODE);
        if (JS_IsException(fn)) {
            JSValue e = JS_GetException(g_ctx);
            if (why) *why = describe(e);
            JS_FreeValue(g_ctx, e);
            if (use) *use = CacheUse::Rejected;
            fn = JS_UNDEFINED;
        } else if (use) {
            *use = CacheUse::Used;
        }
    }
    if (JS_IsUndefined(fn)) {
        const std::string src(source);
        fn = JS_Eval(g_ctx, src.c_str(), src.size(), name, JS_EVAL_TYPE_GLOBAL | JS_EVAL_FLAG_COMPILE_ONLY);
        if (JS_IsException(fn)) {
            reportException(name);
            return false;
        }
        if (fresh) {
            size_t len = 0;
            if (uint8_t* bc = JS_WriteObject(g_ctx, &len, fn, JS_WRITE_OBJ_BYTECODE)) {
                fresh->assign(bc, bc + len);
                js_free(g_ctx, bc);
            }
        }
    }
    JSValue r = JS_EvalFunction(g_ctx, fn);   // consumes fn
    if (JS_IsException(r)) {
        reportException(name);
        return false;
    }
    JS_FreeValue(g_ctx, r);
    return true;
}

const char* cacheTag() { return "qjsbc"; }

}  // namespace esjs
