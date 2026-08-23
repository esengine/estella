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
#include "esengine/ecs/components/MeshRenderer.hpp"     // MeshSkin

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

// MeshSkin's joints are a variable-length entity list, so the component has no POD
// layout and nothing generated can carry it — the same reason Children is here. A
// glTF with a rig inserts one, and without these the insert fails on a device.
JSValue js_getMeshSkinJoints(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    JSValue arr = JS_NewArray(ctx);
    if (auto* s = host().registry->tryGet<ecs::MeshSkin>(esn_entity(ctx, argv[0]))) {
        uint32_t i = 0;
        for (Entity joint : s->joints) {
            JS_SetPropertyUint32(ctx, arr, i++, JS_NewUint32(ctx, joint.id()));
        }
    }
    return arr;
}
JSValue js_setMeshSkinJoints(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (argc < 2) return JS_UNDEFINED;
    auto& skin = host().registry->getOrEmplace<ecs::MeshSkin>(esn_entity(ctx, argv[0]));
    skin.joints.clear();
    uint32_t len = 0;
    JSValue lenv = JS_GetPropertyStr(ctx, argv[1], "length");
    JS_ToUint32(ctx, &len, lenv);
    JS_FreeValue(ctx, lenv);
    skin.joints.reserve(len);
    for (uint32_t i = 0; i < len; ++i) {
        JSValue v = JS_GetPropertyUint32(ctx, argv[1], i);
        skin.joints.push_back(esn_entity(ctx, v));
        JS_FreeValue(ctx, v);
    }
    return JS_UNDEFINED;
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
    bindGlobal(h, global, "es_getMeshSkinJoints", js_getMeshSkinJoints, 1);
    bindGlobal(h, global, "es_setMeshSkinJoints", js_setMeshSkinJoints, 2);
}

}  // namespace eshost
