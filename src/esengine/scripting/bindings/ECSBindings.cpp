/**
 * @file    ECSBindings.cpp
 * @brief   JavaScript bindings for ECS system implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "ECSBindings.hpp"
#include "../../core/Log.hpp"
#include "../../ecs/Registry.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../ecs/components/Velocity.hpp"
#include "../ScriptValue.hpp"

#ifdef ES_SCRIPTING_ENABLED
    #include <quickjs.h>
#endif

namespace esengine {

#ifdef ES_SCRIPTING_ENABLED

// Global registry pointer (set by bindECS)
static ecs::Registry* g_registry = nullptr;

// =============================================================================
// Helper functions for type conversion
// =============================================================================

/**
 * @brief Convert JavaScript object to glm::vec3
 */
static glm::vec3 jsToVec3(JSContext* ctx, JSValue jsObj) {
    glm::vec3 result(0.0f);

    JSValue x = JS_GetPropertyStr(ctx, jsObj, "x");
    JSValue y = JS_GetPropertyStr(ctx, jsObj, "y");
    JSValue z = JS_GetPropertyStr(ctx, jsObj, "z");

    double dx, dy, dz;
    JS_ToFloat64(ctx, &dx, x);
    JS_ToFloat64(ctx, &dy, y);
    JS_ToFloat64(ctx, &dz, z);

    result.x = static_cast<f32>(dx);
    result.y = static_cast<f32>(dy);
    result.z = static_cast<f32>(dz);

    JS_FreeValue(ctx, x);
    JS_FreeValue(ctx, y);
    JS_FreeValue(ctx, z);

    return result;
}

/**
 * @brief Convert glm::vec3 to JavaScript object
 */
static JSValue vec3ToJS(JSContext* ctx, const glm::vec3& vec) {
    JSValue obj = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, obj, "x", JS_NewFloat64(ctx, vec.x));
    JS_SetPropertyStr(ctx, obj, "y", JS_NewFloat64(ctx, vec.y));
    JS_SetPropertyStr(ctx, obj, "z", JS_NewFloat64(ctx, vec.z));
    return obj;
}

/**
 * @brief Convert JavaScript object to glm::quat
 */
static glm::quat jsToQuat(JSContext* ctx, JSValue jsObj) {
    glm::quat result(1.0f, 0.0f, 0.0f, 0.0f);  // identity

    JSValue w = JS_GetPropertyStr(ctx, jsObj, "w");
    JSValue x = JS_GetPropertyStr(ctx, jsObj, "x");
    JSValue y = JS_GetPropertyStr(ctx, jsObj, "y");
    JSValue z = JS_GetPropertyStr(ctx, jsObj, "z");

    double dw, dx, dy, dz;
    JS_ToFloat64(ctx, &dw, w);
    JS_ToFloat64(ctx, &dx, x);
    JS_ToFloat64(ctx, &dy, y);
    JS_ToFloat64(ctx, &dz, z);

    result.w = static_cast<f32>(dw);
    result.x = static_cast<f32>(dx);
    result.y = static_cast<f32>(dy);
    result.z = static_cast<f32>(dz);

    JS_FreeValue(ctx, w);
    JS_FreeValue(ctx, x);
    JS_FreeValue(ctx, y);
    JS_FreeValue(ctx, z);

    return result;
}

/**
 * @brief Convert glm::quat to JavaScript object
 */
static JSValue quatToJS(JSContext* ctx, const glm::quat& quat) {
    JSValue obj = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, obj, "w", JS_NewFloat64(ctx, quat.w));
    JS_SetPropertyStr(ctx, obj, "x", JS_NewFloat64(ctx, quat.x));
    JS_SetPropertyStr(ctx, obj, "y", JS_NewFloat64(ctx, quat.y));
    JS_SetPropertyStr(ctx, obj, "z", JS_NewFloat64(ctx, quat.z));
    return obj;
}

// =============================================================================
// Registry bindings
// =============================================================================

/**
 * @brief Registry.create() - Create new entity
 */
static JSValue js_Registry_create(JSContext* ctx, JSValue this_val, int argc, JSValue* argv) {
    (void)this_val;
    (void)argc;
    (void)argv;

    if (!g_registry) {
        return JS_ThrowReferenceError(ctx, "Registry not bound");
    }

    Entity entity = g_registry->create();
    return JS_NewUint32(ctx, static_cast<u32>(entity));
}

/**
 * @brief Registry.destroy(entity) - Destroy entity
 */
static JSValue js_Registry_destroy(JSContext* ctx, JSValue this_val, int argc, JSValue* argv) {
    (void)this_val;

    if (argc < 1) {
        return JS_ThrowTypeError(ctx, "destroy() requires entity argument");
    }

    if (!g_registry) {
        return JS_ThrowReferenceError(ctx, "Registry not bound");
    }

    u32 entityId;
    if (JS_ToUint32(ctx, &entityId, argv[0]) < 0) {
        return JS_ThrowTypeError(ctx, "entity must be a number");
    }

    g_registry->destroy(static_cast<Entity>(entityId));
    return JS_UNDEFINED;
}

/**
 * @brief Registry.valid(entity) - Check if entity is valid
 */
static JSValue js_Registry_valid(JSContext* ctx, JSValue this_val, int argc, JSValue* argv) {
    (void)this_val;

    if (argc < 1) {
        return JS_ThrowTypeError(ctx, "valid() requires entity argument");
    }

    if (!g_registry) {
        return JS_ThrowReferenceError(ctx, "Registry not bound");
    }

    u32 entityId;
    if (JS_ToUint32(ctx, &entityId, argv[0]) < 0) {
        return JS_ThrowTypeError(ctx, "entity must be a number");
    }

    bool isValid = g_registry->valid(static_cast<Entity>(entityId));
    return JS_NewBool(ctx, isValid);
}

// =============================================================================
// Transform component bindings
// =============================================================================

/**
 * @brief Registry.getTransform(entity) - Get LocalTransform component
 */
static JSValue js_Registry_getTransform(JSContext* ctx, JSValue this_val, int argc, JSValue* argv) {
    (void)this_val;

    if (argc < 1) {
        return JS_ThrowTypeError(ctx, "getTransform() requires entity argument");
    }

    if (!g_registry) {
        return JS_ThrowReferenceError(ctx, "Registry not bound");
    }

    u32 entityId;
    if (JS_ToUint32(ctx, &entityId, argv[0]) < 0) {
        return JS_ThrowTypeError(ctx, "entity must be a number");
    }

    Entity entity = static_cast<Entity>(entityId);

    if (!g_registry->has<ecs::LocalTransform>(entity)) {
        return JS_ThrowReferenceError(ctx, "Entity does not have Transform component");
    }

    const auto& transform = g_registry->get<ecs::LocalTransform>(entity);

    // Create JavaScript object
    JSValue obj = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, obj, "position", vec3ToJS(ctx, transform.position));
    JS_SetPropertyStr(ctx, obj, "rotation", quatToJS(ctx, transform.rotation));
    JS_SetPropertyStr(ctx, obj, "scale", vec3ToJS(ctx, transform.scale));

    return obj;
}

/**
 * @brief Registry.setTransform(entity, transform) - Set LocalTransform component
 */
static JSValue js_Registry_setTransform(JSContext* ctx, JSValue this_val, int argc, JSValue* argv) {
    (void)this_val;

    if (argc < 2) {
        return JS_ThrowTypeError(ctx, "setTransform() requires entity and transform arguments");
    }

    if (!g_registry) {
        return JS_ThrowReferenceError(ctx, "Registry not bound");
    }

    u32 entityId;
    if (JS_ToUint32(ctx, &entityId, argv[0]) < 0) {
        return JS_ThrowTypeError(ctx, "entity must be a number");
    }

    Entity entity = static_cast<Entity>(entityId);

    // Parse transform object
    JSValue jsTransform = argv[1];
    if (!JS_IsObject(jsTransform)) {
        return JS_ThrowTypeError(ctx, "transform must be an object");
    }

    ecs::LocalTransform transform;

    // Get position
    JSValue jsPosition = JS_GetPropertyStr(ctx, jsTransform, "position");
    if (JS_IsObject(jsPosition)) {
        transform.position = jsToVec3(ctx, jsPosition);
    }
    JS_FreeValue(ctx, jsPosition);

    // Get rotation
    JSValue jsRotation = JS_GetPropertyStr(ctx, jsTransform, "rotation");
    if (JS_IsObject(jsRotation)) {
        transform.rotation = jsToQuat(ctx, jsRotation);
    }
    JS_FreeValue(ctx, jsRotation);

    // Get scale
    JSValue jsScale = JS_GetPropertyStr(ctx, jsTransform, "scale");
    if (JS_IsObject(jsScale)) {
        transform.scale = jsToVec3(ctx, jsScale);
    }
    JS_FreeValue(ctx, jsScale);

    // Set or add component
    g_registry->emplaceOrReplace<ecs::LocalTransform>(entity, transform);

    return JS_UNDEFINED;
}

// =============================================================================
// Velocity component bindings
// =============================================================================

/**
 * @brief Registry.getVelocity(entity) - Get Velocity component
 */
static JSValue js_Registry_getVelocity(JSContext* ctx, JSValue this_val, int argc, JSValue* argv) {
    (void)this_val;

    if (argc < 1) {
        return JS_ThrowTypeError(ctx, "getVelocity() requires entity argument");
    }

    if (!g_registry) {
        return JS_ThrowReferenceError(ctx, "Registry not bound");
    }

    u32 entityId;
    if (JS_ToUint32(ctx, &entityId, argv[0]) < 0) {
        return JS_ThrowTypeError(ctx, "entity must be a number");
    }

    Entity entity = static_cast<Entity>(entityId);

    if (!g_registry->has<ecs::Velocity>(entity)) {
        return JS_ThrowReferenceError(ctx, "Entity does not have Velocity component");
    }

    const auto& velocity = g_registry->get<ecs::Velocity>(entity);

    JSValue obj = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, obj, "linear", vec3ToJS(ctx, velocity.linear));
    JS_SetPropertyStr(ctx, obj, "angular", vec3ToJS(ctx, velocity.angular));

    return obj;
}

/**
 * @brief Registry.setVelocity(entity, velocity) - Set Velocity component
 */
static JSValue js_Registry_setVelocity(JSContext* ctx, JSValue this_val, int argc, JSValue* argv) {
    (void)this_val;

    if (argc < 2) {
        return JS_ThrowTypeError(ctx, "setVelocity() requires entity and velocity arguments");
    }

    if (!g_registry) {
        return JS_ThrowReferenceError(ctx, "Registry not bound");
    }

    u32 entityId;
    if (JS_ToUint32(ctx, &entityId, argv[0]) < 0) {
        return JS_ThrowTypeError(ctx, "entity must be a number");
    }

    Entity entity = static_cast<Entity>(entityId);

    JSValue jsVelocity = argv[1];
    if (!JS_IsObject(jsVelocity)) {
        return JS_ThrowTypeError(ctx, "velocity must be an object");
    }

    ecs::Velocity velocity;

    JSValue jsLinear = JS_GetPropertyStr(ctx, jsVelocity, "linear");
    if (JS_IsObject(jsLinear)) {
        velocity.linear = jsToVec3(ctx, jsLinear);
    }
    JS_FreeValue(ctx, jsLinear);

    JSValue jsAngular = JS_GetPropertyStr(ctx, jsVelocity, "angular");
    if (JS_IsObject(jsAngular)) {
        velocity.angular = jsToVec3(ctx, jsAngular);
    }
    JS_FreeValue(ctx, jsAngular);

    g_registry->emplaceOrReplace<ecs::Velocity>(entity, velocity);

    return JS_UNDEFINED;
}

// =============================================================================
// Main binding function
// =============================================================================

void bindECS(ScriptContext& ctx, ecs::Registry& registry) {
    if (!ctx.isInitialized()) {
        ES_LOG_ERROR("Cannot bind ECS to uninitialized ScriptContext");
        return;
    }

    g_registry = &registry;

    JSContext* jsCtx = ctx.getJSContext();

    // Get global object
    JSValue global = JS_GetGlobalObject(jsCtx);

    // Create Registry object
    JSValue registryObj = JS_NewObject(jsCtx);

    // Bind Registry methods
    JS_SetPropertyStr(jsCtx, registryObj, "create",
                     JS_NewCFunction(jsCtx, js_Registry_create, "create", 0));
    JS_SetPropertyStr(jsCtx, registryObj, "destroy",
                     JS_NewCFunction(jsCtx, js_Registry_destroy, "destroy", 1));
    JS_SetPropertyStr(jsCtx, registryObj, "valid",
                     JS_NewCFunction(jsCtx, js_Registry_valid, "valid", 1));

    // Bind Transform methods
    JS_SetPropertyStr(jsCtx, registryObj, "getTransform",
                     JS_NewCFunction(jsCtx, js_Registry_getTransform, "getTransform", 1));
    JS_SetPropertyStr(jsCtx, registryObj, "setTransform",
                     JS_NewCFunction(jsCtx, js_Registry_setTransform, "setTransform", 2));

    // Bind Velocity methods
    JS_SetPropertyStr(jsCtx, registryObj, "getVelocity",
                     JS_NewCFunction(jsCtx, js_Registry_getVelocity, "getVelocity", 1));
    JS_SetPropertyStr(jsCtx, registryObj, "setVelocity",
                     JS_NewCFunction(jsCtx, js_Registry_setVelocity, "setVelocity", 2));

    // Set Registry on global object
    JS_SetPropertyStr(jsCtx, global, "Registry", registryObj);

    JS_FreeValue(jsCtx, global);

    ES_LOG_INFO("ECS bindings registered (Registry, Transform, Velocity)");
}

#else

void bindECS(ScriptContext& ctx, ecs::Registry& registry) {
    (void)ctx;
    (void)registry;
    ES_LOG_WARN("Scripting not enabled on this platform");
}

#endif  // ES_SCRIPTING_ENABLED

}  // namespace esengine
