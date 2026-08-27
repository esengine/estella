// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AotDispatcher.hpp
 * @brief   A loaded module's systems, bound once and callable by index.
 *
 * @details `AotModule` says what a module is and `AotHost` says how one call
 *          goes; between them sits the thing a host actually holds for a frame —
 *          the open module, the arena its calls reuse, and each system resolved
 *          against this world once instead of per call.
 *
 *          Index, not name. The scheduler asks for the same system every frame
 *          and a name lookup there is a strcmp per system per frame on the path
 *          AOT exists to make cheap; a caller resolves the index at install.
 *
 *          The lookups are the CALLER's, because who can name a component
 *          differs by host: engine components come from the generated table,
 *          and a project's own live in the pool the scripting language owns.
 *
 *          Commands come back rather than being applied. A despawn invalidates
 *          the rows just handed over, so who applies them decides when — and
 *          this class does not know how to remove a component by name anyway.
 *
 *          One arena PER SYSTEM, not one shared: a shared one is overwritten by
 *          the next system and nothing can be kept across frames.
 */
#pragma once

#include <cstdint>
#include <span>
#include <string>
#include <vector>

#include "esengine/aot/AotHost.hpp"
#include "esengine/aot/AotModule.hpp"

namespace esengine::aot {

class Dispatcher {
public:
    /**
     * Open `path` and bind every system it declares.
     *
     * True when the module opened and agreed about the engine. A system this
     * host cannot name every component of is left UNBOUND, not refused — the
     * per-system fallback, one layer down; `boundAt` says which ones resolved.
     */
    bool install(const char* path, std::uint64_t expected,
                 const ComponentLookup& components, const ResourceLookup& resources,
                 std::string* why = nullptr, const CandidateLookup& candidates = {}) {
        reset();
        if (!module_.open(path, expected, why)) return false;
        components_ = components;
        resources_ = resources;
        candidates_ = candidates;
        for (const EsSystemDecl& decl : module_.systems()) {
            names_.push_back(decl.name != nullptr ? decl.name : "");
            bound_.push_back(::esengine::aot::bind(decl, components, resources, candidates));
        }
        arenas_ = std::vector<CallArena>(bound_.size());
        return true;
    }

    /** How many systems the module declared — bound or not. */
    std::size_t count() const { return bound_.size(); }

    /** The declared name at that index, or an empty string out of range. */
    const char* nameAt(std::size_t i) const { return i < names_.size() ? names_[i] : ""; }

    /** Whether the system at that index resolved. An unbound one runs nothing. */
    bool boundAt(std::size_t i) const { return i < bound_.size() && bound_[i].fn != nullptr; }

    /**
     * Whether every query of that system names its own candidates, and so
     * whether `run` may be given an EMPTY fallback.
     *
     * Asked per frame, not at install: a script pool exists only once an entity
     * has that component. False when unbound — ignoring it is slow, never wrong.
     */
    bool narrowsAt(std::size_t i) const {
        if (i >= bound_.size() || bound_[i].fn == nullptr) return false;
        return ::esengine::aot::narrows(bound_[i].queries);
    }

    /** The index of a declared name, or `npos`. Called at install, not per frame. */
    std::size_t indexOf(const char* name) const {
        for (std::size_t i = 0; i < names_.size(); ++i) {
            if (names_[i] != nullptr && name != nullptr && std::strcmp(names_[i], name) == 0) return i;
        }
        return npos;
    }

    /**
     * Run one system, and hand back what it wrote.
     *
     * `candidates` is the FALLBACK, walked only by a query that could not name
     * its own column — ask {@link narrowsAt} first. `world` decides whether last
     * frame's rows still stand; an unknown stamp repacks. Resources are resolved
     * per call because the contract promises an address for one call only.
     */
    std::span<const EsCmd> run(std::size_t i, std::span<const std::uint32_t> candidates,
                               const ResourceLookup& resources, WorldStamp world = {}) {
        if (i >= bound_.size()) return {};
        // Asked again where install could not name everything: a pool the
        // scripting language owns does not exist until an entity has that
        // component, so the answer is about the frame, not the module.
        if (bound_[i].fn == nullptr) {
            // Qualified: `std::bind` is visible through <functional> and takes anything.
            bound_[i] = ::esengine::aot::bind(module_.systems()[i], components_, resources_, candidates_);
        }
        if (bound_[i].fn == nullptr) return {};
        return runBound(bound_[i], candidates, resources, arenas_[i], world);
    }

    /** Entities that system's last {@link run} covered. See CallArena. */
    std::uint32_t candidatesWalked(std::size_t i) const {
        return i < arenas_.size() ? arenas_[i].candidatesWalked() : 0u;
    }

    /** Rows that system's last {@link run} wrote — zero when it kept last
     *  frame's, which is the only way to see the saving happen. */
    std::uint32_t rowsPacked(std::size_t i) const {
        return i < arenas_.size() ? arenas_[i].rowsPacked() : 0u;
    }

    /** Close the module and forget the bindings — they point into it. */
    void reset() {
        bound_.clear();
        names_.clear();
        arenas_.clear();
        components_ = {};
        resources_ = {};
        candidates_ = {};
        module_.close();
    }

    static constexpr std::size_t npos = static_cast<std::size_t>(-1);

private:
    Module module_;
    std::vector<const char*> names_;
    std::vector<BoundSystem> bound_;
    /** Kept so a system that could not be named at install can be asked
     *  again — the answer changes as the world comes up. */
    ComponentLookup components_;
    ResourceLookup resources_;
    /** Optional, and absent on a host that cannot enumerate a column: then every
     *  query falls back to the candidates the caller passes. */
    CandidateLookup candidates_;
    /** One per system, so a row table can outlive the call that built it. */
    std::vector<CallArena> arenas_;
};

}  // namespace esengine::aot
