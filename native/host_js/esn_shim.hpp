// Runtime shim the EHT-generated native bindings call. The generator emits the
// per-field marshalling (reflection-driven); this header declares the plumbing
// (registry access, entity lookup, JS-value readers) that the host defines.
//
// NativeBindings.generated.cpp includes this header first, then self-includes
// each bound component's header — so the shim itself needs no component headers.
#pragma once

extern "C" {
#include "quickjs.h"
}

#include "esengine/ecs/Registry.hpp"  // esengine::ecs::Registry + esengine::Entity

// --- provided by the host (js/main.cpp) --------------------------------------
esengine::ecs::Registry& esn_reg();
esengine::Entity esn_entity(JSContext* ctx, JSValueConst v);
// Read obj[key] as a number into *out; returns true if present & numeric.
bool esn_getnum(JSContext* ctx, JSValueConst obj, const char* key, double* out);
// Read obj[key] as a truthy int into *out; returns true if present.
bool esn_getbool(JSContext* ctx, JSValueConst obj, const char* key, int* out);
// Read obj[key] as an array of n numbers into dst[0..n-1] (no-op if absent).
void esn_getvec(JSContext* ctx, JSValueConst obj, const char* key, float* dst, int n);
// Wrap [ptr, ptr+size) as a zero-copy JS ArrayBuffer (native owns the memory).
JSValue esn_arraybuffer(JSContext* ctx, void* ptr, size_t size);

// --- provided by the generated file (NativeBindings.generated.cpp) -----------
void esn_register(JSContext* ctx, JSValue global);
