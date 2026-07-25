// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    EcsBindings.cpp
 * @brief   Entity + hierarchy — the base Registry surface the SDK's World drives.
 * @details Entity ids cross as the native Entity's raw u32 (round-tripped via
 *          Entity::fromRaw), so a hierarchy query returns ids the SDK recognises.
 *
 *          Hand-written because there is nothing to generate from: the web build
 *          reaches the registry as an embind CLASS, not as free binding entry
 *          points, so no binding header declares this surface. Everything
 *          per-component — es_set_<C>, es_<C>_buffer, _has, _remove — IS generated,
 *          from the same reflection the web's embind bindings come from.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#include "Bindings.hpp"

#include "esn_shim.hpp"                           // esn_entity

#include "esengine/ecs/TransformSystem.hpp"       // ecs::setParent
#include "esengine/ecs/components/Hierarchy.hpp"  // Parent / Children

using namespace esengine;

namespace eshost {
namespace {

JSValue js_createEntity(JSContext* ctx, JSValueConst, int, JSValueConst*) {
    return JS_NewUint32(ctx, host().registry->create().id());
}
JSValue js_destroyEntity(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    host().registry->destroy(esn_entity(ctx, argv[0]));
    return JS_UNDEFINED;
}
JSValue js_setParent(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    ecs::setParent(*host().registry, esn_entity(ctx, argv[0]), esn_entity(ctx, argv[1]));
    return JS_UNDEFINED;
}
JSValue js_hasParent(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    return JS_NewBool(ctx, host().registry->has<ecs::Parent>(esn_entity(ctx, argv[0])));
}
JSValue js_getParent(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    auto* p = host().registry->tryGet<ecs::Parent>(esn_entity(ctx, argv[0]));
    return JS_NewUint32(ctx, (p ? p->entity : INVALID_ENTITY).id());
}
JSValue js_removeParent(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    ecs::setParent(*host().registry, esn_entity(ctx, argv[0]), INVALID_ENTITY);
    return JS_UNDEFINED;
}
JSValue js_hasChildren(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    auto* c = host().registry->tryGet<ecs::Children>(esn_entity(ctx, argv[0]));
    return JS_NewBool(ctx, c && !c->entities.empty());
}
JSValue js_getChildren(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    JSValue arr = JS_NewArray(ctx);
    if (auto* c = host().registry->tryGet<ecs::Children>(esn_entity(ctx, argv[0]))) {
        uint32_t i = 0;
        for (Entity child : c->entities) {
            JS_SetPropertyUint32(ctx, arr, i++, JS_NewUint32(ctx, child.id()));
        }
    }
    return arr;
}

}  // namespace

void registerEcsBindings(HostState& h, JSValue global) {
    bindGlobal(h, global, "es_createEntity", js_createEntity, 0);
    bindGlobal(h, global, "es_destroyEntity", js_destroyEntity, 1);
    bindGlobal(h, global, "es_setParent", js_setParent, 2);
    bindGlobal(h, global, "es_hasParent", js_hasParent, 1);
    bindGlobal(h, global, "es_getParent", js_getParent, 1);
    bindGlobal(h, global, "es_removeParent", js_removeParent, 1);
    bindGlobal(h, global, "es_hasChildren", js_hasChildren, 1);
    bindGlobal(h, global, "es_getChildren", js_getChildren, 1);
}

}  // namespace eshost
