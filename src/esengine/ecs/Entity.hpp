#pragma once

#include "../core/Types.hpp"

namespace esengine::ecs {

// Entity is just an ID - defined in Types.hpp
// This file provides entity-related utilities

// Entity version for entity recycling
struct EntityVersion {
    Entity id;
    u32 version;
};

// Combine entity ID and version into a single value
inline constexpr u64 makeEntityHandle(Entity id, u32 version) {
    return (static_cast<u64>(version) << 32) | static_cast<u64>(id);
}

inline constexpr Entity getEntityId(u64 handle) {
    return static_cast<Entity>(handle & 0xFFFFFFFF);
}

inline constexpr u32 getEntityVersion(u64 handle) {
    return static_cast<u32>(handle >> 32);
}

// Entity traits
struct EntityTraits {
    static constexpr Entity null() { return INVALID_ENTITY; }
    static constexpr bool isValid(Entity entity) { return entity != INVALID_ENTITY; }
};

}  // namespace esengine::ecs
