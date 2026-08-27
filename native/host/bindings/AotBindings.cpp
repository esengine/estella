// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AotBindings.cpp
 * @brief   es_aot_* — the compiled systems a shipped desktop build loads.
 * @details The web road hands the module the engine's memory and lets JS pack
 *          the rows. Here the engine IS the process: an address is a pointer
 *          nothing in QuickJS can hold, so the rows are packed on this side and
 *          JS says only which system to run.
 *
 *          What this owns is the naming. `aot::Dispatcher` does the loading and
 *          the calling; the engine's own components come from the generated
 *          table; and a project's own live in the pool the SDK allocated out of
 *          the shared heap, so JS reports where those rows are — by OFFSET,
 *          which is the one currency both sides already speak (heap.hpp).
 *
 *          Those reports land in slots with stable addresses, because a pool
 *          reallocates as it grows and a resolver bound at install would keep
 *          reading the first home (aot::fromMovingRows).
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#include "Bindings.hpp"

#include "heap.hpp"
#include "esn_shim.hpp"

#include "esengine/aot/AotCommands.hpp"
#include "esengine/aot/AotComponents.generated.hpp"
#include "esengine/aot/AotDispatcher.hpp"
#include "esengine/aot/EngineDigest.generated.h"

#include <deque>
#include <string>
#include <unordered_map>
#include <vector>

using namespace esengine;

namespace eshost {
namespace {

/**
 * Everything the es_aot_* calls share for one loaded module.
 *
 * A deque for the slots, not a vector: `fromMovingRows` holds the address of
 * one, and a vector hands those out and then invalidates them on the next push.
 */
struct AotState {
    aot::Dispatcher dispatcher;
    std::deque<aot::RowSpan> scriptSpans;
    std::unordered_map<std::string, aot::RowSpan*> scriptByName;
    std::unordered_map<std::string, void*> resources;
    /** Candidates for a call, rebuilt per run. Kept so a frame allocates none. */
    std::vector<std::uint32_t> candidates;
    bool installed = false;
};

AotState& state() {
    static AotState s;
    return s;
}

/** The slot for a script component, created on first mention and never moved. */
aot::RowSpan* slotFor(const std::string& name) {
    AotState& s = state();
    auto found = s.scriptByName.find(name);
    if (found != s.scriptByName.end()) return found->second;
    s.scriptSpans.emplace_back();
    aot::RowSpan* slot = &s.scriptSpans.back();
    s.scriptByName.emplace(name, slot);
    return slot;
}

/**
 * Who can name a component here: the engine's own from the generated table,
 * and the project's from whatever JS has reported. A name neither answers for
 * leaves its system unbound, which is the interpreter keeping it.
 */
aot::ComponentAt componentAt(const char* name) {
    if (aot::isEngineComponent(name)) return aot::engineComponentAt(*host().registry, name);
    AotState& s = state();
    auto found = s.scriptByName.find(name);
    return found == s.scriptByName.end() ? aot::ComponentAt{} : aot::fromMovingRows(found->second);
}

void* resourceAt(const char* name) {
    AotState& s = state();
    auto found = s.resources.find(name);
    return found == s.resources.end() ? nullptr : found->second;
}

// — the calls —

/** es_aot_install(path) -> system count, or -1 with the reason logged. */
JSValue js_install(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (argc < 1) return JS_NewInt32(ctx, -1);
    const char* path = JS_ToCString(ctx, argv[0]);
    if (path == nullptr) return JS_NewInt32(ctx, -1);

    // A content-relative name, resolved the way every other packaged file is:
    // the OS loader searches its own path for a bare name and would find
    // anything but this one.
    const std::string resolved = host().platform ? host().platform->assetPath(path) : std::string{};
    const char* open = resolved.empty() ? path : resolved.c_str();

    AotState& s = state();
    std::string why;
    const bool ok = s.dispatcher.install(open, aot::abiHash(ES_ENGINE_ABI_DIGEST),
                                         componentAt, resourceAt, &why);
    if (!ok) ESHOST_LOGE("[aot] %s: %s", path, why.c_str());
    JS_FreeCString(ctx, path);
    s.installed = ok;
    return JS_NewInt32(ctx, ok ? static_cast<int>(s.dispatcher.count()) : -1);
}

/** es_aot_index(name) -> the index the scheduler keeps, or -1. */
JSValue js_index(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (argc < 1) return JS_NewInt32(ctx, -1);
    const char* name = JS_ToCString(ctx, argv[0]);
    if (name == nullptr) return JS_NewInt32(ctx, -1);
    const std::size_t at = state().dispatcher.indexOf(name);
    JS_FreeCString(ctx, name);
    return JS_NewInt32(ctx, at == aot::Dispatcher::npos ? -1 : static_cast<int>(at));
}

/** es_aot_bound(i) -> whether that system resolved; an unbound one interprets. */
JSValue js_bound(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (argc < 1) return JS_FALSE;
    std::uint32_t i = 0;
    JS_ToUint32(ctx, &i, argv[0]);
    return JS_NewBool(ctx, state().dispatcher.boundAt(i));
}

/**
 * es_aot_script_rows(name, sparseOff, sparseCount, rowsOff, stride, indexMask)
 *
 * Where a project component's rows are NOW. Called again whenever the pool
 * moves them; passing 0 for the row offset says the pool is gone.
 */
JSValue js_scriptRows(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (argc < 6) return JS_FALSE;
    const char* name = JS_ToCString(ctx, argv[0]);
    if (name == nullptr) return JS_FALSE;
    std::uint32_t sparseOff = 0, sparseCount = 0, rowsOff = 0, stride = 0, mask = 0;
    JS_ToUint32(ctx, &sparseOff, argv[1]);
    JS_ToUint32(ctx, &sparseCount, argv[2]);
    JS_ToUint32(ctx, &rowsOff, argv[3]);
    JS_ToUint32(ctx, &stride, argv[4]);
    JS_ToUint32(ctx, &mask, argv[5]);

    // Range-checked through the heap rather than trusted: an offset is a number
    // JS computed, and a wrong one here is a read outside the arena.
    void* sparse = heapPtr(sparseOff, static_cast<std::size_t>(sparseCount) * sizeof(std::uint32_t));
    void* rows = rowsOff == 0 ? nullptr : heapPtr(rowsOff, stride);
    aot::RowSpan* slot = slotFor(name);
    JS_FreeCString(ctx, name);
    if (sparse == nullptr && sparseCount > 0) return JS_FALSE;

    *slot = aot::RowSpan{
        static_cast<const std::uint32_t*>(sparse), sparseCount,
        static_cast<unsigned char*>(rows), stride, mask,
    };
    return JS_TRUE;
}

/** es_aot_resource(name, offset, bytes) -> where one call reads that resource. */
JSValue js_resource(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (argc < 3) return JS_FALSE;
    const char* name = JS_ToCString(ctx, argv[0]);
    if (name == nullptr) return JS_FALSE;
    std::uint32_t offset = 0, bytes = 0;
    JS_ToUint32(ctx, &offset, argv[1]);
    JS_ToUint32(ctx, &bytes, argv[2]);
    void* at = heapPtr(offset, bytes);
    if (at != nullptr) state().resources[name] = at;
    JS_FreeCString(ctx, name);
    return JS_NewBool(ctx, at != nullptr);
}

/**
 * es_aot_run(i) -> records this host did not know, or -1 when nothing ran.
 *
 * The candidates are every live entity: a row survives only where every
 * component resolved, so the completeness check IS the filter. Narrowing it to
 * a pool would need the smallest one, and which that is depends on the query.
 */
JSValue js_run(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (argc < 1) return JS_NewInt32(ctx, -1);
    std::uint32_t i = 0;
    JS_ToUint32(ctx, &i, argv[0]);
    AotState& s = state();
    if (!s.installed) return JS_NewInt32(ctx, -1);

    s.candidates.clear();
    host().registry->forEachEntity([&s](esengine::Entity e) { s.candidates.push_back(e.id()); });
    const auto cmds = s.dispatcher.run(i, s.candidates, resourceAt);
    // Asked AFTER the run, because that is where a late binding is settled.
    if (!s.dispatcher.boundAt(i)) return JS_NewInt32(ctx, -1);
    // After the call, never during it: a despawn invalidates the rows it read.
    return JS_NewInt32(ctx, static_cast<int>(aot::applyCommands(*host().registry, cmds)));
}

/** es_aot_reset() — close the module and forget every name. */
JSValue js_reset(JSContext* ctx, JSValueConst, int, JSValueConst*) {
    AotState& s = state();
    s.dispatcher.reset();
    s.scriptByName.clear();
    s.scriptSpans.clear();
    s.resources.clear();
    s.installed = false;
    return JS_UNDEFINED;
}

}  // namespace

void registerAotBindings(HostState& h, JSValue global) {
    const auto fn = [&](const char* name, JSCFunction* impl, int arity) {
        JS_SetPropertyStr(h.js, global, name, JS_NewCFunction(h.js, impl, name, arity));
    };
    fn("es_aot_install", js_install, 1);
    fn("es_aot_index", js_index, 1);
    fn("es_aot_bound", js_bound, 1);
    fn("es_aot_script_rows", js_scriptRows, 6);
    fn("es_aot_resource", js_resource, 3);
    fn("es_aot_run", js_run, 1);
    fn("es_aot_reset", js_reset, 0);
}

}  // namespace eshost
