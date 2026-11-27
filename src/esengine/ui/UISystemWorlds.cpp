// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "UISystem.hpp"
#include "UIRenderOrderSystem.hpp"
#include "../ecs/RegistrySystems.hpp"

#include <algorithm>
#include <utility>

namespace esengine::ecs {

struct UISystem::Slot : RegistrySystem {
    UIWorldState parked;
    UIWorldState* active = nullptr;

    UIWorldState& state() { return active ? *active : parked; }
    ~Slot() override { if (active) *active = UIWorldState{}; }
    void onRegistryCleared() override { state() = UIWorldState{}; }
    void onEntityDestroyed(Entity entity) override {
        auto& world = state();
        auto& hit = world.hitResult;
        if (hit.hit_entity == entity) hit.hit_entity = INVALID_ENTITY;
        if (hit.prev_hit_entity == entity) hit.prev_hit_entity = INVALID_ENTITY;
        // Keep delayed pick indices stable for the surviving controls.
        std::replace(world.pickResults_.begin(), world.pickResults_.end(), entity, INVALID_ENTITY);
        world.contentSizes_.erase(entity);
    }

    u32 picked(u32 index) {
        const auto& results = state().pickResults_;
        return index < results.size() ? results[index].id() : INVALID_ENTITY.id();
    }
};

struct UISystem::Worlds {
    RegistrySystems<Slot> byRegistry;
    Weak<Slot> active;
    Weak<Slot> lastLayout;
    Weak<Slot> lastHit;
    Weak<Slot> lastPick;
};

UISystem::UISystem() : worlds_(makeUnique<Worlds>()) {}
UISystem::~UISystem() {
    if (auto slot = worlds_->active.lock()) slot->active = nullptr;
}

Shared<UISystem::Slot> UISystem::select(Registry& registry) {
    auto previous = worlds_->active.lock();
    if (previous && previous->entitySetId() == registry.entitySetId()) return previous;
    auto next = worlds_->byRegistry.forRegistry(registry);
    // The C++ interface exposes the working tree. A caller can rebuild it directly
    // before its first pick. Keep that tree with the registry used to build it.
    if (tree.builtFor(registry)) std::swap(tree, next->parked.tree);
    auto& view = static_cast<UIWorldState&>(*this);
    if (previous) {
        previous->parked = std::move(view);
        previous->active = nullptr;
    }
    view = std::move(next->parked);
    next->active = &view;
    worlds_->active = next;
    if (render_ && render_->laidOut && !tree.builtFor(registry)) tree.rebuild(registry);
    return next;
}

UIRenderData& UISystem::selectLayout(Registry& registry) {
    worlds_->lastLayout = select(registry);
    if (!render_) render_ = makeShared<UIRenderData>();
    return *render_;
}

void UISystem::selectHit(Registry& registry) { worlds_->lastHit = select(registry); }
void UISystem::selectPick(Registry& registry) { worlds_->lastPick = select(registry); }

void UISystem::updateRenderOrder(Registry& registry, i32 base) {
    select(registry);
    if (!render_) render_ = makeShared<UIRenderData>();
    render_->order.base = base;
    uiRenderOrderUpdate(registry, &render_->order);
}

Shared<const UIRenderData> UISystem::renderData(const Registry& registry) const {
    auto slot = worlds_->byRegistry.find(registry);
    return slot ? slot->state().render_ : nullptr;
}

const UIRenderData& UISystem::lastLayout() const {
    static const UIRenderData empty;
    auto slot = worlds_->lastLayout.lock();
    return slot && slot->state().render_ ? *slot->state().render_ : empty;
}

bool UISystem::hasLayoutFor(const Registry& registry) const {
    auto data = renderData(registry);
    return data && data->laidOut;
}

bool UISystem::isScreenDomain(const Registry& registry, u32 entity) const {
    auto data = renderData(registry);
    return data && registry.valid(Entity::fromRaw(entity)) && data->domain.contains(entity);
}

u32 UISystem::getHitEntity(const Registry& registry) const {
    auto slot = worlds_->byRegistry.find(registry);
    return slot ? slot->state().hitResult.hit_entity.id() : INVALID_ENTITY.id();
}

u32 UISystem::getHitEntity() const {
    auto slot = worlds_->lastHit.lock();
    return slot ? slot->state().hitResult.hit_entity.id() : INVALID_ENTITY.id();
}

u32 UISystem::getPrevHitEntity() const {
    auto slot = worlds_->lastHit.lock();
    return slot ? slot->state().hitResult.prev_hit_entity.id() : INVALID_ENTITY.id();
}

u32 UISystem::pickResult(const Registry& registry, u32 index) const {
    auto slot = worlds_->byRegistry.find(registry);
    return slot ? slot->picked(index) : INVALID_ENTITY.id();
}

u32 UISystem::pickResult(u32 index) const {
    auto slot = worlds_->lastPick.lock();
    return slot ? slot->picked(index) : INVALID_ENTITY.id();
}

}  // namespace esengine::ecs
