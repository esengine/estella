/**
 * @file    ECSBindings.hpp
 * @brief   JavaScript bindings for ECS system
 * @details Exposes Entity, Registry, and Components to JavaScript
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

#include "../ScriptContext.hpp"

namespace esengine {

namespace ecs {
class Registry;
}

/**
 * @brief Register ECS bindings with JavaScript context
 *
 * @details Exposes the following to JavaScript:
 * - Entity creation/destruction
 * - Component get/set operations
 * - Transform, Velocity, Sprite components
 * - Vec3, Quat math types
 *
 * Usage:
 * @code
 * ScriptContext ctx;
 * ctx.init();
 * bindECS(ctx);
 *
 * // JavaScript can now use:
 * // let entity = Registry.create();
 * // let transform = Registry.getTransform(entity);
 * // transform.position.x += 1.0;
 * // Registry.setTransform(entity, transform);
 * @endcode
 *
 * @param ctx JavaScript context to bind to
 * @param registry ECS registry instance to expose
 */
void bindECS(ScriptContext& ctx, ecs::Registry& registry);

}  // namespace esengine
