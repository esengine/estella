// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Registry.hpp
 * @brief   Central ECS registry for entity and component management
 * @details The Registry is the core container for the ECS system. It manages
 *          entity creation/destruction, component storage, and provides
 *          query functionality through Views.
 *
 * @author  ESEngine Team
 * @date    2025
 *
 * @copyright Copyright (c) 2025 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

// Project includes
#include "../core/Log.hpp"
#include "../core/Types.hpp"
#include "ComponentMask.hpp"
#include "Entity.hpp"
#include "SparseSet.hpp"
#include "View.hpp"
#include "ActiveView.hpp"
#include "EntityChangeJournal.hpp"
#include "components/Hierarchy.hpp"
#include "../events/Sink.hpp"

// Standard library
#include <algorithm>
#include <any>
#include <functional>
#include <queue>
#include <span>
#include <string>

namespace esengine::ecs {

// =============================================================================
// Registry Class
// =============================================================================

/**
 * @brief Central container for all entities and components
 *
 * @details The Registry provides:
 * - Entity lifecycle management (create, destroy, recycle)
 * - Component storage with O(1) access via SparseSet pools
 * - View-based queries for iterating entities with specific components
 *
 * @code
 * Registry registry;
 *
 * // Create entities and add components
 * Entity player = registry.create();
 * registry.emplace<Position>(player, 0.0f, 0.0f);
 * registry.emplace<Velocity>(player, 1.0f, 0.0f);
 *
 * // Query and iterate
 * registry.each<Position, Velocity>([&](Entity e, Position& pos, Velocity& vel) {
 *     pos.x += vel.x * deltaTime;
 * });
 * @endcode
 */
class Registry {
public:
    Registry() = default;
    ~Registry() = default;

    // Non-copyable, movable
    Registry(const Registry&) = delete;
    Registry& operator=(const Registry&) = delete;
    Registry(Registry&&) noexcept = default;
    Registry& operator=(Registry&&) noexcept = default;

    /**
     * @brief Which registry this is — unique for the process, never reused.
     *
     * @details Entity ids are only meaningful WITHIN a registry: a fresh one
     *          hands out 1, 2, 3 again, so anything caching per entity across
     *          registries (a scene reload, an editor play/stop) would silently
     *          serve the previous world's data for the new world's entities.
     *          Comparing addresses cannot answer this — a destroyed registry's
     *          storage is routinely reused by the next one. Systems that keep
     *          per-entity state hold this alongside it and drop the lot when it
     *          changes; see UISystem's retained Yoga nodes.
     */
    u64 instanceId() const { return instance_id_; }

    // Local authoring state is distinct from effective activity. Disabling a
    // parent never overwrites a child's own switch. All engine consumers share
    // this derived answer, including JS queries through the registry binding.
    bool setEntityEnabled(Entity e, bool enabled) {
        if (!valid(e)) return false;
        const u8 off = enabled ? 0 : 1;
        if (disabled_[e.index()] == off) return true;
        disabled_[e.index()] = off;
        if (off) ++disabled_count_; else --disabled_count_;
        ++activity_epoch_;
        recordEntityChange(e, ENTITY_CHANGE_SUBTREE);
        return true;
    }
    bool isEntityEnabled(Entity e) const {
        return valid(e) && disabled_[e.index()] == 0;
    }

    bool isEntityActive(Entity e) const {
        if (!valid(e)) return false;
        if (disabled_count_ == 0) return true;
        ensureActivity();
        return inactive_[e.index()] == 0;
    }
    bool hasInactiveEntities() const { return disabled_count_ != 0; }
    u32 activityEpoch() const { return activity_epoch_; }
    void invalidateActivityHierarchy(Entity root = INVALID_ENTITY) {
        if (disabled_count_) ++activity_epoch_;
        recordEntityChange(root, root == INVALID_ENTITY ? ENTITY_CHANGE_RESET : ENTITY_CHANGE_SUBTREE);
    }

    u32 watchEntityChanges() { return entity_changes_.watch(); }
    void unwatchEntityChanges(u32 reader) { entity_changes_.unwatch(reader); }
    double entityChangeSequence() const { return entity_changes_.sequence(); }
    double entityChangeResetEpoch() const {
        return entity_reset_epoch_ == RESET_EPOCH_LIMIT ? -1 : static_cast<double>(entity_reset_epoch_);
    }
    double componentMutationRevision(u32 component, bool topology) const {
        return entity_changes_.componentRevision(component, topology);
    }
    i32 readEntityChanges(double after, std::span<EntityChangeRow> output) const {
        return entity_changes_.read(after, output);
    }
    // Raw component producers publish their logical mutation here; merely
    // borrowing a mutable reference does not announce a write.
    void recordEntityChange(Entity entity, u32 flags = 0, u32 component = ENTITY_CHANGE_NO_COMPONENT) {
        entity_changes_.record(entity.id(), flags, component);
    }

    // =========================================================================
    // Change Detection
    // =========================================================================
    //
    // Every component carries the tick of its last write. A write stamps the tick that is current; a reader asks
    // beginChangeRead(), which hands back the tick it read at and moves the clock on, and next time takes as changed whatever is
    // stamped after that. A write made after a reader looked is stamped later than what it read at, so it is seen the next time,
    // whichever frame it happened in.
    //
    // What writes says so: patch<T>() (a mutable reference that stamps), markChanged<T>() (after writing through a reference
    // already held), add, replace and remove. get<T>() announces nothing; setChangeAudit() reports what changed without saying.

    /** @brief The tick a write made now is stamped with. */
    u32 changeTick() const { return change_tick_; }

    /**
     * @brief For a reader about to look: the tick it is looking at, after which the clock moves on.
     * @details Keep the answer; next time, changedSince(it) is what was written since this look. Stamps older than half the
     *          counter's range are lifted on the way, so an untouched component never reads as newer once the tick wraps.
     */
    u32 beginChangeRead() {
        const u32 seen = change_tick_;
        ++change_tick_;
        if (change_tick_ == 0) change_tick_ = 1;
        if ((change_tick_ & ((1u << 20) - 1)) == 0) {
            const u32 floor = change_tick_ - (1u << 30);
            for (auto& pool : pools_) if (pool) pool->clampStamps(floor);
        }
        return seen;
    }

    /** @brief Mutable access that says it writes: @p entity's T, stamped. Fatal where it has none, as get<T>() is. */
    template<typename T>
    T& patch(Entity entity) {
        auto* pool = getPool<T>();
        ES_VERIFY_FATAL(pool != nullptr, noPoolMessage(entity));
        T& component = pool->get(entity);
        pool->markChanged(entity, change_tick_);
        return component;
    }

    /** @brief Says @p entity's T was written, through a reference held from before. */
    template<typename T>
    void markChanged(Entity entity) {
        if (auto* pool = getPool<T>()) pool->markChanged(entity, change_tick_);
    }

    /** @brief Whether @p entity's T was written, added or replaced after @p tick (an answer of beginChangeRead). */
    template<typename T>
    bool changedSince(Entity entity, u32 tick) const {
        const auto* pool = getPool<T>();
        return pool && tickAfter(pool->changedTick(entity), tick);
    }

    /** @brief Whether any T was written, added or removed after @p tick: the question a frame that may skip its walk asks first. */
    template<typename T>
    bool anyChangedSince(u32 tick) const {
        const auto* pool = getPool<T>();
        return pool && tickAfter(pool->lastChangedTick(), tick);
    }

    /**
     * @brief Turns the change audit on or off. On, auditChanges() compares every auditable component with the copy it kept and
     *        reports each one whose bytes changed with no stamp to say so — a write some consumer will never see.
     * @details A check for tests and gates: it copies every component once per audit.
     */
    void setChangeAudit(bool enabled) {
        change_audit_ = enabled;
        audit_copies_.clear();
        audit_reported_.clear();
        if (enabled) auditChanges();
    }
    bool changeAuditEnabled() const { return change_audit_; }

    /**
     * @brief Compares, reports, and keeps a new copy. @return The unstamped writes found since the last call (0 while off).
     * @details Each component type is named in the log the first time one of its writes goes unstamped, with the entity; every
     *          one is counted. A type that can be neither copied as bytes nor compared is named once, at the first audit, as unchecked.
     */
    u32 auditChanges() {
        if (!change_audit_) return 0;
        u32 found = 0;
        if (audit_copies_.size() < pools_.size()) audit_copies_.resize(pools_.size());
        if (audit_reported_.size() < pools_.size()) audit_reported_.resize(pools_.size(), 0);
        for (usize id = 0; id < pools_.size(); ++id) {
            const auto& pool = pools_[id];
            if (!pool) continue;
            if (!pool->auditable()) {
                if (!audit_reported_[id]) {
                    audit_reported_[id] = 2;
                    ES_LOG_INFO("change audit: {} can be neither copied as bytes nor compared with ==, and is not checked", std::string(pool->typeName()));
                }
                continue;
            }
            auto& copy = audit_copies_[id];
            if (!copy.entities.empty() || copy.tick != 0) {
                struct Sink { Registry* self; usize id; Entity first = INVALID_ENTITY; };
                Sink sink{this, id};
                const u32 here = pool->auditCompare(copy, [](void* user, Entity entity) {
                    auto* s = static_cast<Sink*>(user);
                    if (s->first == INVALID_ENTITY) s->first = entity;
                }, &sink);
                if (here && audit_reported_[id] != 1) {
                    audit_reported_[id] = 1;
                    ES_LOG_WARN("change audit: {} was written without a stamp (entity {}, {} this frame) - a consumer of changes "
                                "will not see it", std::string(pool->typeName()), sink.first.index(), here);
                }
                found += here;
                audit_unstamped_total_ += here;
            }
            pool->auditKeep(copy, change_tick_);
        }
        // The copies were taken at this tick: a write from here on has to be stamped later than it to count as said.
        beginChangeRead();
        return found;
    }

    /** @brief Unstamped writes the audit has found since it was turned on. */
    u32 changeAuditTotal() const { return audit_unstamped_total_; }

    template<class... C> auto activeView() {
        return ActiveView<View<C...>, Registry>(view<C...>(), *this);
    }

    // =========================================================================
    // Entity Management
    // =========================================================================

    /**
     * @brief Creates a new entity
     * @return A valid entity ID
     *
     * @details Recycles previously destroyed entities when available.
     *          New entities are allocated sequentially when no recycled
     *          entities exist.
     */
    Entity create() {
        u32 index;
        while (!recycled_.empty()) {
            index = recycled_.front();
            recycled_.pop();
            if (index < entityValid_.size() && entityValid_[index]) {
                continue;
            }
            return activateIndex(index);
        }
        index = next_index_++;
        return activateIndex(index);
    }

    /**
     * @brief Creates multiple entities at once
     * @param count Number of entities to create
     * @return Vector containing all created entity IDs
     */
    std::vector<Entity> create(usize count) {
        std::vector<Entity> entities;
        entities.reserve(count);
        for (usize i = 0; i < count; ++i) {
            entities.push_back(create());
        }
        return entities;
    }

    /**
     * @brief Restores an entity at a specific index
     * @param index The entity index to restore
     * @return The newly created Entity, or INVALID_ENTITY if index is already alive
     */
    Entity restore(u32 index) {
        // Release-safe: reject a deserialized index beyond the addressable range
        // up front, before mutating next_index_ below (activateIndex would also
        // refuse, but only after next_index_ was already advanced, leaving the
        // registry unable to allocate fresh indices).
        ES_VERIFY(index <= Entity::INDEX_MASK, return INVALID_ENTITY);
        if (index < entityValid_.size() && entityValid_[index]) {
            return INVALID_ENTITY;
        }

        if (index >= next_index_) {
            next_index_ = index + 1;
        }

        return activateIndex(index);
    }

    /** Internal subtree ownership. Components remain readable for callbacks,
     * but a pending entity cannot receive links or be reserved a second time. */
    bool reserveDestruction(Entity entity) {
        if (!valid(entity) || destruction_pending_[entity.index()]) return false;
        destruction_pending_[entity.index()] = 1;
        return true;
    }
    void releaseDestruction(Entity entity) {
        const u32 index = entity.index();
        // An old owner's finalizer can run after this slot was recycled and
        // reserved by a new owner. Only its original generation may clear it.
        if (index < destruction_pending_.size() && generations_[index] == entity.generation()) {
            destruction_pending_[index] = 0;
        }
    }
    bool destructionPending(Entity entity) const {
        const u32 index = entity.index();
        return index < destruction_pending_.size() && destruction_pending_[index]
            && generations_[index] == entity.generation();
    }

    /**
     * @brief Destroys an entity and removes all its components
     * @param entity The entity to destroy
     *
     * @details The entity ID is recycled for future use.
     *          All components attached to the entity are removed.
     */
    void destroy(Entity entity) {
        if (!valid(entity)) return;

        if (entity_changes_.readerCount()) {
            recordEntityChange(entity);
            if (const auto* children = tryGet<Children>(entity)) {
                for (const auto child : children->entities) recordEntityChange(child, ENTITY_CHANGE_SUBTREE);
            }
        }

        const u32 idx = entity.index();

        // Mark invalid up-front so a re-entrant destroy(entity) from an onDestroy
        // callback short-circuits at valid() above. Otherwise the teardown below
        // runs twice: entity_count_ underflows and idx is pushed onto recycled_
        // twice, later aliasing two distinct entities to the same index.
        entityValid_[idx] = false;
        const bool hadDisabled = disabled_count_ != 0;
        if (disabled_[idx]) { disabled_[idx] = 0; --disabled_count_; }
        if (hadDisabled) ++activity_epoch_;

        // Signal handles re-entrant connect/disconnect during publish; its RAII
        // Connection (via Sink::connect) keeps subscriber lifetimes safe in both
        // teardown orders — Registry-first or system-first (RC12, fixes A12).
        on_destroy_signal_.publish(entity);

        component_masks_[idx].forEachSet([&](u32 bit) {
            if (bit < pools_.size() && pools_[bit]) {
                pools_[bit]->remove(entity);
                pools_[bit]->noteStructural(change_tick_);
            }
        });

        component_masks_[idx].reset();
        --entity_count_;
        // A slot on its last generation is RETIRED, not recycled: reusing it wraps
        // the counter to 1 and mints an id this slot already issued, which a caller
        // may hold and valid() would confirm. Costs index space, only where it aliases.
        if (generations_[idx] < Entity::GEN_MASK) {
            recycled_.push(idx);
        } else {
            ++retired_slots_;
            ES_LOG_TRACE("Retired entity slot {} (generation exhausted)", idx);
        }

        ES_LOG_TRACE("Destroyed entity raw={} (index={})", entity.raw, idx);
    }

    using DestroyCallback = std::function<void(Entity)>;

    /**
     * @brief Subscribe to entity destruction.
     * @return An RAII Connection. The callback stays registered for as long as
     *         the returned Connection is alive; on its destruction the callback
     *         is removed. The Connection is also safe to outlive the Registry —
     *         it no-ops against a destroyed signal — so subscribers and the
     *         Registry can tear down in either order without a dangling callback.
     */
    [[nodiscard]] Connection onDestroy(DestroyCallback callback) {
        return sink(on_destroy_signal_).connect(std::move(callback));
    }

    /**
     * @brief Checks if an entity is currently valid
     * @param entity The entity to check
     * @return True if the entity exists and generation matches
     */
    bool valid(Entity entity) const {
        const u32 idx = entity.index();
        return idx < entityValid_.size() &&
               entityValid_[idx] &&
               generations_[idx] == entity.generation();
    }

    usize entityCount() const {
        return entity_count_;
    }

    /**
     * @brief Slots permanently out of circulation, their generation spent.
     *
     * Zero for anything but sustained create/destroy on the same indices. Rising
     * steadily is the signal that churn is eating index space — the price paid so
     * a destroyed entity's handle can never come back as a live one.
     */
    u32 retiredSlots() const { return retired_slots_; }

    /**
     * @brief Executes a function for each valid entity
     * @tparam Func The callback type
     * @param func Callback receiving Entity
     */
    template<typename Func>
    void forEachEntity(Func&& func) const {
        for (u32 i = 0; i < entityValid_.size(); ++i) {
            if (entityValid_[i]) {
                func(Entity::make(i, generations_[i]));
            }
        }
    }

    // =========================================================================
    // Component Management
    // =========================================================================

    /**
     * @brief Adds a component to an entity with in-place construction
     * @tparam T The component type
     * @tparam Args Constructor argument types
     * @param entity The target entity
     * @param args Arguments forwarded to T's constructor
     * @return Reference to the newly created component
     *
     * @note An invalid entity is fatal in every build; the component already
     *       being there degrades to the existing one (see SparseSet::emplace).
     */
    template<typename T, typename... Args>
    T& emplace(Entity entity, Args&&... args) {
        // An invalid entity would index component_masks_ out of bounds below (the
        // sentinel's index() is the mask), and there is no component to hand back.
        ES_VERIFY_FATAL(valid(entity), invalidEntityMessage("emplace", entity));
        auto& pool = assurePool<T>();
        auto& result = pool.emplace(entity, std::forward<Args>(args)...);
        component_masks_[entity.index()].set(componentTypeId<T>());
        pool.markChanged(entity, change_tick_);
        recordComponentChange<T>(entity);
        return result;
    }

    /**
     * @brief Adds or replaces a component on an entity
     * @tparam T The component type
     * @tparam Args Constructor argument types
     * @param entity The target entity
     * @param args Arguments forwarded to T's constructor
     * @return Reference to the component
     *
     * @details If the entity already has the component, it is replaced.
     */
    template<typename T, typename... Args>
    T& emplaceOrReplace(Entity entity, Args&&... args) {
        ES_VERIFY_FATAL(valid(entity), invalidEntityMessage("emplaceOrReplace", entity));
        auto& pool = assurePool<T>();

        if (pool.contains(entity)) {
            auto& comp = pool.get(entity);
            comp = T(std::forward<Args>(args)...);
            pool.markChanged(entity, change_tick_);
            recordComponentChange<T>(entity, ENTITY_CHANGE_REPLACED);
            return comp;
        }
        auto& result = pool.emplace(entity, std::forward<Args>(args)...);
        component_masks_[entity.index()].set(componentTypeId<T>());
        pool.markChanged(entity, change_tick_);
        recordComponentChange<T>(entity);
        return result;
    }

    /**
     * @brief Removes a component from an entity
     * @tparam T The component type to remove
     * @param entity The target entity
     *
     * @details No-op if the entity doesn't have the component.
     */
    template<typename T>
    void remove(Entity entity) {
        auto* pool = getPool<T>();
        if (pool && pool->contains(entity)) {
            pool->remove(entity);
            pool->noteStructural(change_tick_);
            recordComponentChange<T>(entity);
            const u32 idx = entity.index();
            if (idx < component_masks_.size()) {
                component_masks_[idx].clear(componentTypeId<T>());
            }
        }
    }

    /**
     * @brief Gets a component from an entity (must exist)
     * @tparam T The component type
     * @param entity The target entity
     * @return Reference to the component
     *
     * @note A missing component is fatal in every build — the contract is that the
     *       caller knows it is there. Use tryGet() where absence is expected and
     *       getOrEmplace() where the component should be created.
     */
    template<typename T>
    T& get(Entity entity) {
        auto* pool = getPool<T>();
        ES_VERIFY_FATAL(pool != nullptr, noPoolMessage(entity));
        return pool->get(entity);  // itself fatal on a non-member
    }

    /** @copydoc get() */
    template<typename T>
    const T& get(Entity entity) const {
        auto* pool = getPool<T>();
        ES_VERIFY_FATAL(pool != nullptr, noPoolMessage(entity));
        return pool->get(entity);
    }

    /**
     * @brief Tries to get a component from an entity
     * @tparam T The component type
     * @param entity The target entity
     * @return Pointer to the component, or nullptr if not found
     */
    template<typename T>
    T* tryGet(Entity entity) {
        auto* pool = getPool<T>();
        return pool ? pool->tryGet(entity) : nullptr;
    }

    /** @copydoc tryGet() */
    template<typename T>
    const T* tryGet(Entity entity) const {
        auto* pool = getPool<T>();
        return pool ? pool->tryGet(entity) : nullptr;
    }

    /**
     * @brief Gets an existing component or creates a new one
     * @tparam T The component type
     * @tparam Args Constructor argument types (for new component)
     * @param entity The target entity
     * @param args Arguments forwarded to T's constructor if creating
     * @return Reference to the component
     */
    template<typename T, typename... Args>
    T& getOrEmplace(Entity entity, Args&&... args) {
        auto& pool = assurePool<T>();
        if (pool.contains(entity)) {
            return pool.get(entity);
        }
        ES_VERIFY_FATAL(valid(entity), invalidEntityMessage("getOrEmplace", entity));
        auto& result = pool.emplace(entity, std::forward<Args>(args)...);
        component_masks_[entity.index()].set(componentTypeId<T>());
        pool.markChanged(entity, change_tick_);
        recordComponentChange<T>(entity);
        return result;
    }

    /**
     * @brief Checks if an entity has a specific component
     * @tparam T The component type to check
     * @param entity The entity to check
     * @return True if the entity has the component
     */
    template<typename T>
    bool has(Entity entity) const {
        auto* pool = getPool<T>();
        return pool && pool->contains(entity);
    }

    /**
     * @brief Checks if an entity has all specified components
     * @tparam Ts The component types to check
     * @param entity The entity to check
     * @return True if the entity has all components
     */
    template<typename... Ts>
    bool hasAll(Entity entity) const {
        return (has<Ts>(entity) && ...);
    }

    /**
     * @brief Checks if an entity has any of the specified components
     * @tparam Ts The component types to check
     * @param entity The entity to check
     * @return True if the entity has at least one component
     */
    template<typename... Ts>
    bool hasAny(Entity entity) const {
        return (has<Ts>(entity) || ...);
    }

    // =========================================================================
    // View Query System
    // =========================================================================

    /**
     * @brief Creates a view for iterating entities with specific components
     * @tparam Components The component types to query
     * @return A View for iterating matching entities
     *
     * @code
     * // Single component view
     * for (auto entity : registry.view<Position>()) {
     *     auto& pos = registry.get<Position>(entity);
     * }
     *
     * // Multi-component view: range-for yields the entities that have them all
     * auto view = registry.view<Position, Velocity>();
     * for (Entity e : view) {
     *     view.get<Position>(e).x += view.get<Velocity>(e).x * dt;
     * }
     * @endcode
     */
    template<typename... Components>
    View<Components...> view() {
        if constexpr (sizeof...(Components) == 1) {
            return View<Components...>(&assurePool<Components...>());
        } else {
            return View<Components...>(
                std::make_tuple(&assurePool<Components>()...));
        }
    }

    // =========================================================================
    // Utility
    // =========================================================================

    /**
     * @brief Clears all entities and components
     * @details Resets the registry to its initial empty state.
     */
    void clear() {
        if (entity_reset_epoch_ < RESET_EPOCH_LIMIT) ++entity_reset_epoch_;
        recordEntityChange(INVALID_ENTITY, ENTITY_CHANGE_RESET);
        for (auto& pool : pools_) {
            if (pool) {
                pool->clear();
            }
        }
        entityValid_.clear();
        disabled_.clear();
        inactive_.clear();
        activity_state_.clear();
        disabled_count_ = 0;
        ++activity_epoch_;
        generations_.clear();
        component_masks_.clear();
        while (!recycled_.empty()) recycled_.pop();
        next_index_ = 0;
        entity_count_ = 0;
        retired_slots_ = 0;
    }

    /**
     * @brief Reorders every component pool to follow the given entity order
     * @param order    Entities in the desired iteration order (first iterates first)
     * @param count    How many entries @p order holds
     *
     * @details Component storage order IS iteration order, and iteration order is
     *          the renderer's painter order within a sorting layer — so a scene's
     *          authored entity order only reaches the draw list because a load
     *          happens to spawn in that order. This applies an order to a registry
     *          that is already populated: the same picture, without respawning
     *          anything (entity ids, component values, and every subsystem keyed on
     *          them survive untouched).
     *
     *          Entities absent from @p order keep their relative order after the
     *          listed ones. Pools already in the requested order are left alone, so
     *          a redundant call costs a scan and bumps no pool version.
     */
    void applyEntityOrder(const Entity* order, usize count) {
        if (!order || count == 0) return;
        applyEntityRank(buildEntityRank(order, count));
    }

    /**
     * @brief Rank table (by Entity::index()) for an ordered entity list
     * @details Split out of {@link applyEntityOrder} so a caller that ranks other
     *          entity lists too — child lists, in applySceneEntityOrder — builds it
     *          once. Unlisted entities read {@link SparseSetBase::UNRANKED}.
     */
    std::vector<u32> buildEntityRank(const Entity* order, usize count) const {
        // entityValid_ spans every index ever activated (activateIndex grows it),
        // so it is the safe bound for a rank table keyed by Entity::index().
        std::vector<u32> rank(entityValid_.size(), SparseSetBase::UNRANKED);
        if (!order) return rank;
        u32 nextRank = 0;
        for (usize i = 0; i < count; ++i) {
            const u32 idx = order[i].index();
            if (idx >= rank.size()) continue;                     // never allocated here
            if (rank[idx] != SparseSetBase::UNRANKED) continue;   // duplicate: first wins
            rank[idx] = nextRank++;
        }
        return rank;
    }

    /**
     * @brief Sum of every pool's version — one number for "did anything move"
     * @return Equal across two reads ⇒ no stored component changed address
     *
     * @details A holder of RAW ADDRESSES (the AOT row table) needs one cheap
     *          question, and one that covers pools it never asked about: a C++
     *          insert moves that pool with no JS call in it. u64 so it cannot
     *          wrap onto a value already seen; double because JS takes that.
     */
    double layoutEpoch() const {
        u64 sum = 0;
        for (const auto& pool : pools_) {
            if (pool) sum += pool->version();
        }
        return static_cast<double>(sum);
    }

    /** @brief Reorders every component pool by a rank table from buildEntityRank. */
    void applyEntityRank(const std::vector<u32>& rank) {
        for (auto& pool : pools_) {
            if (pool) pool->reorderBy(rank);
        }
    }

    /**
     * @brief Executes a function for each entity with specified components
     * @tparam Components The required component types
     * @tparam Func The callback type
     * @param func Callback receiving (Entity, Component&...)
     *
     * @code
     * registry.each<Position, Velocity>([](Entity e, Position& p, Velocity& v) {
     *     p.x += v.x;
     * });
     * @endcode
     */
    template<typename... Components, typename Func>
    void each(Func&& func) {
        view<Components...>().each(std::forward<Func>(func));
    }

    /**
     * @brief each() without the per-call snapshot copy, for read-only passes.
     * @warning The callback must not emplace/remove the iterated component(s).
     */
    template<typename... Components, typename Func>
    void eachLive(Func&& func) {
        view<Components...>().eachLive(std::forward<Func>(func));
    }

    /**
     * @brief Sorts components by a comparison function
     * @tparam T The component type to sort
     * @tparam Compare The comparison function type
     * @param compare Comparison function returning true if first < second
     *
     * @details Sorts the component pool so iteration order matches
     *          the comparison result.
     */
    template<typename T, typename Compare>
    void sort(Compare compare) {
        auto* pool = getPool<T>();
        if (!pool) return;

        const auto& components = pool->components();
        const usize n = components.size();
        if (n <= 1) return;

        std::vector<usize> perm(n);
        for (usize i = 0; i < n; ++i) perm[i] = i;

        std::sort(perm.begin(), perm.end(), [&](usize a, usize b) {
            return compare(components[a], components[b]);
        });
        // The entity, its component and its stamp move together.
        pool->permute(perm);
    }

    /**
     * @brief The entities that carry T, densely
     * @return The pool's dense entity array, or an empty span where no pool exists
     *
     * @details What {@link View} narrows to internally, opened for a caller that
     *          assembles its query at run time from NAMES, as the AOT host does.
     *          Empty means nobody has it — never "ask everybody".
     */
    template<typename T>
    std::span<const Entity> entitiesWith() const {
        const auto* pool = getPool<T>();
        if (pool == nullptr) return {};
        const std::vector<Entity>& dense = pool->entities();
        return std::span<const Entity>(dense.data(), dense.size());
    }

private:
    // Handed out once per registry and never recycled, so it survives one being
    // destroyed and the next taking its address. See instanceId().
    static inline u64 next_instance_id_{0};
    u64 instance_id_{++next_instance_id_};

    // =========================================================================
    // Private Helpers
    // =========================================================================

    /**
     * @brief Gets or creates a component pool for type T
     * @tparam T The component type
     * @return Reference to the SparseSet for type T
     */
    template<typename T>
    SparseSet<T>& assurePool() {
        TypeId typeId = componentTypeId<T>();
        if (typeId >= pools_.size()) {
            pools_.resize(typeId + 1);
        }
        if (!pools_[typeId]) {
            pools_[typeId] = makeUnique<SparseSet<T>>();
        }
        return *static_cast<SparseSet<T>*>(pools_[typeId].get());
    }

    /**
     * @brief Gets an existing component pool (may return nullptr)
     * @tparam T The component type
     * @return Pointer to the SparseSet, or nullptr if not found
     */
    template<typename T>
    SparseSet<T>* getPool() {
        TypeId typeId = componentTypeId<T>();
        if (typeId >= pools_.size() || !pools_[typeId]) return nullptr;
        return static_cast<SparseSet<T>*>(pools_[typeId].get());
    }

    template<typename T>
    const SparseSet<T>* getPool() const {
        TypeId typeId = componentTypeId<T>();
        if (typeId >= pools_.size() || !pools_[typeId]) return nullptr;
        return static_cast<const SparseSet<T>*>(pools_[typeId].get());
    }

    /// Built only when a contract guard is about to abort; names what was asked.
    static std::string noPoolMessage(Entity entity) {
        return "Registry::get: no pool for this component type (entity "
               + std::to_string(entity.index()) + ":" + std::to_string(entity.generation())
               + "); use tryGet() when absence is expected";
    }
    static std::string invalidEntityMessage(const char* op, Entity entity) {
        return std::string("Registry::") + op + " on an invalid entity ("
               + std::to_string(entity.index()) + ":" + std::to_string(entity.generation()) + ")";
    }

    /**
     * @brief Activates an entity index: resizes arrays, bumps generation, returns packed Entity
     */
    Entity activateIndex(u32 index) {
        // Release-safe: an index past the index field would silently alias an
        // existing slot via Entity::make's mask (ES_ASSERT is stripped in
        // release). Refuse before any state mutation. restore() passes a
        // deserialized index here, so this also guards scene loading. Say it out
        // loud: running out is a state someone has to be able to see, and slot
        // retirement below spends this space to buy handle uniqueness.
        if (index > Entity::INDEX_MASK) {
            ES_LOG_ERROR("Registry: entity index space exhausted ({} slots, {} retired to "
                         "generation wrap); create() returns an invalid entity from here on",
                         static_cast<u32>(Entity::INDEX_MASK) + 1u, retired_slots_);
            return INVALID_ENTITY;
        }
        if (index >= entityValid_.size()) {
            entityValid_.resize(index + 1, false);
            disabled_.resize(index + 1, 0);
            destruction_pending_.resize(index + 1, 0);
            generations_.resize(index + 1, 0);
            component_masks_.resize(index + 1);
        }
        entityValid_[index] = true;
        disabled_[index] = 0;
        destruction_pending_[index] = 0;
        if (disabled_count_) ++activity_epoch_;
        generations_[index] = (generations_[index] + 1) & Entity::GEN_MASK;
        if (generations_[index] == 0) generations_[index] = 1;
        component_masks_[index].reset();
        ++entity_count_;
        const auto entity = Entity::make(index, generations_[index]);
        recordEntityChange(entity);
        return entity;
    }

    // =========================================================================
    // Data Members
    // =========================================================================

    std::vector<u8> entityValid_;
    EntityChangeJournal entity_changes_;
    static constexpr u64 RESET_EPOCH_LIMIT = (u64{1} << 53) - 1;
    u64 entity_reset_epoch_ = 0;

    template<typename T>
    void recordComponentChange(Entity entity, u32 flags = 0) {
        if constexpr (std::is_same_v<T, Parent>) flags |= ENTITY_CHANGE_SUBTREE;
        if constexpr (std::is_same_v<T, Parent> || std::is_same_v<T, Children>) {
            if (disabled_count_) ++activity_epoch_;
        }
        recordEntityChange(entity, flags, componentTypeId<T>());
    }
    std::vector<u8> disabled_;
    usize disabled_count_ = 0;
    u32 activity_epoch_ = 1;
    mutable u32 resolved_activity_epoch_ = 0;
    mutable std::vector<u8> inactive_, activity_state_;
    mutable std::vector<u32> activity_path_;

    void ensureActivity() const {
        if (resolved_activity_epoch_ == activity_epoch_) return;
        inactive_.assign(entityValid_.size(), 0);
        activity_state_.assign(entityValid_.size(), 0);
        const auto* parents = getPool<Parent>();
        // Each entity is resolved once, iteratively: deep chains do not recurse
        // or repeatedly walk their ancestors. O(entities + parent links).
        for (usize start = 0; start < entityValid_.size(); ++start) {
            if (!entityValid_[start] || activity_state_[start] == 2) continue;
            activity_path_.clear();
            u32 at = static_cast<u32>(start);
            bool off = false;
            for (;;) {
                if (activity_state_[at] == 2) { off = inactive_[at] != 0; break; }
                if (activity_state_[at] == 1) { off = true; break; }
                activity_state_[at] = 1;
                activity_path_.push_back(at);
                if (disabled_[at]) { off = true; break; }
                const auto* parent = parents ? parents->tryGet(Entity::make(at, generations_[at])) : nullptr;
                if (!parent || !valid(parent->entity)) break;
                at = parent->entity.index();
            }
            for (u32 index : activity_path_) {
                inactive_[index] = off ? 1 : 0;
                activity_state_[index] = 2;
            }
        }
        resolved_activity_epoch_ = activity_epoch_;
    }
    std::vector<u32> generations_;
    std::vector<ComponentMask> component_masks_;
    std::queue<u32> recycled_;      ///< Recycled entity indices
    /// Slots taken out of circulation because their generation ran out. Counted
    /// rather than stored: nothing may hand them out again, so the only use for
    /// them is telling an operator that churn is consuming index space.
    u32 retired_slots_ = 0;
    u32 next_index_ = 0;            ///< Next fresh entity index
    usize entity_count_ = 0;

    /** @brief Type-erased component pools indexed by TypeId */
    std::vector<Unique<SparseSetBase>> pools_;

    /// The tick a write is stamped with (see beginChangeRead). Starts at 1: 0 is "never written".
    u32 change_tick_ = 1;
    bool change_audit_ = false;
    std::vector<SparseSetBase::AuditCopy> audit_copies_;
    std::vector<u8> audit_reported_;
    u32 audit_unstamped_total_ = 0;

    Signal<void(Entity)> on_destroy_signal_;
    // Indexed by the canonical entity slot/generation. Grow during activation,
    // never allocate one hash node per teardown or a whole-world array on the
    // first deletion. Recycled slots start unreserved.
    std::vector<u8> destruction_pending_;
};

}  // namespace esengine::ecs
