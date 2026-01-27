#pragma once

#include "../core/Types.hpp"
#include "../ecs/Entity.hpp"

#include <glm/glm.hpp>

#include <string>
#include <variant>

namespace esengine::editor {

enum class DragDropType : u8 {
    None,
    Asset,
    Entity,
    Component
};

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
