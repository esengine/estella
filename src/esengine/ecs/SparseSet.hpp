#pragma once

#include "../core/Types.hpp"
#include "Entity.hpp"
#include <algorithm>
#include <vector>

namespace esengine::ecs {

// Base class for type-erased sparse set operations
class SparseSetBase {
public:
    virtual ~SparseSetBase() = default;

    virtual bool contains(Entity entity) const = 0;
    virtual void remove(Entity entity) = 0;
    virtual usize size() const = 0;
    virtual bool empty() const = 0;
    virtual void clear() = 0;
    virtual const std::vector<Entity>& entities() const = 0;
};

// SparseSet: O(1) insertion, deletion, lookup with cache-friendly iteration
template<typename T>
class SparseSet : public SparseSetBase {
public:
    using Iterator = typename std::vector<Entity>::const_iterator;

    SparseSet() = default;
    ~SparseSet() override = default;

    // Non-copyable, movable
    SparseSet(const SparseSet&) = delete;
    SparseSet& operator=(const SparseSet&) = delete;
    SparseSet(SparseSet&&) noexcept = default;
    SparseSet& operator=(SparseSet&&) noexcept = default;

    // Check if entity exists in set
    bool contains(Entity entity) const override {
        return entity < sparse_.size() &&
               sparse_[entity] < dense_.size() &&
               dense_[sparse_[entity]] == entity;
    }

    // Get component for entity (must exist)
    T& get(Entity entity) {
        ES_ASSERT(contains(entity), "Entity does not have component");
        return components_[sparse_[entity]];
    }

    const T& get(Entity entity) const {
        ES_ASSERT(contains(entity), "Entity does not have component");
        return components_[sparse_[entity]];
    }

    // Try to get component, returns nullptr if not found
    T* tryGet(Entity entity) {
        if (!contains(entity)) return nullptr;
        return &components_[sparse_[entity]];
    }

    const T* tryGet(Entity entity) const {
        if (!contains(entity)) return nullptr;
        return &components_[sparse_[entity]];
    }

    // Add component to entity
    template<typename... Args>
    T& emplace(Entity entity, Args&&... args) {
        ES_ASSERT(!contains(entity), "Entity already has component");

        // Ensure sparse array is large enough
        if (entity >= sparse_.size()) {
            sparse_.resize(entity + 1, INVALID_ENTITY);
        }

        // Add to dense arrays
        sparse_[entity] = static_cast<Entity>(dense_.size());
        dense_.push_back(entity);
        components_.emplace_back(std::forward<Args>(args)...);

        return components_.back();
    }

    // Remove component from entity
    void remove(Entity entity) override {
        if (!contains(entity)) return;

        // Swap with last element (swap and pop)
        const auto last = dense_.back();
        const auto index = sparse_[entity];

        // Move last element to removed position
        dense_[index] = last;
        components_[index] = std::move(components_.back());
        sparse_[last] = index;

        // Pop last element
        dense_.pop_back();
        components_.pop_back();
        sparse_[entity] = INVALID_ENTITY;
    }

    // Container operations
    usize size() const override { return dense_.size(); }
    bool empty() const override { return dense_.empty(); }

    void clear() override {
        sparse_.clear();
        dense_.clear();
        components_.clear();
    }

    // Iteration - iterate over entities
    Iterator begin() const { return dense_.begin(); }
    Iterator end() const { return dense_.end(); }

    // Access to dense entity array (for views)
    const std::vector<Entity>& entities() const override { return dense_; }

    // Access to component array (for direct iteration)
    std::vector<T>& components() { return components_; }
    const std::vector<T>& components() const { return components_; }

    // Get index in dense array for entity
    usize indexOf(Entity entity) const {
        ES_ASSERT(contains(entity), "Entity not in set");
        return sparse_[entity];
    }

private:
    std::vector<Entity> sparse_;      // Entity -> Dense index
    std::vector<Entity> dense_;       // Dense index -> Entity
    std::vector<T> components_;       // Dense storage for components
};

}  // namespace esengine::ecs
