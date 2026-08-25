// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AotHost.hpp
 * @brief   The host half of the Estella ABI (docs/REARCH_AOT_ABI.md §2.1).
 *
 * @details A compiled system calls the engine ZERO times, which means everything
 *          it reads has to be in memory before the call. This puts it there:
 *          pack the rows, resolve the resource addresses, zero the count, fill
 *          the SysCtx, call, and hand back what the system wrote.
 *
 *          It does not know about Registry. A component is reached through a
 *          resolver the caller supplies, because the caller is where the
 *          component's TYPE is known — and that is also what lets this be tested
 *          without linking the engine.
 *
 *          The arena is reused across calls and rebuilt in each one, because
 *          §2.2 gives a row array a one-call lifetime. Nothing here allocates
 *          per row after the first frame at a given size.
 */
#pragma once

#include <cstdint>
#include <functional>
#include <span>
#include <vector>

#include "estella_abi.h"

namespace esengine::aot {

/** What a compiled system is: one exported symbol, taking the ctx. */
using SystemFn = void (*)(es_addr_t);

/**
 * Where one component's bytes are for an entity, or `nullptr` if it has none.
 * Supplied per component by the layer that knows its type — a generated binding,
 * or a test.
 */
using ComponentAt = std::function<void*(std::uint32_t)>;

/** One declared `Query`: its components, in the order the query names them. */
struct QuerySpec {
    std::vector<ComponentAt> comps;
};

/**
 * The scratch a call needs. Held by the caller so the vectors keep their
 * capacity between frames; every `run` overwrites it and nothing survives.
 */
class CallArena {
public:
    explicit CallArena(std::uint32_t cmdCap = 256) : cmds_(cmdCap) {}

    /** How many command records the system may write before it must stop. */
    std::uint32_t commandCapacity() const { return static_cast<std::uint32_t>(cmds_.size()); }

private:
    friend std::span<const EsCmd> run(SystemFn, std::span<const std::uint32_t>,
                                      std::span<const QuerySpec>, std::span<void* const>, CallArena&);
    std::vector<es_addr_t> rows_;
    std::vector<EsQueryRows> queries_;
    std::vector<es_addr_t> resources_;
    std::vector<EsCmd> cmds_;
    std::uint32_t count_ = 0;
    EsSysCtx ctx_{};
};

/**
 * Materialise, call, and return the commands the system produced. A row is kept
 * only when every component resolves for it — `View.hpp`'s strategy exposed, so
 * the caller passes the smallest pool it has. Applying the commands is the
 * CALLER's job: a despawn here invalidates the rows just handed over.
 */
inline std::span<const EsCmd> run(SystemFn fn,
                                  std::span<const std::uint32_t> candidates,
                                  std::span<const QuerySpec> queries,
                                  std::span<void* const> resources,
                                  CallArena& arena) {
    arena.rows_.clear();
    arena.queries_.assign(queries.size(), EsQueryRows{});
    arena.resources_.assign(resources.size(), es_addr_t{});

    // Offsets first, addresses after: one vector holding every query's rows
    // moves under the first query's pointer as the second grows, and the ctx
    // has to point at something that will still be there during the call.
    std::vector<std::size_t> starts(queries.size());
    std::vector<std::uint32_t> counts(queries.size(), 0);
    for (std::size_t q = 0; q < queries.size(); ++q) {
        starts[q] = arena.rows_.size();
        const auto& comps = queries[q].comps;
        for (std::uint32_t e : candidates) {
            const std::size_t mark = arena.rows_.size();
            arena.rows_.push_back(static_cast<es_addr_t>(e));
            bool complete = true;
            for (const auto& at : comps) {
                void* p = at(e);
                if (p == nullptr) { complete = false; break; }
                arena.rows_.push_back(reinterpret_cast<es_addr_t>(p));
            }
            if (complete) ++counts[q];
            else arena.rows_.resize(mark);
        }
    }
    for (std::size_t q = 0; q < queries.size(); ++q) {
        arena.queries_[q].rows = reinterpret_cast<es_addr_t>(arena.rows_.data() + starts[q]);
        arena.queries_[q].count = counts[q];
    }
    for (std::size_t r = 0; r < resources.size(); ++r) {
        arena.resources_[r] = reinterpret_cast<es_addr_t>(resources[r]);
    }

    arena.count_ = 0;
    arena.ctx_.queries = reinterpret_cast<es_addr_t>(arena.queries_.data());
    arena.ctx_.resources = reinterpret_cast<es_addr_t>(arena.resources_.data());
    arena.ctx_.cmdBuf = reinterpret_cast<es_addr_t>(arena.cmds_.data());
    arena.ctx_.cmdCap = arena.commandCapacity();
    arena.ctx_.cmdCount = reinterpret_cast<es_addr_t>(&arena.count_);
    arena.ctx_.events = 0;

    fn(reinterpret_cast<es_addr_t>(&arena.ctx_));

    return std::span<const EsCmd>(arena.cmds_.data(), arena.count_);
}

/**
 * The constant a compiled artifact exports, as this host computes it. The
 * contract half comes from the artifact; the width is ours, and mixing it here
 * is what stops a 32-bit artifact loading into a 64-bit host (§2.5).
 */
inline std::uint64_t abiHash(std::uint64_t contract) {
    return contract ^ (0x9e3779b97f4a7c15ULL * sizeof(es_addr_t));
}

}  // namespace esengine::aot
