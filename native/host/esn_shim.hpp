// Runtime shim the EHT-generated native bindings call. The generator emits the
// per-field marshalling (reflection-driven); this header declares the plumbing
// (engine singletons, entity lookup, JS-value readers) that the host defines.
//
// NativeBindings.generated.cpp includes this header first, then self-includes
// each bound component's header — so the shim itself needs no component headers.
#pragma once

extern "C" {
#include "quickjs.h"
}

#include "esengine/ecs/Registry.hpp"             // esengine::ecs::Registry + esengine::Entity
#include "esengine/resource/ResourceManager.hpp" // esengine::resource::ResourceManager
#include "esengine/core/Types.hpp"               // esengine::u8

#include <vector>

// --- provided by the host (host/Runtime.cpp) ---------------------------------
// The engine singletons a binding declaration takes by reference: the host runs
// exactly one of each, so the generated wrapper passes these instead of reading
// a JS argument.
esengine::ecs::Registry& esn_reg();
esengine::resource::ResourceManager& esn_rm();
esengine::Entity esn_entity(JSContext* ctx, JSValueConst v);
// Read obj[key] as a number into *out; returns true if present & numeric.
bool esn_getnum(JSContext* ctx, JSValueConst obj, const char* key, double* out);
// Read obj[key] as a truthy int into *out; returns true if present.
bool esn_getbool(JSContext* ctx, JSValueConst obj, const char* key, int* out);
// Read obj[key] as an array of n numbers into dst[0..n-1] (no-op if absent).
void esn_getvec(JSContext* ctx, JSValueConst obj, const char* key, float* dst, int n);
// Wrap [ptr, ptr+size) as a zero-copy JS ArrayBuffer (native owns the memory).
JSValue esn_arraybuffer(JSContext* ctx, void* ptr, size_t size);
// Read a JS byte source (ArrayBuffer, typed-array view, or plain number array)
// into `out`. Backs the generated wrappers for entry points that take a
// `uintptr_t` buffer: on the web that is a wasm heap offset, here it is real
// memory the wrapper owns for the duration of the call.
void esn_bytes(JSContext* ctx, JSValueConst v, std::vector<esengine::u8>& out);

// --- provided by the generated files -----------------------------------------
// Components (NativeBindings.generated.cpp) and the engine's binding entry
// points (NativeFunctionBindings.generated.cpp), from the same declarations the
// web build registers with embind.
void esn_register(JSContext* ctx, JSValue global);
void esn_register_functions(JSContext* ctx, JSValue global);
