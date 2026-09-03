// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AotModule.hpp
 * @brief   A built module of compiled systems, opened by a host that links.
 *
 * @details The wasm road ships a manifest beside the module because a browser
 *          cannot read a data section out of one. A host that LOADS a library
 *          has no such problem: the declaration table is in the artifact, so
 *          the names, the queries, the resources and the handshake all come
 *          from the thing being run rather than from a file beside it that can
 *          be swapped for another.
 *
 *          Refuses rather than degrades. A module built for other offsets does
 *          not produce a wrong answer, it produces a read of a different field,
 *          so `open` is not "did the platform load it" — it is also "does it
 *          agree about the engine and the address width".
 *
 *          Owns the handle. Moving transfers it; copying is refused, because
 *          two owners closing one library is the bug this exists to not have.
 */
#pragma once

#include <cstdint>
#include <cstring>
#include <span>
#include <string>
#include <utility>

#include "esengine/aot/AotHost.hpp"   // abiHash — the width half of the handshake
#include "esengine/core/DynamicLibrary.hpp"

namespace esengine::aot {

class Module {
public:
    Module() = default;
    ~Module() { close(); }
    Module(const Module&) = delete;
    Module& operator=(const Module&) = delete;
    Module(Module&& other) noexcept { *this = std::move(other); }
    Module& operator=(Module&& other) noexcept {
        if (this != &other) {
            close();
            handle_ = std::exchange(other.handle_, nullptr);
            systems_ = std::exchange(other.systems_, {});
            contract_ = std::exchange(other.contract_, 0);
        }
        return *this;
    }

    /**
     * Open a module and check it says what `expected` says (see `abiHash`).
     *
     * `why` is filled on every false: the ways this fails want different fixes —
     * the file is absent, it carries no declaration table, or it was built for
     * another engine.
     */
    bool open(const char* path, std::uint64_t expected, std::string* why = nullptr) {
        close();
        const auto fail = [why](const char* msg) { if (why != nullptr) *why = msg; return false; };
        handle_ = core::openLibrary(path);
        if (handle_ == nullptr) return fail("the platform could not load it");

        const auto* hash = static_cast<const std::uint64_t*>(core::librarySymbol(handle_, "es_abi_hash"));
        const auto* count = static_cast<const std::uint32_t*>(core::librarySymbol(handle_, "es_system_count"));
        const auto* decls = static_cast<const EsSystemDecl*>(core::librarySymbol(handle_, "es_systems"));
        if (hash == nullptr || count == nullptr || decls == nullptr) {
            close();
            // A wasm module is built WITHOUT the declaration table on purpose;
            // handing one to a linking host lands exactly here.
            return fail("it carries no declaration table — built for a host that shares memory?");
        }
        if (*hash != expected) {
            close();
            return fail("it was built against a different engine or address width");
        }
        systems_ = std::span<const EsSystemDecl>(decls, *count);
        contract_ = readContract_();
        return true;
    }

    /**
     * Which BUILD this module is, for a caller holding the sidecar written
     * beside it. Zero where the module predates it — which the caller must read
     * as "cannot say", never as "paired".
     */
    std::uint64_t contract() const { return contract_; }

    bool isOpen() const { return handle_ != nullptr; }

    /** Every system this module carries, as the artifact declares them. */
    std::span<const EsSystemDecl> systems() const { return systems_; }

    /** One by the name the schedule knows, or nullptr. */
    const EsSystemDecl* find(const char* name) const {
        for (const auto& decl : systems_) {
            if (decl.name != nullptr && std::strcmp(decl.name, name) == 0) return &decl;
        }
        return nullptr;
    }

    void close() {
        // The declarations live IN the library, so they stop existing with it.
        systems_ = {};
        contract_ = 0;
        core::closeLibrary(handle_);
        handle_ = nullptr;
    }

private:
    /**
     * Two functions rather than one constant: a module that shares the engine's
     * memory may carry no data section, and the same translation unit serves
     * both roads. Absent means a module built before pairing existed.
     */
    std::uint64_t readContract_() const {
        using Half = std::uint32_t (*)();
        auto* lo = reinterpret_cast<Half>(core::librarySymbol(handle_, "es_module_contract_lo"));
        auto* hi = reinterpret_cast<Half>(core::librarySymbol(handle_, "es_module_contract_hi"));
        if (lo == nullptr || hi == nullptr) return 0;
        return (static_cast<std::uint64_t>(hi()) << 32) | lo();
    }

    void* handle_ = nullptr;
    std::span<const EsSystemDecl> systems_{};
    std::uint64_t contract_ = 0;
};

}  // namespace esengine::aot
