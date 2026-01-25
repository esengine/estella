#pragma once

#include "../core/Types.hpp"
#include "Entity.hpp"
#include "SparseSet.hpp"
#include <tuple>

namespace esengine::ecs {

// Forward declaration
class Registry;

// View iterator - iterates over entities that have all specified components
template<typename... Components>
class ViewIterator {
public:
    using PoolsTuple = std::tuple<SparseSet<Components>*...>;

    ViewIterator(const std::vector<Entity>* entities, usize index, PoolsTuple pools)
        : entities_(entities), index_(index), pools_(pools) {
        // Skip to first valid entity
        if (entities_ && index_ < entities_->size()) {
            skipInvalid();
        }
    }

    Entity operator*() const {
        return (*entities_)[index_];
    }

    ViewIterator& operator++() {
        ++index_;
        skipInvalid();
        return *this;
    }

    bool operator!=(const ViewIterator& other) const {
        return index_ != other.index_;
    }

    bool operator==(const ViewIterator& other) const {
        return index_ == other.index_;
    }

private:
    void skipInvalid() {
        while (index_ < entities_->size()) {
            Entity entity = (*entities_)[index_];
            if (allHave(entity)) {
                break;
            }
            ++index_;
        }
    }

    bool allHave(Entity entity) const {
        return allHaveImpl(entity, std::index_sequence_for<Components...>{});
    }

    template<usize... Is>
    bool allHaveImpl(Entity entity, std::index_sequence<Is...>) const {
        return (std::get<Is>(pools_)->contains(entity) && ...);
    }

    const std::vector<Entity>* entities_;
    usize index_;
    PoolsTuple pools_;
};

// View - provides iteration over entities with specific components
template<typename... Components>
class View {
public:
    using Iterator = ViewIterator<Components...>;
    using PoolsTuple = std::tuple<SparseSet<Components>*...>;

    View(PoolsTuple pools) : pools_(pools) {
        // Find the smallest pool to iterate over
        findSmallestPool();
    }

    Iterator begin() const {
        if (!smallest_) return end();
        return Iterator(&smallest_->entities(), 0, pools_);
    }

    Iterator end() const {
        if (!smallest_) return Iterator(nullptr, 0, pools_);
        return Iterator(&smallest_->entities(), smallest_->size(), pools_);
    }

    // Get component from view (entity must be valid)
    template<typename T>
    T& get(Entity entity) {
        return std::get<SparseSet<T>*>(pools_)->get(entity);
    }

    template<typename T>
    const T& get(Entity entity) const {
        return std::get<SparseSet<T>*>(pools_)->get(entity);
    }

    // Get multiple components at once
    std::tuple<Components&...> getAll(Entity entity) {
        return std::tuple<Components&...>(
            std::get<SparseSet<Components>*>(pools_)->get(entity)...);
    }

    // Check if view is empty
    bool empty() const {
        return !smallest_ || smallest_->empty();
    }

    // Estimate size (upper bound)
    usize sizeHint() const {
        return smallest_ ? smallest_->size() : 0;
    }

    // Execute function for each entity
    template<typename Func>
    void each(Func&& func) {
        for (auto entity : *this) {
            if constexpr (std::is_invocable_v<Func, Entity, Components&...>) {
                func(entity, get<Components>(entity)...);
            } else if constexpr (std::is_invocable_v<Func, Components&...>) {
                func(get<Components>(entity)...);
            } else {
                func(entity);
            }
        }
    }

private:
    void findSmallestPool() {
        smallest_ = nullptr;
        usize minSize = std::numeric_limits<usize>::max();

        findSmallestImpl(minSize, std::index_sequence_for<Components...>{});
    }

    template<usize... Is>
    void findSmallestImpl(usize& minSize, std::index_sequence<Is...>) {
        ((checkPool<Is>(minSize)), ...);
    }

    template<usize I>
    void checkPool(usize& minSize) {
        auto* pool = std::get<I>(pools_);
        if (pool && pool->size() < minSize) {
            minSize = pool->size();
            smallest_ = reinterpret_cast<SparseSetBase*>(pool);
        }
    }

    PoolsTuple pools_;
    SparseSetBase* smallest_ = nullptr;
};

// Single component view specialization (more efficient)
template<typename T>
class View<T> {
public:
    using Iterator = typename std::vector<Entity>::const_iterator;

    explicit View(SparseSet<T>* pool) : pool_(pool) {}

    Iterator begin() const { return pool_ ? pool_->begin() : Iterator{}; }
    Iterator end() const { return pool_ ? pool_->end() : Iterator{}; }

    T& get(Entity entity) { return pool_->get(entity); }
    const T& get(Entity entity) const { return pool_->get(entity); }

    bool empty() const { return !pool_ || pool_->empty(); }
    usize size() const { return pool_ ? pool_->size() : 0; }

    template<typename Func>
    void each(Func&& func) {
        if (!pool_) return;

        const auto& entities = pool_->entities();
        auto& components = pool_->components();

        for (usize i = 0; i < entities.size(); ++i) {
            if constexpr (std::is_invocable_v<Func, Entity, T&>) {
                func(entities[i], components[i]);
            } else if constexpr (std::is_invocable_v<Func, T&>) {
                func(components[i]);
            } else {
                func(entities[i]);
            }
        }
    }

private:
    SparseSet<T>* pool_;
};

}  // namespace esengine::ecs
