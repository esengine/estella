/**
 * @file    Entity.hpp
 * @brief   Entity utilities for the ECS system
 * @details The core Entity type is defined in Types.hpp as a packed struct
 *          with 20-bit index and 12-bit generation.
 *
 * @author  ESEngine Team
 * @date    2025
 *
 * @copyright Copyright (c) 2025 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

// Project includes
#include "../core/Types.hpp"

namespace esengine::ecs {

// =============================================================================
// Entity Handle Functions (64-bit, for FFI)
// =============================================================================

/**
 * @brief Combines entity index and generation into a single 64-bit handle
 * @param index The entity index (lower 32 bits)
 * @param generation The generation number (upper 32 bits)
 * @return A packed 64-bit handle
 */
inline constexpr u64 makeEntityHandle(u32 index, u32 generation) {
    return (static_cast<u64>(generation) << 32) | static_cast<u64>(index);
}

}  // namespace esengine::ecs
