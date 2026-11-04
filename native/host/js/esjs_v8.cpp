// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    esjs_v8.cpp
 * @brief   esjs over V8 — the engine where a JIT is allowed (desktop, Android).
 * @details One isolate and one context for the process. What this file adds to
 *          the plain embedding is what the host's contract asks for and V8 does
 *          not assume:
 *
 *            * Microtasks run when the host pumps them, not whenever a call
 *              returns — app.tick() is async, and the frame loop decides when its
 *              systems run (QuickJS's job queue has the same shape).
 *            * The isolate is entered per host entry, under a Locker, because a
 *              platform may hand the next frame to a different thread (Android
 *              recreates its glue thread), and the stack limit follows the thread.
 *            * A read that throws (a getter, a valueOf) answers a default, as the
 *              QuickJS backend does: bindings read loosely-shaped SDK objects and
 *              must not leave an exception pending behind a normal return.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#include "esjs.hpp"

#include <libplatform/libplatform.h>
#include <v8.h>

#include <cstdlib>
#include <cstring>
#include <memory>
#include <new>
#include <thread>

#if defined(ESJS_V8_ICU) && defined(_WIN32)
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#endif

namespace esjs {
namespace {

static_assert(sizeof(v8::Local<v8::Value>) == sizeof(void*), "a Local is one pointer");

std::unique_ptr<v8::Platform> g_platform;
v8::ArrayBuffer::Allocator* g_allocator = nullptr;
v8::Isolate* g_iso = nullptr;
v8::Global<v8::Context> g_context;
Logger g_log = nullptr;
bool g_alive = false;
std::thread::id g_thread;

// A Val's bits: the Local's pointer, and a flag for "an exception is pending".
constexpr size_t kThrewByte = 8;

inline v8::Local<v8::Value> raw(Val v) {
    v8::Local<v8::Value> l;
    std::memcpy(static_cast<void*>(&l), v.bits, sizeof(l));
    return l;
}

inline Val wrap(v8::Local<v8::Value> l) {
    Val v;
    std::memcpy(v.bits, static_cast<const void*>(&l), sizeof(l));
    return v;
}

inline Val threw() {
    Val v;
    v.bits[kThrewByte] = 1;
    return v;
}

inline bool isThrew(Val v) { return v.bits[kThrewByte] != 0; }

inline v8::Local<v8::Context> ctx() { return g_context.Get(g_iso); }

void say(bool error, const std::string& s) {
    if (g_log) g_log(error, s.c_str());
}

std::string utf8Of(v8::Local<v8::Value> v) {
    if (v.IsEmpty()) return {};
    v8::String::Utf8Value s(g_iso, v);
    return *s ? std::string(*s, static_cast<size_t>(s.length())) : std::string("?");
}

/** Report what a TryCatch caught, with its stack: a bare message ("Maximum call
 *  stack size exceeded") says nothing about which SDK path produced it. */
void report(v8::TryCatch& tc, const char* where) {
    if (!tc.HasCaught()) return;
    say(true, std::string("JS error in ") + where + ": " + utf8Of(tc.Exception()));
    v8::Local<v8::Value> stack;
    if (tc.StackTrace(ctx()).ToLocal(&stack) && stack->IsString()) {
        say(true, "  stack: " + utf8Of(stack));
    }
}

/** An exception nothing caught — a microtask's, a promise job's. */
void onMessage(v8::Local<v8::Message> message, v8::Local<v8::Value> error) {
    std::string where = utf8Of(message->GetScriptResourceName());
    const int line = message->GetLineNumber(ctx()).FromMaybe(0);
    say(true, "JS error in " + (where.empty() ? std::string("promise job") : where) + ":"
              + std::to_string(line) + ": " + utf8Of(error));
    v8::Local<v8::Value> stack;
    if (error->IsObject() &&
        error.As<v8::Object>()->Get(ctx(), v8::String::NewFromUtf8Literal(g_iso, "stack")).ToLocal(&stack) &&
        stack->IsString()) {
        say(true, "  stack: " + utf8Of(stack));
    }
}

v8::Local<v8::String> key(const char* k) {
    return v8::String::NewFromUtf8(g_iso, k, v8::NewStringType::kInternalized).ToLocalChecked();
}

void trampoline(const v8::FunctionCallbackInfo<v8::Value>& info) {
    const auto fn = reinterpret_cast<NativeFn>(info.Data().As<v8::External>()->Value());
    Args args;
    args.impl_ = &info;
    args.argc_ = info.Length();
    const Val r = fn(args);
    if (isThrew(r)) return;   // the exception is already scheduled
    const v8::Local<v8::Value> out = raw(r);
    if (!out.IsEmpty()) info.GetReturnValue().Set(out);
}

/** Bind the isolate's stack limit to the calling thread when it changes: V8 takes
 *  it from the thread that made the isolate, and a later thread's stack lies
 *  somewhere else entirely. The budget is what a platform thread reliably has
 *  below a host entry. */
void followThread() {
    const auto self = std::this_thread::get_id();
    if (self == g_thread) return;
    g_thread = self;
    constexpr uintptr_t kBudget = 768 * 1024;
    const uintptr_t here = reinterpret_cast<uintptr_t>(&self);
    if (here > kBudget) g_iso->SetStackLimit(here - kBudget);
}

struct EnterState {
    v8::Locker locker;
    v8::Isolate::Scope isolateScope;
    v8::HandleScope handles;
    v8::Context::Scope contextScope;
    explicit EnterState(v8::Isolate* iso)
        : locker(iso), isolateScope(iso), handles(iso), contextScope(g_context.Get(iso)) {}
};
static_assert(sizeof(EnterState) <= 160, "Enter storage");
static_assert(sizeof(v8::HandleScope) <= 64, "Scope storage");

}  // namespace

// =============================================================================
// Values
// =============================================================================

Val Args::operator[](int i) const {
    const auto& info = *static_cast<const v8::FunctionCallbackInfo<v8::Value>*>(impl_);
    return wrap(info[i]);   // undefined past Length()
}

Val undefined() { return wrap(v8::Undefined(g_iso)); }
Val null() { return wrap(v8::Null(g_iso)); }
Val boolean(bool v) { return wrap(v8::Boolean::New(g_iso, v)); }
Val number(double v) { return wrap(v8::Number::New(g_iso, v)); }
Val int32(int32_t v) { return wrap(v8::Integer::New(g_iso, v)); }
Val uint32(uint32_t v) { return wrap(v8::Integer::NewFromUnsigned(g_iso, v)); }
Val int64(int64_t v) { return wrap(v8::Number::New(g_iso, static_cast<double>(v))); }

Val string(std::string_view s) {
    v8::Local<v8::String> out;
    if (!v8::String::NewFromUtf8(g_iso, s.data(), v8::NewStringType::kNormal, static_cast<int>(s.size()))
             .ToLocal(&out)) {
        return undefined();   // longer than V8's string limit
    }
    return wrap(out);
}

Val object() { return wrap(v8::Object::New(g_iso)); }
Val array() { return wrap(v8::Array::New(g_iso)); }

Val arrayBufferCopy(const void* data, size_t size) {
    v8::Local<v8::ArrayBuffer> ab = v8::ArrayBuffer::New(g_iso, size);
    if (size) std::memcpy(ab->GetBackingStore()->Data(), data, size);
    return wrap(ab);
}

Val arrayBufferWrap(void* data, size_t size) {
    auto store = v8::ArrayBuffer::NewBackingStore(data, size, v8::BackingStore::EmptyDeleter, nullptr);
    return wrap(v8::ArrayBuffer::New(g_iso, std::move(store)));
}

Val throwTypeError(const char* message) {
    g_iso->ThrowException(v8::Exception::TypeError(key(message)));
    return threw();
}

Val throwError(const char* message) {
    g_iso->ThrowException(v8::Exception::Error(key(message)));
    return threw();
}

bool isUndefined(Val v) { return raw(v)->IsUndefined(); }
bool isNull(Val v) { return raw(v)->IsNull(); }
bool isBool(Val v) { return raw(v)->IsBoolean(); }
bool isNumber(Val v) { return raw(v)->IsNumber(); }
bool isString(Val v) { return raw(v)->IsString(); }
bool isFunction(Val v) { return raw(v)->IsFunction(); }
bool isObject(Val v) { return raw(v)->IsObject(); }
bool isArray(Val v) { return raw(v)->IsArray(); }

double toNumber(Val v) {
    const v8::Local<v8::Value> l = raw(v);
    if (l->IsNumber()) return l.As<v8::Number>()->Value();
    v8::TryCatch tc(g_iso);
    return l->NumberValue(ctx()).FromMaybe(0);
}

int32_t toInt32(Val v) {
    const v8::Local<v8::Value> l = raw(v);
    if (l->IsInt32()) return l.As<v8::Int32>()->Value();
    v8::TryCatch tc(g_iso);
    return l->Int32Value(ctx()).FromMaybe(0);
}

uint32_t toUint32(Val v) {
    const v8::Local<v8::Value> l = raw(v);
    if (l->IsUint32()) return l.As<v8::Uint32>()->Value();
    v8::TryCatch tc(g_iso);
    return l->Uint32Value(ctx()).FromMaybe(0);
}

int64_t toInt64(Val v) {
    const v8::Local<v8::Value> l = raw(v);
    if (l->IsInt32()) return l.As<v8::Int32>()->Value();
    v8::TryCatch tc(g_iso);
    return l->IntegerValue(ctx()).FromMaybe(0);
}

bool toBool(Val v) { return raw(v)->BooleanValue(g_iso); }

std::string toString(Val v) {
    Utf8 s(v);
    return std::string(s.view());
}

Utf8::Utf8(Val v) {
    v8::Local<v8::Value> l = raw(v);
    v8::Local<v8::String> s;
    if (l->IsString()) {
        s = l.As<v8::String>();
    } else {
        v8::TryCatch tc(g_iso);
        if (!l->ToString(ctx()).ToLocal(&s)) return;
    }
    own_.resize(static_cast<size_t>(s->Utf8Length(g_iso)));
    if (!own_.empty()) {
        s->WriteUtf8(g_iso, own_.data(), static_cast<int>(own_.size()), nullptr,
                     v8::String::NO_NULL_TERMINATION | v8::String::REPLACE_INVALID_UTF8);
    }
    data_ = own_.c_str();
    size_ = own_.size();
}

Utf8::~Utf8() = default;

bool bytesOf(Val v, Bytes* out) {
    const v8::Local<v8::Value> l = raw(v);
    if (l->IsArrayBuffer()) {
        auto store = l.As<v8::ArrayBuffer>()->GetBackingStore();
        out->data = static_cast<uint8_t*>(store->Data());
        out->size = store->ByteLength();
        return true;
    }
    if (l->IsArrayBufferView()) {
        const auto view = l.As<v8::ArrayBufferView>();
        auto store = view->Buffer()->GetBackingStore();
        const size_t offset = view->ByteOffset(), length = view->ByteLength();
        if (offset + length > store->ByteLength()) return false;
        out->data = static_cast<uint8_t*>(store->Data()) + offset;
        out->size = length;
        return true;
    }
    return false;
}

// =============================================================================
// Objects
// =============================================================================

Val global() { return wrap(ctx()->Global()); }

Val get(Val obj, const char* k) {
    const v8::Local<v8::Value> o = raw(obj);
    if (!o->IsObject()) return undefined();
    v8::TryCatch tc(g_iso);
    v8::Local<v8::Value> out;
    if (!o.As<v8::Object>()->Get(ctx(), key(k)).ToLocal(&out)) return undefined();
    return wrap(out);
}

void set(Val obj, const char* k, Val value) {
    const v8::Local<v8::Value> o = raw(obj);
    if (!o->IsObject()) return;
    v8::TryCatch tc(g_iso);
    (void)o.As<v8::Object>()->Set(ctx(), key(k), raw(value));
}

Val getAt(Val obj, uint32_t index) {
    const v8::Local<v8::Value> o = raw(obj);
    if (!o->IsObject()) return undefined();
    v8::TryCatch tc(g_iso);
    v8::Local<v8::Value> out;
    if (!o.As<v8::Object>()->Get(ctx(), index).ToLocal(&out)) return undefined();
    return wrap(out);
}

void setAt(Val obj, uint32_t index, Val value) {
    const v8::Local<v8::Value> o = raw(obj);
    if (!o->IsObject()) return;
    v8::TryCatch tc(g_iso);
    (void)o.As<v8::Object>()->Set(ctx(), index, raw(value));
}

uint32_t lengthOf(Val obj) {
    const v8::Local<v8::Value> o = raw(obj);
    if (o->IsArray()) return o.As<v8::Array>()->Length();
    const Val len = get(obj, "length");
    return isUndefined(len) ? 0 : toUint32(len);
}

std::vector<std::string> ownKeys(Val obj) {
    std::vector<std::string> keys;
    const v8::Local<v8::Value> o = raw(obj);
    if (!o->IsObject()) return keys;
    v8::TryCatch tc(g_iso);
    v8::Local<v8::Array> names;
    if (!o.As<v8::Object>()
             ->GetOwnPropertyNames(ctx(), static_cast<v8::PropertyFilter>(
                                              v8::ONLY_ENUMERABLE | v8::SKIP_SYMBOLS))
             .ToLocal(&names)) {
        return keys;
    }
    const uint32_t n = names->Length();
    keys.reserve(n);
    for (uint32_t i = 0; i < n; ++i) {
        v8::Local<v8::Value> name;
        if (names->Get(ctx(), i).ToLocal(&name)) keys.push_back(utf8Of(name));
    }
    return keys;
}

void setFunction(Val obj, const char* name, NativeFn fn, int argc) {
    const v8::Local<v8::Value> o = raw(obj);
    if (!o->IsObject()) return;
    auto tmpl = v8::FunctionTemplate::New(g_iso, trampoline,
                                          v8::External::New(g_iso, reinterpret_cast<void*>(fn)),
                                          v8::Local<v8::Signature>(), argc,
                                          v8::ConstructorBehavior::kThrow);
    v8::Local<v8::Function> f;
    if (!tmpl->GetFunction(ctx()).ToLocal(&f)) return;
    f->SetName(key(name));
    (void)o.As<v8::Object>()->Set(ctx(), key(name), f);
}

bool call(Val fn, Val self, int argc, const Val* argv, const char* where, Val* result) {
    if (result) *result = undefined();
    const v8::Local<v8::Value> f = raw(fn);
    if (!f->IsFunction()) return false;
    std::vector<v8::Local<v8::Value>> args(static_cast<size_t>(argc > 0 ? argc : 0));
    for (int i = 0; i < argc; ++i) args[static_cast<size_t>(i)] = raw(argv[i]);
    v8::TryCatch tc(g_iso);
    v8::Local<v8::Value> out;
    if (!f.As<v8::Function>()->Call(ctx(), raw(self), argc, args.data()).ToLocal(&out)) {
        report(tc, where);
        return false;
    }
    if (result) *result = wrap(out);
    return true;
}

// =============================================================================
// Lifetimes
// =============================================================================

Scope::Scope() { ::new (storage_) v8::HandleScope(g_iso); }   // :: — HandleScope hides operator new
Scope::~Scope() { reinterpret_cast<v8::HandleScope*>(storage_)->~HandleScope(); }

Ref::Ref(Val v) : handle_(new v8::Global<v8::Value>(g_iso, raw(v))) {}

Ref::~Ref() { reset(); }

Ref& Ref::operator=(Ref&& o) noexcept {
    if (this != &o) {
        reset();
        handle_ = o.handle_;
        o.handle_ = nullptr;
    }
    return *this;
}

Val Ref::get() const {
    if (!handle_) return undefined();
    return wrap(static_cast<v8::Global<v8::Value>*>(handle_)->Get(g_iso));
}

void Ref::reset() {
    if (!handle_) return;
    auto* g = static_cast<v8::Global<v8::Value>*>(handle_);
    if (g_alive) delete g;   // after exit the isolate is not ours to touch; the OS reclaims it
    handle_ = nullptr;
}

// =============================================================================
// The engine
// =============================================================================

void init(Logger log, const char* exePath) {
    g_log = log;
#if defined(ESJS_V8_ICU)
    // A build with Intl reads its locale data from icudtl.dat beside the binary.
#if defined(_WIN32)
    char self[MAX_PATH] = {};
    if (!exePath && GetModuleFileNameA(nullptr, self, MAX_PATH)) exePath = self;
#endif
    if (!v8::V8::InitializeICUDefaultLocation(exePath ? exePath : "")) {
        say(true, "V8: icudtl.dat not found beside the executable — Intl will not work");
    }
#else
    (void)exePath;
#endif
    g_platform = v8::platform::NewDefaultPlatform();
    v8::V8::InitializePlatform(g_platform.get());
    v8::V8::Initialize();

    g_allocator = v8::ArrayBuffer::Allocator::NewDefaultAllocator();
    v8::Isolate::CreateParams params;
    params.array_buffer_allocator = g_allocator;
    g_iso = v8::Isolate::New(params);
    g_thread = std::this_thread::get_id();
    {
        v8::Locker locker(g_iso);
        v8::Isolate::Scope isolateScope(g_iso);
        v8::HandleScope handles(g_iso);
        g_iso->SetMicrotasksPolicy(v8::MicrotasksPolicy::kExplicit);
        g_iso->AddMessageListener(onMessage);
        g_context.Reset(g_iso, v8::Context::New(g_iso));
    }
    g_alive = true;
    // Process exit destroys the host's statics after this runs, and their Refs
    // must not reach an isolate whose platform the C library is tearing down.
    std::atexit([] { g_alive = false; });
}

bool alive() { return g_alive; }

std::string engineName() { return std::string("V8 ") + v8::V8::GetVersion(); }

bool hasJit() { return true; }

Enter::Enter() {
    ::new (storage_) EnterState(g_iso);
    followThread();
}

Enter::~Enter() { reinterpret_cast<EnterState*>(storage_)->~EnterState(); }

void pumpMicrotasks() { g_iso->PerformMicrotaskCheckpoint(); }

void pumpEngine() {
    while (v8::platform::PumpMessageLoop(g_platform.get(), g_iso)) {
    }
}

namespace {

bool compileAndRun(std::string_view source, const char* name, v8::ScriptCompiler::CachedData* cache,
                   CacheUse* use, std::vector<uint8_t>* fresh) {
    v8::TryCatch tc(g_iso);
    v8::Local<v8::String> code;
    if (!v8::String::NewFromUtf8(g_iso, source.data(), v8::NewStringType::kNormal,
                                 static_cast<int>(source.size()))
             .ToLocal(&code)) {
        say(true, std::string("JS error in ") + name + ": source too large");
        return false;
    }
    v8::ScriptOrigin origin(g_iso, key(name));
    v8::ScriptCompiler::Source src(code, origin, cache);   // takes the cache
    const auto options = cache ? v8::ScriptCompiler::kConsumeCodeCache : v8::ScriptCompiler::kNoCompileOptions;
    v8::Local<v8::Script> script;
    if (!v8::ScriptCompiler::Compile(ctx(), &src, options).ToLocal(&script)) {
        report(tc, name);
        return false;
    }
    if (cache && use) *use = src.GetCachedData()->rejected ? CacheUse::Rejected : CacheUse::Used;
    v8::Local<v8::Value> result;
    if (!script->Run(ctx()).ToLocal(&result)) {
        report(tc, name);
        return false;
    }
    // After the run, so the functions the top level compiled are in the blob too.
    if (fresh && (!use || *use != CacheUse::Used)) {
        std::unique_ptr<v8::ScriptCompiler::CachedData> out(
            v8::ScriptCompiler::CreateCodeCache(script->GetUnboundScript()));
        if (out) fresh->assign(out->data, out->data + out->length);
    }
    return true;
}

}  // namespace

bool run(std::string_view source, const char* name) {
    return compileAndRun(source, name, nullptr, nullptr, nullptr);
}

bool runCached(std::string_view source, const char* name, const uint8_t* cache, size_t cacheSize,
               CacheUse* use, std::string* why, std::vector<uint8_t>* fresh) {
    if (use) *use = CacheUse::None;
    v8::ScriptCompiler::CachedData* data = nullptr;
    if (cache && cacheSize) {
        data = new v8::ScriptCompiler::CachedData(cache, static_cast<int>(cacheSize),
                                                  v8::ScriptCompiler::CachedData::BufferNotOwned);
    }
    const bool ok = compileAndRun(source, name, data, use, fresh);
    if (use && *use == CacheUse::Rejected && why) {
        *why = "built by a different V8 build, flag set or source";
    }
    return ok;
}

const char* cacheTag() { return "v8cache"; }

}  // namespace esjs
