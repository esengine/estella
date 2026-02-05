/**
 * @file    SpineSystem.cpp
 * @brief   Spine animation update system
 */

// =============================================================================
// Includes
// =============================================================================

#include "SpineSystem.hpp"
#include "../core/Log.hpp"
#include "../ecs/components/SpineAnimation.hpp"
#include "../ecs/components/Transform.hpp"

namespace esengine::spine {

// =============================================================================
// SpineSystem Implementation
// =============================================================================

SpineSystem::SpineSystem(SpineResourceManager& resourceManager)
    : resource_manager_(resourceManager) {
}

SpineSystem::~SpineSystem() {
    instances_.clear();
}

void SpineSystem::update(ecs::Registry& registry, f32 deltaTime) {
    auto view = registry.view<ecs::SpineAnimation>();

    for (auto entity : view) {
        auto& comp = registry.get<ecs::SpineAnimation>(entity);

        if (comp.needsReload && !comp.skeletonPath.empty() && !comp.atlasPath.empty()) {
            loadSkeletonForEntity(entity, comp);
        }

        auto it = instances_.find(entity);
        if (it != instances_.end()) {
            syncComponentToInstance(entity, comp);
            updateAnimation(entity, comp, deltaTime);
        }
    }

    std::vector<Entity> toRemove;
    for (auto& [entity, instance] : instances_) {
        if (!registry.valid(entity) || !registry.has<ecs::SpineAnimation>(entity)) {
            toRemove.push_back(entity);
        }
    }
    for (Entity e : toRemove) {
        instances_.erase(e);
    }
}

void SpineSystem::loadSkeletonForEntity(Entity entity, ecs::SpineAnimation& comp) {
    auto handle = resource_manager_.load(comp.skeletonPath, comp.atlasPath, comp.skeletonScale);
    if (!handle.isValid()) {
        ES_LOG_ERROR("Failed to load spine skeleton for entity {}", entity);
        comp.needsReload = false;
        return;
    }

    auto* data = resource_manager_.get(handle);
    if (!data || !data->skeletonData || !data->stateData) {
        ES_LOG_ERROR("Invalid spine data for entity {}", entity);
        comp.needsReload = false;
        return;
    }

    auto instance = SpineInstance{};
    instance.skeleton = makeUnique<::spine::Skeleton>(data->skeletonData.get());
    instance.state = makeUnique<::spine::AnimationState>(data->stateData.get());

    if (!comp.skin.empty()) {
        instance.skeleton->setSkin(comp.skin.c_str());
        instance.skeleton->setSlotsToSetupPose();
    }

    if (!comp.animation.empty()) {
        instance.state->setAnimation(0, comp.animation.c_str(), comp.loop);
    }

    instance.skeleton->setScaleX(comp.flipX ? -1.0f : 1.0f);
    instance.skeleton->setScaleY(comp.flipY ? -1.0f : 1.0f);

    comp.skeletonData = handle;
    comp.needsReload = false;

    instances_[entity] = std::move(instance);
}

void SpineSystem::updateAnimation(Entity entity, ecs::SpineAnimation& comp, f32 deltaTime) {
    auto it = instances_.find(entity);
    if (it == instances_.end()) return;

    auto& instance = it->second;
    auto* skeleton = instance.skeleton.get();
    auto* state = instance.state.get();

    if (!skeleton || !state) return;

    if (comp.playing) {
        state->update(deltaTime * comp.timeScale);
    }

    state->apply(*skeleton);
    skeleton->update(deltaTime);
    skeleton->updateWorldTransform(::spine::Physics_Update);
}

void SpineSystem::syncComponentToInstance(Entity entity, ecs::SpineAnimation& comp) {
    auto it = instances_.find(entity);
    if (it == instances_.end()) return;

    auto& instance = it->second;
    auto* skeleton = instance.skeleton.get();

    if (!skeleton) return;

    skeleton->setScaleX(comp.flipX ? -1.0f : 1.0f);
    skeleton->setScaleY(comp.flipY ? -1.0f : 1.0f);

    auto& color = skeleton->getColor();
    color.r = comp.color.r;
    color.g = comp.color.g;
    color.b = comp.color.b;
    color.a = comp.color.a;
}

void SpineSystem::reloadAssets(ecs::Registry& registry) {
    instances_.clear();
    auto view = registry.view<ecs::SpineAnimation>();
    for (auto entity : view) {
        auto& comp = registry.get<ecs::SpineAnimation>(entity);
        comp.needsReload = true;
    }
}

SpineInstance* SpineSystem::getInstance(Entity entity) {
    auto it = instances_.find(entity);
    return it != instances_.end() ? &it->second : nullptr;
}

const SpineInstance* SpineSystem::getInstance(Entity entity) const {
    auto it = instances_.find(entity);
    return it != instances_.end() ? &it->second : nullptr;
}

bool SpineSystem::playAnimation(Entity entity, const std::string& animation,
                                bool loop, i32 track) {
    auto it = instances_.find(entity);
    if (it == instances_.end() || !it->second.state) return false;

    auto* entry = it->second.state->setAnimation(
        static_cast<size_t>(track), animation.c_str(), loop);
    return entry != nullptr;
}

bool SpineSystem::addAnimation(Entity entity, const std::string& animation,
                               bool loop, f32 delay, i32 track) {
    auto it = instances_.find(entity);
    if (it == instances_.end() || !it->second.state) return false;

    auto* entry = it->second.state->addAnimation(
        static_cast<size_t>(track), animation.c_str(), loop, delay);
    return entry != nullptr;
}

bool SpineSystem::setSkin(Entity entity, const std::string& skinName) {
    auto it = instances_.find(entity);
    if (it == instances_.end() || !it->second.skeleton) return false;

    it->second.skeleton->setSkin(skinName.c_str());
    it->second.skeleton->setSlotsToSetupPose();
    return true;
}

bool SpineSystem::getBonePosition(Entity entity, const std::string& boneName,
                                   f32& outX, f32& outY) const {
    auto it = instances_.find(entity);
    if (it == instances_.end() || !it->second.skeleton) return false;

    auto* bone = it->second.skeleton->findBone(boneName.c_str());
    if (!bone) return false;

    outX = bone->getWorldX();
    outY = bone->getWorldY();
    return true;
}

bool SpineSystem::getBoneRotation(Entity entity, const std::string& boneName,
                                   f32& outRotation) const {
    auto it = instances_.find(entity);
    if (it == instances_.end() || !it->second.skeleton) return false;

    auto* bone = it->second.skeleton->findBone(boneName.c_str());
    if (!bone) return false;

    outRotation = bone->getWorldRotationX();
    return true;
}

bool SpineSystem::getSkeletonBounds(Entity entity, f32& outX, f32& outY,
                                     f32& outWidth, f32& outHeight) const {
    auto it = instances_.find(entity);
    if (it == instances_.end() || !it->second.skeleton) {
        return false;
    }

    ::spine::Vector<f32> vertices;
    it->second.skeleton->getBounds(outX, outY, outWidth, outHeight, vertices);
    return true;
}

}  // namespace esengine::spine
