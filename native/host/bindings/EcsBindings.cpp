// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    EcsBindings.cpp
 * @brief   Hierarchy reads and the transform composition — the entity-level
 *          entry points that are not Registry methods on the web.
 * @details Entity ids cross as the native Entity's raw u32 (round-tripped via
 *          Entity::fromRaw), so a hierarchy query returns ids the SDK recognises.
 *
 *          The Registry's own entity ops (create, destroy, valid, activity,
 *          destruction ownership, setParent) are NOT here: they are generated as
 *          es_registry_<op> from tools/eht/registry_ops.py, the table the embind
 *          Registry is generated from, so the two hosts cannot bind different
 *          sets. What stays is what embind answers through the Parent/Children
 *          components or module free functions, which have no native surface.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#include "Bindings.hpp"

#include "esn_shim.hpp"                           // esn_entity

#include "esengine/ecs/TransformSystem.hpp"       // ecs::setParent, the composition epoch
#include "esengine/ecs/components/Hierarchy.hpp"  // Parent / Children
#include "esengine/ecs/components/MeshRenderer.hpp"     // MeshSkin

using namespace esengine;

namespace eshost {
namespace {

/**
 * Every pool's version in one number — `Registry::layoutEpoch`, which the web
 * build reaches as an embind free function. A holder of raw addresses asks this
 * before trusting them for another frame, and a host that cannot answer makes
 * that holder re-resolve everything every frame.
 */
esjs::Val js_layoutEpoch(const esjs::Args& a) {
    return esjs::number(host().registry->layoutEpoch());
}
esjs::Val js_hasParent(const esjs::Args& a) {
    return esjs::boolean(host().registry->has<ecs::Parent>(esn_entity(a[0])));
}
esjs::Val js_getParent(const esjs::Args& a) {
    auto* p = host().registry->tryGet<ecs::Parent>(esn_entity(a[0]));
    return esjs::uint32((p ? p->entity : INVALID_ENTITY).id());
}
esjs::Val js_removeParent(const esjs::Args& a) {
    ecs::setParent(*host().registry, esn_entity(a[0]), INVALID_ENTITY);
    return esjs::undefined();
}
esjs::Val js_hasChildren(const esjs::Args& a) {
    auto* c = host().registry->tryGet<ecs::Children>(esn_entity(a[0]));
    return esjs::boolean(c && !c->entities.empty());
}
esjs::Val js_getChildren(const esjs::Args& a) {
    esjs::Val arr = esjs::array();
    if (auto* c = host().registry->tryGet<ecs::Children>(esn_entity(a[0]))) {
        uint32_t i = 0;
        for (Entity child : c->entities) {
            esjs::setAt(arr, i++, esjs::uint32(child.id()));
        }
    }
    return arr;
}

// MeshSkin's joints are a variable-length entity list, so the component has no POD
// layout and nothing generated can carry it — the same reason Children is here. A
// glTF with a rig inserts one, and without these the insert fails on a device.
esjs::Val js_getMeshSkinJoints(const esjs::Args& a) {
    esjs::Val arr = esjs::array();
    if (auto* s = host().registry->tryGet<ecs::MeshSkin>(esn_entity(a[0]))) {
        uint32_t i = 0;
        for (Entity joint : s->joints) {
            esjs::setAt(arr, i++, esjs::uint32(joint.id()));
        }
    }
    return arr;
}
esjs::Val js_setMeshSkinJoints(const esjs::Args& a) {
    if (a.size() < 2) return esjs::undefined();
    auto& skin = host().registry->getOrEmplace<ecs::MeshSkin>(esn_entity(a[0]));
    skin.joints.clear();
    uint32_t len = 0;
    esjs::Val lenv = esjs::get(a[1], "length");
    len = esjs::toUint32(lenv);
    skin.joints.reserve(len);
    for (uint32_t i = 0; i < len; ++i) {
        esjs::Val v = esjs::getAt(a[1], i);
        skin.joints.push_back(esn_entity(v));
    }
    return esjs::undefined();
}

/**
 * The composition's staleness counter, as MEMORY rather than a call: every
 * Transform write announces through it, and an ABI call for one integer nearly
 * doubles the write it follows (bench/transform-invalidation).
 */
esjs::Val js_transformEpochBuffer(const esjs::Args& a) {
    return esn_arraybuffer(&ecs::transformMutationEpoch(), sizeof(u32));
}
/** Whether composition also records which entities' output moved. Off by default;
 *  only a consumer maintaining an incremental structure pays for it. */
esjs::Val js_transformSetChangeTracking(const esjs::Args& a) {
    if (a.size() >= 1 && host().ctx) {
        if (auto* ts = host().ctx->tryGet<ecs::TransformSystem>()) {
            ts->setChangeTracking(esjs::toBool(a[0]));
        }
    }
    return esjs::undefined();
}
/**
 * What every composition since the last acknowledgement changed. The buffer views
 * the system's own vector and the next composition may move it, so a consumer
 * reads, applies, and acknowledges within one turn.
 */
esjs::Val js_transformCompositionChanges(const esjs::Args& a) {
    static_assert(sizeof(Entity) == sizeof(u32), "the changed set is read as raw ids");
    auto* ts = host().ctx ? host().ctx->tryGet<ecs::TransformSystem>() : nullptr;
    esjs::Val out = esjs::object();
    esjs::set(out, "serial", esjs::uint32(ts ? ts->compositionSerial() : 0));
    esjs::set(out, "tracking", esjs::boolean(ts && ts->changeTracking()));
    esjs::set(out, "overflowed", esjs::boolean(ts && ts->changesOverflowed()));
    const size_t count = ts ? ts->pendingChanges().size() : 0;
    esjs::set(out, "count", esjs::uint32(static_cast<uint32_t>(count)));
    esjs::set(out, "visited", esjs::uint32(ts ? ts->visited() : 0));
    esjs::set(out, "changed", count == 0 ? esjs::null()
        : esn_arraybuffer(const_cast<Entity*>(ts->pendingChanges().data()), count * sizeof(Entity)));
    return out;
}
/** Applied: the set starts again. Separate from the read, so a consumer that
 *  throws half way through has not acknowledged and gets it again. */
esjs::Val js_transformTakeChanges(const esjs::Args& a) {
    if (host().ctx) {
        if (auto* ts = host().ctx->tryGet<ecs::TransformSystem>()) ts->takeChanges();
    }
    return esjs::undefined();
}
/** The consumer half: compose if a producer said the inputs moved. A headless
 *  host installs no renderer, and nothing else would ever schedule it. */
esjs::Val js_transformEnsureComposed(const esjs::Args& a) {
    if (host().ctx && host().registry) {
        if (auto* ts = host().ctx->tryGet<ecs::TransformSystem>()) ts->ensureComposed(*host().registry);
    }
    return esjs::undefined();
}

}  // namespace

void registerEcsBindings(HostState& h, esjs::Val global) {
    bindGlobal(global, "es_hasParent", js_hasParent, 1);
    bindGlobal(global, "es_getParent", js_getParent, 1);
    bindGlobal(global, "es_removeParent", js_removeParent, 1);
    bindGlobal(global, "es_hasChildren", js_hasChildren, 1);
    bindGlobal(global, "es_getChildren", js_getChildren, 1);
    bindGlobal(global, "es_getMeshSkinJoints", js_getMeshSkinJoints, 1);
    bindGlobal(global, "es_setMeshSkinJoints", js_setMeshSkinJoints, 2);
    bindGlobal(global, "es_registryLayoutEpoch", js_layoutEpoch, 0);
    bindGlobal(global, "es_transformEpochBuffer", js_transformEpochBuffer, 0);
    bindGlobal(global, "es_transformEnsureComposed", js_transformEnsureComposed, 0);
    bindGlobal(global, "es_transformSetChangeTracking", js_transformSetChangeTracking, 1);
    bindGlobal(global, "es_transformCompositionChanges", js_transformCompositionChanges, 0);
    bindGlobal(global, "es_transformTakeChanges", js_transformTakeChanges, 0);
}

}  // namespace eshost
