/**
 * @file    DragDropTypes.hpp
 * @brief   Type definitions for drag-and-drop operations
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

#include "../core/Types.hpp"
#include "../ecs/Entity.hpp"

#include <glm/glm.hpp>

#include <string>
#include <variant>

namespace esengine::editor {

// =============================================================================
// Enumerations
// =============================================================================

enum class DragDropType : u8 {
    None,
    Asset,
    Entity,
    Component
};

// =============================================================================
// Data Structures
// =============================================================================

struct AssetDragData {
    std::string guid;
    std::string path;
    std::string name;
};

struct EntityDragData {
    Entity entity = INVALID_ENTITY;
};

struct ComponentDragData {
    Entity entity = INVALID_ENTITY;
    std::string componentType;
};

using DragDropData = std::variant<std::monostate, AssetDragData, EntityDragData, ComponentDragData>;

struct DragDropPayload {
    DragDropType type = DragDropType::None;
    DragDropData data;

    bool isValid() const { return type != DragDropType::None; }
};

}  // namespace esengine::editor
