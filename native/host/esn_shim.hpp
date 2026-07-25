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

#include <cstdint>
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
// into `out`.
void esn_bytes(JSContext* ctx, JSValueConst v, std::vector<esengine::u8>& out);

// --- the heap a `uintptr_t` argument addresses (see host/heap.hpp) ------------
// A generated wrapper reads such an argument through this pair, so the entry
// points that marshal bulk data — tile arrays, polygon vertices, spine meshes —
// mean the same thing on both platforms.
//
//   a number    → an offset into the host's heap arena, exactly as it is an offset
//                 into wasm's linear memory on the web. Shared memory, so an entry
//                 point that WRITES into the buffer is seen by JS.
//   a JS buffer → copied into the arena for the duration of the call, for callers
//                 that hand bytes straight across (the renderer's native backend).
//
// Returns 0 when there is nothing to pass, which every binding treats as null.
uint32_t esn_argOffset(JSContext* ctx, JSValueConst v);
// Release what esn_argOffset copied in. A no-op when the argument was an offset.
void esn_argRelease(JSContext* ctx, JSValueConst v, uint32_t offset);
// Resolve a heap offset to the real address a binding takes, or 0 if out of range.
uintptr_t esn_heapAddr(uint32_t offset);

// One entry point's readback slot. An entry point that RETURNS a pointer hands
// back memory the module owns (a static buffer, a vector's storage) which is not
// in the heap JS reads; the wrapper copies the `@heapreturn` byte count into its
// own slot and answers that offset. One slot per entry point — so two consecutive
// readbacks never clobber each other — grown on demand, never shrunk.
struct EsnSlot {
    uint32_t offset = 0;
    size_t capacity = 0;
};
uint32_t esn_publish(EsnSlot& slot, const void* src, size_t bytes);

// --- provided by the generated files -----------------------------------------
// Components (NativeBindings.generated.cpp) and the engine's binding entry
// points (NativeFunctionBindings.generated.cpp), from the same declarations the
// web build registers with embind.
void esn_register(JSContext* ctx, JSValue global);
void esn_register_functions(JSContext* ctx, JSValue global);
