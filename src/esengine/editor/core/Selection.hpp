/**
 * @file    Selection.hpp
 * @brief   Multi-type selection management system
 * @details Provides a unified selection system that can handle different
 *          types of selectable objects (entities, assets, etc.) with
 *          type-safe queries and change notifications.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#pragma once

// =============================================================================
// Includes
// =============================================================================

#include "EditorEvents.hpp"
#include "../../core/Types.hpp"
#include "../../events/Dispatcher.hpp"

#include <algorithm>
#include <any>
#include <functional>
#include <optional>
#include <set>
#include <typeindex>
#include <unordered_map>
#include <vector>

namespace esengine::editor {

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * @brief Type-erased identifier for selectable objects
 *
 * @details SelectableId uniquely identifies any selectable object by
 *          combining its type with a raw ID value.
 */
struct SelectableId {
    std::type_index typeId;
    u64 rawId;

    SelectableId() : typeId(typeid(void)), rawId(0) {}

    template<typename T>
    static SelectableId from(const T& value) {
        SelectableId id;
        id.typeId = std::type_index(typeid(T));

        if constexpr (std::is_integral_v<T>) {
            id.rawId = static_cast<u64>(value);
        } else if constexpr (std::is_pointer_v<T>) {
            id.rawId = reinterpret_cast<u64>(value);
        } else {
            id.rawId = std::hash<T>{}(value);
        }

        return id;
    }

    bool operator==(const SelectableId& other) const {
        return typeId == other.typeId && rawId == other.rawId;
    }

    bool operator!=(const SelectableId& other) const {
        return !(*this == other);
    }

    bool operator<(const SelectableId& other) const {
        if (typeId != other.typeId) {
            return typeId < other.typeId;
        }
        return rawId < other.rawId;
    }
};

/**
 * @brief Selection change event type
 */
enum class SelectionChangeType : u8 {
    Cleared,
    Added,
    Removed,
    Replaced
};

/**
 * @brief Selection change event data
 */
struct SelectionChangedEvent {
    SelectionChangeType type;
    std::vector<SelectableId> added;
    std::vector<SelectableId> removed;
};

}  // namespace esengine::editor

// Hash specialization for SelectableId
template<>
struct std::hash<esengine::editor::SelectableId> {
    std::size_t operator()(const esengine::editor::SelectableId& id) const noexcept {
        auto h1 = std::hash<std::type_index>{}(id.typeId);
        auto h2 = std::hash<esengine::u64>{}(id.rawId);
        return h1 ^ (h2 << 1);
    }
};

namespace esengine::editor {

// =============================================================================
// Selection Class
// =============================================================================

/**
 * @brief Multi-type selection manager
 *
 * @details Selection manages selected objects of any type. It provides
 *          type-safe queries and supports multiple selection with
 *          additive/toggle modes.
 *
 * @code
 * Selection selection;
 *
 * // Select entities
 * selection.select(entity1);
 * selection.addToSelection(entity2);
 *
 * // Query by type
 * auto entities = selection.getSelected<Entity>();
 *
 * // Listen for changes
 * selection.addListener([](const SelectionChangedEvent& e) {
 *     // Handle selection change
 * });
 * @endcode
 */
class Selection {
public:
    using SelectionChangedCallback = std::function<void(const SelectionChangedEvent&)>;

    Selection() = default;
    ~Selection() = default;

    Selection(Selection&&) = default;
    Selection& operator=(Selection&&) = default;

    Selection(const Selection&) = delete;
    Selection& operator=(const Selection&) = delete;

    /**
     * @brief Select a single item (clears previous selection)
     * @tparam T Item type
     * @param item The item to select
     */
    template<typename T>
    void select(const T& item) {
        std::vector<SelectableId> oldSelection(selected_.begin(), selected_.end());

        selected_.clear();
        itemsByType_.clear();

        SelectableId id = SelectableId::from(item);
        selected_.insert(id);
        itemsByType_[std::type_index(typeid(T))].push_back(std::any(item));

        notifyChange(SelectionChangeType::Replaced, {id}, oldSelection);
    }

    /**
     * @brief Add an item to the current selection
     * @tparam T Item type
     * @param item The item to add
     */
    template<typename T>
    void addToSelection(const T& item) {
        SelectableId id = SelectableId::from(item);

        if (selected_.count(id) > 0) {
            return;
        }

        selected_.insert(id);
        itemsByType_[std::type_index(typeid(T))].push_back(std::any(item));

        notifyChange(SelectionChangeType::Added, {id}, {});
    }

    /**
     * @brief Remove an item from the selection
     * @tparam T Item type
     * @param item The item to remove
     */
    template<typename T>
    void removeFromSelection(const T& item) {
        SelectableId id = SelectableId::from(item);

        if (selected_.count(id) == 0) {
            return;
        }

        selected_.erase(id);

        auto typeId = std::type_index(typeid(T));
        auto& items = itemsByType_[typeId];
        items.erase(std::remove_if(items.begin(), items.end(),
                                   [&item](const std::any& a) {
                                       return std::any_cast<T>(a) == item;
                                   }),
                    items.end());

        if (items.empty()) {
            itemsByType_.erase(typeId);
        }

        notifyChange(SelectionChangeType::Removed, {}, {id});
    }

    /**
     * @brief Toggle an item's selection state
     * @tparam T Item type
     * @param item The item to toggle
     */
    template<typename T>
    void toggleSelection(const T& item) {
        SelectableId id = SelectableId::from(item);

        if (selected_.count(id) > 0) {
            removeFromSelection(item);
        } else {
            addToSelection(item);
        }
    }

    /**
     * @brief Check if an item is selected
     * @tparam T Item type
     * @param item The item to check
     * @return true if selected
     */
    template<typename T>
    [[nodiscard]] bool isSelected(const T& item) const {
        return selected_.count(SelectableId::from(item)) > 0;
    }

    /**
     * @brief Clear all selection
     */
    void clear() {
        if (selected_.empty()) {
            return;
        }

        std::vector<SelectableId> oldSelection(selected_.begin(), selected_.end());
        selected_.clear();
        itemsByType_.clear();

        notifyChange(SelectionChangeType::Cleared, {}, oldSelection);
    }

    /**
     * @brief Get all selected items of a specific type
     * @tparam T Item type
     * @return Vector of selected items
     */
    template<typename T>
    [[nodiscard]] std::vector<T> getSelected() const {
        std::vector<T> result;

        auto it = itemsByType_.find(std::type_index(typeid(T)));
        if (it == itemsByType_.end()) {
            return result;
        }

        result.reserve(it->second.size());
        for (const auto& item : it->second) {
            result.push_back(std::any_cast<T>(item));
        }

        return result;
    }

    /**
     * @brief Get the first selected item of a specific type
     * @tparam T Item type
     * @return Optional containing the first item or empty
     */
    template<typename T>
    [[nodiscard]] std::optional<T> getFirstSelected() const {
        auto items = getSelected<T>();
        if (items.empty()) {
            return std::nullopt;
        }
        return items.front();
    }

    /**
     * @brief Check if there are selected items of a specific type
     * @tparam T Item type
     * @return true if there are selected items of type T
     */
    template<typename T>
    [[nodiscard]] bool hasSelected() const {
        auto it = itemsByType_.find(std::type_index(typeid(T)));
        return it != itemsByType_.end() && !it->second.empty();
    }

    /**
     * @brief Get the total count of selected items
     * @return Number of selected items
     */
    [[nodiscard]] usize count() const {
        return selected_.size();
    }

    /**
     * @brief Get the count of selected items of a specific type
     * @tparam T Item type
     * @return Number of selected items of type T
     */
    template<typename T>
    [[nodiscard]] usize count() const {
        auto it = itemsByType_.find(std::type_index(typeid(T)));
        if (it == itemsByType_.end()) {
            return 0;
        }
        return it->second.size();
    }

    /**
     * @brief Check if selection is empty
     * @return true if no items selected
     */
    [[nodiscard]] bool empty() const {
        return selected_.empty();
    }

    /**
     * @brief Add a selection change listener
     * @param callback The callback to invoke on changes
     * @return Listener ID for removal
     */
    u32 addListener(SelectionChangedCallback callback) {
        u32 id = nextListenerId_++;
        listeners_.emplace(id, std::move(callback));
        return id;
    }

    /**
     * @brief Remove a selection change listener
     * @param id The listener ID to remove
     */
    void removeListener(u32 id) {
        listeners_.erase(id);
    }

    /**
     * @brief Set the event dispatcher for global notifications
     * @param dispatcher The dispatcher to use
     */
    void setDispatcher(Dispatcher* dispatcher) {
        dispatcher_ = dispatcher;
    }

private:
    void notifyChange(SelectionChangeType type,
                      const std::vector<SelectableId>& added,
                      const std::vector<SelectableId>& removed) {
        SelectionChangedEvent event{type, added, removed};

        for (const auto& [id, callback] : listeners_) {
            callback(event);
        }

        if (dispatcher_) {
            auto entities = getSelected<Entity>();
            std::vector<Entity> prevEntities;

            for (const auto& id : removed) {
                if (id.typeId == std::type_index(typeid(Entity))) {
                    prevEntities.push_back(static_cast<Entity>(id.rawId));
                }
            }

            dispatcher_->trigger(SelectionChanged{prevEntities, entities});
        }
    }

    std::set<SelectableId> selected_;
    std::unordered_map<std::type_index, std::vector<std::any>> itemsByType_;
    std::unordered_map<u32, SelectionChangedCallback> listeners_;
    u32 nextListenerId_ = 1;
    Dispatcher* dispatcher_ = nullptr;
};

// =============================================================================
// EntitySelection (Specialized for Entity Selection)
// =============================================================================

/**
 * @brief Specialized selection manager for entities
 *
 * @details EntitySelection provides optimized selection management
 *          specifically for Entity types, with additional features
 *          like hierarchy-aware selection.
 */
class EntitySelection {
public:
    EntitySelection() = default;
    ~EntitySelection() = default;

    EntitySelection(EntitySelection&&) = default;
    EntitySelection& operator=(EntitySelection&&) = default;

    EntitySelection(const EntitySelection&) = delete;
    EntitySelection& operator=(const EntitySelection&) = delete;

    /**
     * @brief Select a single entity (clears previous selection)
     * @param entity The entity to select
     */
    void select(Entity entity) {
        if (entity == INVALID_ENTITY) {
            return;
        }

        std::vector<Entity> previous = selected_;
        selected_.clear();
        selected_.push_back(entity);

        notifyChange(previous);
    }

    /**
     * @brief Add an entity to the selection
     * @param entity The entity to add
     */
    void addToSelection(Entity entity) {
        if (entity == INVALID_ENTITY) {
            return;
        }

        if (isSelected(entity)) {
            return;
        }

        std::vector<Entity> previous = selected_;
        selected_.push_back(entity);

        notifyChange(previous);
    }

    /**
     * @brief Remove an entity from the selection
     * @param entity The entity to remove
     */
    void removeFromSelection(Entity entity) {
        auto it = std::find(selected_.begin(), selected_.end(), entity);
        if (it == selected_.end()) {
            return;
        }

        std::vector<Entity> previous = selected_;
        selected_.erase(it);

        notifyChange(previous);
    }

    /**
     * @brief Toggle an entity's selection state
     * @param entity The entity to toggle
     */
    void toggleSelection(Entity entity) {
        if (isSelected(entity)) {
            removeFromSelection(entity);
        } else {
            addToSelection(entity);
        }
    }

    /**
     * @brief Check if an entity is selected
     * @param entity The entity to check
     * @return true if selected
     */
    [[nodiscard]] bool isSelected(Entity entity) const {
        return std::find(selected_.begin(), selected_.end(), entity) != selected_.end();
    }

    /**
     * @brief Clear all selection
     */
    void clear() {
        if (selected_.empty()) {
            return;
        }

        std::vector<Entity> previous = selected_;
        selected_.clear();

        notifyChange(previous);
    }

    /**
     * @brief Get all selected entities
     * @return Vector of selected entities
     */
    [[nodiscard]] const std::vector<Entity>& getSelected() const {
        return selected_;
    }

    /**
     * @brief Get the first selected entity
     * @return First entity or INVALID_ENTITY
     */
    [[nodiscard]] Entity getFirst() const {
        return selected_.empty() ? INVALID_ENTITY : selected_.front();
    }

    /**
     * @brief Get the number of selected entities
     * @return Selection count
     */
    [[nodiscard]] usize count() const {
        return selected_.size();
    }

    /**
     * @brief Check if selection is empty
     * @return true if no entities selected
     */
    [[nodiscard]] bool empty() const {
        return selected_.empty();
    }

    /**
     * @brief Set the event dispatcher
     * @param dispatcher The dispatcher to use
     */
    void setDispatcher(Dispatcher* dispatcher) {
        dispatcher_ = dispatcher;
    }

    /**
     * @brief Add a selection change listener
     * @param callback Callback function
     * @return Listener ID
     */
    u32 addListener(std::function<void(const std::vector<Entity>&,
                                       const std::vector<Entity>&)> callback) {
        u32 id = nextListenerId_++;
        listeners_.emplace(id, std::move(callback));
        return id;
    }

    /**
     * @brief Remove a listener
     * @param id Listener ID to remove
     */
    void removeListener(u32 id) {
        listeners_.erase(id);
    }

private:
    void notifyChange(const std::vector<Entity>& previous) {
        for (const auto& [id, callback] : listeners_) {
            callback(previous, selected_);
        }

        if (dispatcher_) {
            dispatcher_->trigger(SelectionChanged{previous, selected_});
        }
    }

    std::vector<Entity> selected_;
    std::unordered_map<u32, std::function<void(const std::vector<Entity>&,
                                               const std::vector<Entity>&)>> listeners_;
    u32 nextListenerId_ = 1;
    Dispatcher* dispatcher_ = nullptr;
};

}  // namespace esengine::editor
