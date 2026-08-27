// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AotHost.hpp
 * @brief   The host half of the Estella ABI.
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
 *          a row array has a one-call lifetime. Nothing here allocates per row
 *          after the first frame at a given size.
 *
 *          A row table is a function of two things: which entities match, and
 *          where their components are. This answers the first — see
 *          {@link narrowest}. The second is open: unlike the web road
 *          (sdk/src/ecs/aot/AotDispatch.ts) this repacks every frame.
 */
#pragma once

#include <cstddef>
#include <cstdint>
#include <functional>
#include <optional>
#include <span>
#include <utility>
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

/**
 * Which entities a component's storage says it holds, as raw ids.
 *
 * Empty means nobody has it and the query matches nothing; `nullopt` means this
 * host cannot enumerate that column and the caller must WIDEN, not narrow.
 * Reading the second as the first drops every row.
 */
using Candidates = std::optional<std::span<const std::uint32_t>>;

/** A column's members, asked per call because a pool grows between them. */
using CandidatesOf = std::function<Candidates()>;

/** One declared `Query`: its components, in the order the query names them. */
struct QuerySpec {
    std::vector<ComponentAt> comps;
    /**
     * Where each of those components says its members are, in the same order.
     * Empty, or an entry that answers nullopt, simply does not narrow — a
     * resolver is required to run a query and this is not.
     */
    std::vector<CandidatesOf> sources;
};

/**
 * The shortest column this query names, or nullopt when none of them could say.
 *
 * An entity missing any one component cannot match, so any column bounds the
 * answer and the shortest bounds it best — {@link ecs::View}'s strategy, reached
 * through names. `run` still filters; this only decides what it is paid over.
 */
inline Candidates narrowest(const QuerySpec& spec) {
    Candidates best;
    for (const CandidatesOf& source : spec.sources) {
        if (!source) continue;
        const Candidates got = source();
        if (!got) continue;
        if (!best || got->size() < best->size()) best = got;
    }
    return best;
}

/**
 * Whether every one of these queries can narrow itself — that is, whether the
 * caller can skip enumerating the world. Asked before it does. No queries at all
 * answers true: nothing would walk the list.
 */
inline bool narrows(std::span<const QuerySpec> queries) {
    for (const QuerySpec& q : queries) {
        if (!narrowest(q)) return false;
    }
    return true;
}

/**
 * The scratch a call needs. Held by the caller so the vectors keep their
 * capacity between frames; every `run` overwrites it and nothing survives.
 */
class CallArena {
public:
    explicit CallArena(std::uint32_t cmdCap = 256) : cmds_(cmdCap) {}

    /** How many command records the system may write before it must stop. */
    std::uint32_t commandCapacity() const { return static_cast<std::uint32_t>(cmds_.size()); }

    /**
     * Entities the last `run` was PAID OVER, summed across its queries.
     *
     * This is what a compiled system costs, not the body — measured at 20
     * ns/entity for three multiply-adds and 21 for four substeps with a square
     * root each. A count, because a clock reads a tenfold scan as a busy machine.
     */
    std::uint32_t candidatesWalked() const { return walked_; }

private:
    friend std::span<const EsCmd> run(SystemFn, std::span<const std::uint32_t>,
                                      std::span<const QuerySpec>, std::span<void* const>, CallArena&);
    std::vector<es_addr_t> rows_;
    std::vector<EsQueryRows> queries_;
    std::vector<es_addr_t> resources_;
    std::vector<EsCmd> cmds_;
    std::uint32_t count_ = 0;
    std::uint32_t walked_ = 0;
    EsSysCtx ctx_{};
};

/**
 * Materialise, call, and return the commands the system produced. A row is kept
 * only when every component resolves — an absent one is the filter.
 *
 * `fallback` is walked only by a query that cannot narrow itself; ask
 * {@link narrows} first, since building it is O(world). Applying the commands is
 * the CALLER's job: a despawn here invalidates the rows just handed over.
 */
inline std::span<const EsCmd> run(SystemFn fn,
                                  std::span<const std::uint32_t> fallback,
                                  std::span<const QuerySpec> queries,
                                  std::span<void* const> resources,
                                  CallArena& arena) {
    arena.rows_.clear();
    arena.walked_ = 0;
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
        // Its own column where it has one, everybody where it does not. A
        // freed slot in a script column reads as an entity nothing resolves
        // for, so the completeness check below drops it like any other miss.
        const Candidates narrowed = narrowest(queries[q]);
        const std::span<const std::uint32_t> over = narrowed ? *narrowed : fallback;
        arena.walked_ += static_cast<std::uint32_t>(over.size());
        for (std::uint32_t e : over) {
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
 * A component handed over as MEMORY rather than as a callback: rows at a stride,
 * and a sparse table of `slot + 1` by entity index. What `ScriptPool::span`
 * gives — a script component's entity-to-slot map lives in the scripting
 * language, and asking it per entity per frame is what AOT exists to delete.
 */
struct RowSpan {
    const std::uint32_t* sparse = nullptr;
    std::uint32_t sparseCount = 0;
    unsigned char* rows = nullptr;
    std::uint32_t stride = 0;
    /** Entity::Layout::INDEX_MASK, passed rather than included so this header
     *  stays free of the engine and the harness needs no link. */
    std::uint32_t indexMask = 0;
    /**
     * Slot -> the raw entity holding it, so this column can be asked WHO is in
     * it. The sparse table above answers the other direction only.
     *
     * Null where the owner reported none — the one reason a script component
     * fails to narrow.
     */
    const std::uint32_t* owners = nullptr;
    /** Slots ever claimed. A pool reuses slots rather than compacting, so this
     *  is a high-water mark and the array has holes — see {@link NO_OWNER}. */
    std::uint32_t ownerCount = 0;
};

/** A slot nobody holds. `Entity::INVALID_RAW`: the one raw value the engine
 *  never hands out, so a hole resolves to no row and the filter drops it. */
inline constexpr std::uint32_t NO_OWNER = 0xFFFFFFFFu;

/** One row out of a span. Absent is zero in the table, as it is in a sparse set. */
inline void* rowAt(const RowSpan& span, std::uint32_t entity) {
    const std::uint32_t at = entity & span.indexMask;
    if (at >= span.sparseCount) return nullptr;
    const std::uint32_t slot = span.sparse[at];
    if (slot == 0u) return nullptr;
    return span.rows + static_cast<std::size_t>(slot - 1u) * span.stride;
}

/** `span` as a resolver, for rows that will not move while it is held. */
inline ComponentAt fromRows(const RowSpan& span) {
    return [span](std::uint32_t entity) -> void* { return rowAt(span, entity); };
}

/**
 * The same, for rows that MOVE.
 *
 * A pool reallocates as it grows, and a resolver holding the span by value then
 * reads memory nobody owns; this reads it through a slot the owner overwrites.
 * The slot must outlive the resolver; a null one is simply absent.
 */
inline ComponentAt fromMovingRows(const RowSpan* slot) {
    return [slot](std::uint32_t entity) -> void* {
        return slot == nullptr ? nullptr : rowAt(*slot, entity);
    };
}

/**
 * Who is in that column, read through the same slot for the same reason.
 * nullopt rather than empty when no owner array was reported: "did not say" is
 * not "is empty", and confusing them runs every system over nothing.
 */
inline CandidatesOf fromMovingOwners(const RowSpan* slot) {
    return [slot]() -> Candidates {
        if (slot == nullptr || slot->owners == nullptr) return std::nullopt;
        return std::span<const std::uint32_t>(slot->owners, slot->ownerCount);
    };
}

/**
 * How a host answers the two questions a declaration asks: where one component
 * is for an entity, and where one resource is. Both by NAME, because names are
 * what the artifact carries — it cannot know this host's type ids.
 */
using ComponentLookup = std::function<ComponentAt(const char*)>;
using ResourceLookup = std::function<void*(const char*)>;

/**
 * The third question, and the only optional one: who holds that component.
 * Separate from `ComponentLookup` because a host with no answer must still bind
 * and run — narrowing is an optimisation and cannot be allowed to change which
 * rows a system sees.
 */
using CandidateLookup = std::function<CandidatesOf(const char*)>;

/**
 * A declared system with its resolvers found once. Resources are looked up per
 * call rather than kept, because a host is free to move one between frames and
 * the contract only promises the address for the length of a call.
 */
struct BoundSystem {
    SystemFn fn = nullptr;
    std::vector<QuerySpec> queries;
    std::vector<const char*> resourceNames;
};

/**
 * Resolve `decl` against this host. A component or resource the host cannot
 * name leaves `fn` null: the system is simply not run, which is the interpreter
 * fallback arriving one layer down rather than a crash at the first row.
 */
inline BoundSystem bind(const EsSystemDecl& decl,
                        const ComponentLookup& components,
                        const ResourceLookup& resources,
                        const CandidateLookup& candidates = {}) {
    BoundSystem out;
    out.queries.resize(decl.queryCount);
    for (std::uint32_t q = 0; q < decl.queryCount; ++q) {
        const EsQueryDecl& qd = decl.queries[q];
        for (std::uint32_t c = 0; c < qd.count; ++c) {
            ComponentAt at = components(qd.comps[c]);
            if (!at) return {};
            out.queries[q].comps.push_back(std::move(at));
            // A column that cannot say leaves a falsy entry rather than none, so
            // `sources` stays index-for-index with `comps` and a reader of one
            // is a reader of the other.
            out.queries[q].sources.push_back(candidates ? candidates(qd.comps[c]) : CandidatesOf{});
        }
    }
    for (std::uint32_t r = 0; r < decl.resourceCount; ++r) {
        if (resources(decl.resources[r]) == nullptr) return {};
        out.resourceNames.push_back(decl.resources[r]);
    }
    out.fn = decl.fn;
    return out;
}

/** Run a bound system, resolving its resources for this call. `fallback` is for
 *  the queries that cannot narrow themselves; see {@link run}. */
inline std::span<const EsCmd> runBound(const BoundSystem& bound,
                                       std::span<const std::uint32_t> fallback,
                                       const ResourceLookup& resources,
                                       CallArena& arena) {
    if (bound.fn == nullptr) return {};
    std::vector<void*> addresses;
    addresses.reserve(bound.resourceNames.size());
    for (const char* name : bound.resourceNames) addresses.push_back(resources(name));
    return run(bound.fn, fallback, bound.queries, addresses, arena);
}

/**
 * The constant a compiled artifact exports, as this host computes it. The
 * contract half comes from the artifact; the width is ours, and mixing it here
 * is what stops a 32-bit artifact loading into a 64-bit host.
 */
inline std::uint64_t abiHash(std::uint64_t contract) {
    return contract ^ (0x9e3779b97f4a7c15ULL * sizeof(es_addr_t));
}

}  // namespace esengine::aot
