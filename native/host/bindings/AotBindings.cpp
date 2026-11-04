// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AotBindings.cpp
 * @brief   es_aot_* — the compiled systems a shipped desktop build loads.
 * @details The web road hands the module the engine's memory and lets JS pack
 *          the rows. Here the engine IS the process: an address is a pointer
 *          nothing in JS can hold, so the rows are packed on this side and
 *          JS says only which system to run.
 *
 *          What this owns is the naming, in both directions. Where one component
 *          is for an entity, and WHO holds it — the second is what lets a query
 *          narrow to its shortest column instead of being offered the world.
 *          `aot::Dispatcher` does the loading and the calling; the engine's own
 *          components come from the generated table; and a project's own live in
 *          the pool the SDK allocated out of the shared heap, so JS reports where
 *          those rows are — by OFFSET, which is the one currency both sides
 *          already speak (heap.hpp).
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

#include "Bench.hpp"
#include "heap.hpp"
#include "esn_shim.hpp"

#include "esengine/aot/AotCommands.hpp"
#include "esengine/aot/AotComponents.generated.hpp"
#include "esengine/aot/AotDispatcher.hpp"
#include "esengine/aot/EngineDigest.generated.h"

#include <cstdio>
#include <charconv>
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
    /** The fallback list, rebuilt per run for a system that cannot narrow.
     *  Kept so a frame that needs it allocates none. */
    std::vector<std::uint32_t> candidates;
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

/**
 * WHO has that component — the half of naming that decides what a frame COSTS.
 * Without it a system matching two hundred of twenty thousand pays for 19,800.
 *
 * A script column says nullopt until the SDK reports its owner table: "cannot
 * say", not "empty", so the caller widens rather than running over nothing.
 */
aot::CandidatesOf candidatesFor(const char* name) {
    if (aot::isEngineComponent(name)) return aot::engineComponentCandidates(*host().registry, name);
    AotState& s = state();
    auto found = s.scriptByName.find(name);
    return found == s.scriptByName.end() ? aot::CandidatesOf{} : aot::fromMovingOwners(found->second);
}

void* resourceAt(const char* name) {
    AotState& s = state();
    auto found = s.resources.find(name);
    return found == s.resources.end() ? nullptr : found->second;
}

// — the calls —

/** es_aot_install(path) -> system count, or -1 with the reason logged. */
esjs::Val installModule(const esjs::Args& a,
                        std::optional<std::uint64_t> expectedContract = std::nullopt) {
    if (a.size() < 1) return esjs::int32(-1);
    esjs::Utf8 pathUtf8(a[0]); const char* path = pathUtf8 ? pathUtf8.c_str() : nullptr;
    if (path == nullptr) return esjs::int32(-1);

    // A content-relative name, resolved the way every other packaged file is:
    // the OS loader searches its own path for a bare name and would find
    // anything but this one.
    const std::string resolved = host().platform ? host().platform->assetPath(path) : std::string{};
    const char* open = resolved.empty() ? path : resolved.c_str();

    AotState& s = state();
    std::string why;
    const bool ok = s.dispatcher.install(open, aot::abiHash(ES_ENGINE_ABI_DIGEST),
                                         componentAt, resourceAt, &why, candidatesFor, expectedContract);
    if (ok) {
        // Bound resolvers hold slot addresses: invalidate their contents without
        // freeing slots. The new SDK owner reports only its own rows/resources.
        for (auto& span : s.scriptSpans) span = {};
        s.resources.clear();
        s.candidates.clear();
    }
    if (!ok) ESHOST_LOGE("[aot] %s: %s", path, why.c_str());
    return esjs::int32(ok ? static_cast<int>(s.dispatcher.count()) : -1);
}

esjs::Val js_install(const esjs::Args& a) {
    return installModule(a);
}

/** Validate the sidecar against the candidate before replacing the live module. */
esjs::Val js_installChecked(const esjs::Args& a) {
    if (a.size() < 2) return esjs::throwTypeError("es_aot_install_checked requires a module and contract");
    esjs::Utf8 textUtf8(a[1]); const char* text = textUtf8 ? textUtf8.c_str() : nullptr;
    if (!text) return esjs::undefined();
    std::uint64_t expected = 0;
    const std::size_t length = std::strlen(text);
    bool valid = length == 0;
    if (length == 16) {
        const auto parsed = std::from_chars(text, text + length, expected, 16);
        valid = parsed.ec == std::errc{} && parsed.ptr == text + length;
    }
    if (!valid) return esjs::throwTypeError("module contract must be empty or 16 hex digits");
    return installModule(a, expected);
}

/** es_aot_index(name) -> the index the scheduler keeps, or -1. */
esjs::Val js_index(const esjs::Args& a) {
    if (a.size() < 1) return esjs::int32(-1);
    esjs::Utf8 nameUtf8(a[0]); const char* name = nameUtf8 ? nameUtf8.c_str() : nullptr;
    if (name == nullptr) return esjs::int32(-1);
    const std::size_t at = state().dispatcher.indexOf(name);
    return esjs::int32(at == aot::Dispatcher::npos ? -1 : static_cast<int>(at));
}

/**
 * es_aot_contract() -> which BUILD the open module is, as 16 hex digits, or ""
 * where it cannot say. The SDK holds the sidecar written beside it and is the
 * only half that can compare the two.
 */
esjs::Val js_contract(const esjs::Args& a) {
    const std::uint64_t value = state().dispatcher.contract();
    if (value == 0) return esjs::string("");
    char hex[17];
    std::snprintf(hex, sizeof(hex), "%016llx", static_cast<unsigned long long>(value));
    return esjs::string(hex);
}

/** es_aot_bound(i) -> whether that system resolved; an unbound one interprets. */
esjs::Val js_bound(const esjs::Args& a) {
    if (a.size() < 1) return esjs::boolean(false);
    std::uint32_t i = 0;
    i = esjs::toUint32(a[0]);
    return esjs::boolean(state().dispatcher.boundAt(i));
}

/**
 * es_aot_script_rows(name, sparseOff, sparseCount, rowsOff, stride, indexMask,
 *                    ownersOff, ownerCount)
 *
 * Where a project component's rows are NOW, and who is in them. Re-reported
 * whenever the pool moves them or its membership changes; the SDK keys both on
 * its layout epoch. A 0 row offset says the pool is gone, a 0 owner offset says
 * the column cannot be enumerated and its systems widen.
 */
esjs::Val js_scriptRows(const esjs::Args& a) {
    if (a.size() < 6) return esjs::boolean(false);
    esjs::Utf8 nameUtf8(a[0]); const char* name = nameUtf8 ? nameUtf8.c_str() : nullptr;
    if (name == nullptr) return esjs::boolean(false);
    std::uint32_t sparseOff = 0, sparseCount = 0, rowsOff = 0, stride = 0, mask = 0;
    std::uint32_t ownersOff = 0, ownerCount = 0;
    sparseOff = esjs::toUint32(a[1]);
    sparseCount = esjs::toUint32(a[2]);
    rowsOff = esjs::toUint32(a[3]);
    stride = esjs::toUint32(a[4]);
    mask = esjs::toUint32(a[5]);
    if (a.size() >= 8) {
        ownersOff = esjs::toUint32(a[6]);
        ownerCount = esjs::toUint32(a[7]);
    }

    // Range-checked through the heap rather than trusted: an offset is a number
    // JS computed, and a wrong one here is a read outside the arena.
    void* sparse = heapPtr(sparseOff, static_cast<std::size_t>(sparseCount) * sizeof(std::uint32_t));
    void* rows = rowsOff == 0 ? nullptr : heapPtr(rowsOff, stride);
    void* owners = ownersOff == 0 ? nullptr
        : heapPtr(ownersOff, static_cast<std::size_t>(ownerCount) * sizeof(std::uint32_t));
    aot::RowSpan* slot = slotFor(name);
    if (sparse == nullptr && sparseCount > 0) return esjs::boolean(false);
    // An owner table that does not check out is DROPPED, not refused: narrowing
    // is an optimisation and must never be the thing that fails a frame.
    if (owners == nullptr) ownerCount = 0;

    *slot = aot::RowSpan{
        static_cast<const std::uint32_t*>(sparse), sparseCount,
        static_cast<unsigned char*>(rows), stride, mask,
        static_cast<const std::uint32_t*>(owners), ownerCount,
    };
    return esjs::boolean(true);
}

/** es_aot_resource(name, offset, bytes) -> where one call reads that resource. */
esjs::Val js_resource(const esjs::Args& a) {
    if (a.size() < 3) return esjs::boolean(false);
    esjs::Utf8 nameUtf8(a[0]); const char* name = nameUtf8 ? nameUtf8.c_str() : nullptr;
    if (name == nullptr) return esjs::boolean(false);
    std::uint32_t offset = 0, bytes = 0;
    offset = esjs::toUint32(a[1]);
    bytes = esjs::toUint32(a[2]);
    void* at = heapPtr(offset, bytes);
    if (at != nullptr) state().resources[name] = at;
    return esjs::boolean(at != nullptr);
}

/**
 * es_aot_run(i, scriptEpoch) -> records this host did not know, or -1.
 *
 * Each query narrows itself to the shortest column it names; the list built here
 * is only the FALLBACK for one that cannot (`aot::narrowest`). When it was the
 * only road a compiled system cost the size of the WORLD — 2.9x for the same
 * 5,000 movers with 45,000 unmatchable entities around them.
 *
 * The stamp says whether last frame's rows still stand, and each side supplies
 * the half it owns: the engine's pool versions are read HERE per call, because
 * a despawn by the previous system moves them; the script epoch can only come
 * from the language that owns those pools. An absent argument reuses nothing.
 */
esjs::Val js_run(const esjs::Args& a) {
    if (a.size() < 1) return esjs::int32(-1);
    std::uint32_t i = 0;
    i = esjs::toUint32(a[0]);
    AotState& s = state();
    // The dispatcher owns installed state. A failed replacement retains its
    // old systems; an independent flag would disable that preserved module.
    if (i >= s.dispatcher.count()) return esjs::int32(-1);

    aot::WorldStamp world;
    double scriptEpoch = 0.0;
    if (a.size() >= 2 && ((scriptEpoch = esjs::toNumber(a[1])), true) && host().registry != nullptr) {
        // Summed, not paired: both halves only ever count up, so no change in
        // one can be cancelled by a change in the other.
        world = aot::WorldStamp{host().registry->layoutEpoch() + scriptEpoch, true};
    }

    s.candidates.clear();
    if (!s.dispatcher.narrowsAt(i)) {
        host().registry->forEachEntity([&s](esengine::Entity e) { s.candidates.push_back(e.id()); });
    }
    const auto cmds = s.dispatcher.run(i, s.candidates, resourceAt, world);
    // Asked AFTER the run, because that is where a late binding is settled.
    if (!s.dispatcher.boundAt(i)) return esjs::int32(-1);
    // What this system covered and what it actually wrote, for the bench and the
    // gates that read them. A no-op unless a bench was asked for.
    benchNoteAotCandidates(s.dispatcher.candidatesWalked(i), s.dispatcher.rowsPacked(i));
    // After the call, never during it: a despawn invalidates the rows it read.
    return esjs::int32(static_cast<int>(aot::applyCommands(*host().registry, cmds)));
}

/** es_aot_reset() — close the module and forget every name. */
esjs::Val js_reset(const esjs::Args&) {
    AotState& s = state();
    s.dispatcher.reset();
    s.scriptByName.clear();
    s.scriptSpans.clear();
    s.resources.clear();
    return esjs::undefined();
}

}  // namespace

void registerAotBindings(HostState& h, esjs::Val global) {
    (void)h;
    const auto fn = [&](const char* name, esjs::NativeFn impl, int arity) {
        esjs::setFunction(global, name, impl, arity);
    };
    fn("es_aot_install", js_install, 1);
    fn("es_aot_install_checked", js_installChecked, 2);
    fn("es_aot_index", js_index, 1);
    fn("es_aot_bound", js_bound, 1);
    fn("es_aot_contract", js_contract, 0);
    fn("es_aot_script_rows", js_scriptRows, 8);
    fn("es_aot_resource", js_resource, 3);
    fn("es_aot_run", js_run, 2);
    fn("es_aot_reset", js_reset, 0);
}

}  // namespace eshost
