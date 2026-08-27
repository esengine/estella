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
                 std::string* why = nullptr) {
        reset();
        if (!module_.open(path, expected, why)) return false;
        for (const EsSystemDecl& decl : module_.systems()) {
            names_.push_back(decl.name != nullptr ? decl.name : "");
            bound_.push_back(bind(decl, components, resources));
        }
        return true;
    }

    /** How many systems the module declared — bound or not. */
    std::size_t count() const { return bound_.size(); }

    /** The declared name at that index, or an empty string out of range. */
    const char* nameAt(std::size_t i) const { return i < names_.size() ? names_[i] : ""; }

    /** Whether the system at that index resolved. An unbound one runs nothing. */
    bool boundAt(std::size_t i) const { return i < bound_.size() && bound_[i].fn != nullptr; }

    /** The index of a declared name, or `npos`. Called at install, not per frame. */
    std::size_t indexOf(const char* name) const {
        for (std::size_t i = 0; i < names_.size(); ++i) {
            if (names_[i] != nullptr && name != nullptr && std::strcmp(names_[i], name) == 0) return i;
        }
        return npos;
    }

    /**
     * Run one system over these candidates, and hand back what it wrote.
     *
     * Resources are resolved per call because the contract only promises an
     * address for the length of one; the components were resolved at install,
     * which is the whole point of binding.
     */
    std::span<const EsCmd> run(std::size_t i, std::span<const std::uint32_t> candidates,
                               const ResourceLookup& resources) {
        if (i >= bound_.size()) return {};
        return runBound(bound_[i], candidates, resources, arena_);
    }

    /** Close the module and forget the bindings — they point into it. */
    void reset() {
        bound_.clear();
        names_.clear();
        module_.close();
    }

    static constexpr std::size_t npos = static_cast<std::size_t>(-1);

private:
    Module module_;
    std::vector<const char*> names_;
    std::vector<BoundSystem> bound_;
    CallArena arena_;
};

}  // namespace esengine::aot
