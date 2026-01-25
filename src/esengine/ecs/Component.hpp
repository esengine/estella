/**
 * @file    Component.hpp
 * @brief   Unified header for all built-in ECS components
 * @details This header aggregates all component types for convenience.
 *          Individual component headers can be included separately for
 *          reduced compile times in larger projects.
 *
 * Component files:
 * - components/Transform.hpp  - LocalTransform, WorldTransform, TransformDirty
 * - components/Hierarchy.hpp  - Parent, Children, HierarchyDepth
 * - components/Sprite.hpp     - Sprite
 * - components/Camera.hpp     - Camera, ProjectionType
 * - components/Velocity.hpp   - Velocity
 * - components/Common.hpp     - Name, UUID, Active, Visible, Static, MainEntity
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

// =============================================================================
// Component Includes
// =============================================================================

#include "components/Transform.hpp"
#include "components/Hierarchy.hpp"
#include "components/Sprite.hpp"
#include "components/Camera.hpp"
#include "components/Velocity.hpp"
#include "components/Common.hpp"
