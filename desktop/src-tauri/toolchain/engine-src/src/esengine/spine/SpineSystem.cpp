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

    if (destroy_callback_id_ == 0) {
        destroy_callback_id_ = registry.onDestroy([this](Entity entity) {
            instances_.erase(entity);
        });
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

    instance.state->setListener(
        [this, entity](::spine::AnimationState*, ::spine::EventType type,
                       ::spine::TrackEntry* entry, ::spine::Event* event) {
            recordEvent(entity, type, entry, event);
        });

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
        if (comp.skeletonData.isValid()) {
            resource_manager_.release(comp.skeletonData);
            comp.skeletonData = {};
        }
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

std::vector<std::string> SpineSystem::getAnimationNames(Entity entity) const {
    std::vector<std::string> result;
    auto it = instances_.find(entity);
    if (it == instances_.end() || !it->second.skeleton) return result;

    auto* data = it->second.skeleton->getData();
    auto& animations = data->getAnimations();
    result.reserve(animations.size());
    for (size_t i = 0; i < animations.size(); ++i) {
        result.emplace_back(animations[i]->getName().buffer());
    }
    return result;
}

std::vector<std::string> SpineSystem::getSkinNames(Entity entity) const {
    std::vector<std::string> result;
    auto it = instances_.find(entity);
    if (it == instances_.end() || !it->second.skeleton) return result;

    auto* data = it->second.skeleton->getData();
    auto& skins = data->getSkins();
    result.reserve(skins.size());
    for (size_t i = 0; i < skins.size(); ++i) {
        result.emplace_back(skins[i]->getName().buffer());
    }
    return result;
}

// =============================================================================
// Constraints
// =============================================================================

SpineSystem::ConstraintNames SpineSystem::listConstraints(Entity entity) const {
    ConstraintNames result;
    auto it = instances_.find(entity);
    if (it == instances_.end() || !it->second.skeleton) return result;

    auto* data = it->second.skeleton->getData();

    auto& ikList = data->getIkConstraints();
    for (size_t i = 0; i < ikList.size(); ++i) {
        result.ik.emplace_back(ikList[i]->getName().buffer());
    }
    auto& transformList = data->getTransformConstraints();
    for (size_t i = 0; i < transformList.size(); ++i) {
        result.transform.emplace_back(transformList[i]->getName().buffer());
    }
    auto& pathList = data->getPathConstraints();
    for (size_t i = 0; i < pathList.size(); ++i) {
        result.path.emplace_back(pathList[i]->getName().buffer());
    }
    return result;
}

bool SpineSystem::getTransformConstraintMix(Entity entity, const std::string& name,
    f32& outRotate, f32& outX, f32& outY,
    f32& outScaleX, f32& outScaleY, f32& outShearY) const {
    auto it = instances_.find(entity);
    if (it == instances_.end() || !it->second.skeleton) return false;

    auto* constraint = it->second.skeleton->findTransformConstraint(name.c_str());
    if (!constraint) return false;

    outRotate = constraint->getMixRotate();
    outX = constraint->getMixX();
    outY = constraint->getMixY();
    outScaleX = constraint->getMixScaleX();
    outScaleY = constraint->getMixScaleY();
    outShearY = constraint->getMixShearY();
    return true;
}

bool SpineSystem::setTransformConstraintMix(Entity entity, const std::string& name,
    f32 rotate, f32 x, f32 y, f32 scaleX, f32 scaleY, f32 shearY) {
    auto it = instances_.find(entity);
    if (it == instances_.end() || !it->second.skeleton) return false;

    auto* constraint = it->second.skeleton->findTransformConstraint(name.c_str());
    if (!constraint) return false;

    constraint->setMixRotate(rotate);
    constraint->setMixX(x);
    constraint->setMixY(y);
    constraint->setMixScaleX(scaleX);
    constraint->setMixScaleY(scaleY);
    constraint->setMixShearY(shearY);
    return true;
}

bool SpineSystem::getPathConstraintMix(Entity entity, const std::string& name,
    f32& outPosition, f32& outSpacing,
    f32& outRotate, f32& outX, f32& outY) const {
    auto it = instances_.find(entity);
    if (it == instances_.end() || !it->second.skeleton) return false;

    auto* constraint = it->second.skeleton->findPathConstraint(name.c_str());
    if (!constraint) return false;

    outPosition = constraint->getPosition();
    outSpacing = constraint->getSpacing();
    outRotate = constraint->getMixRotate();
    outX = constraint->getMixX();
    outY = constraint->getMixY();
    return true;
}

bool SpineSystem::setPathConstraintMix(Entity entity, const std::string& name,
    f32 position, f32 spacing, f32 rotate, f32 x, f32 y) {
    auto it = instances_.find(entity);
    if (it == instances_.end() || !it->second.skeleton) return false;

    auto* constraint = it->second.skeleton->findPathConstraint(name.c_str());
    if (!constraint) return false;

    constraint->setPosition(position);
    constraint->setSpacing(spacing);
    constraint->setMixRotate(rotate);
    constraint->setMixX(x);
    constraint->setMixY(y);
    return true;
}

// =============================================================================
// Events
// =============================================================================

void SpineSystem::recordEvent(Entity entity, ::spine::EventType type,
                              ::spine::TrackEntry* entry, ::spine::Event* event) {
    if (type == ::spine::EventType_Dispose) return;
    if (native_event_count_ >= MAX_NATIVE_EVENTS) return;

    auto idx = native_event_count_;
    auto base = idx * EVENT_STRIDE;

    native_event_buffer_[base + 0] = static_cast<f32>(type);
    native_event_buffer_[base + 1] = entry ? static_cast<f32>(entry->getTrackIndex()) : 0.0f;
    native_event_buffer_[base + 2] = (type == ::spine::EventType_Event && event) ? event->getFloatValue() : 0.0f;
    native_event_buffer_[base + 3] = (type == ::spine::EventType_Event && event) ? static_cast<f32>(event->getIntValue()) : 0.0f;

    auto& record = native_event_records_[idx];
    record.entity = entity;
    record.animationName = (entry && entry->getAnimation())
        ? entry->getAnimation()->getName().buffer() : "";
    if (type == ::spine::EventType_Event && event) {
        record.eventName = event->getData().getName().buffer();
        record.stringValue = event->getStringValue().buffer();
    } else {
        record.eventName.clear();
        record.stringValue.clear();
    }

    ++native_event_count_;
}

void SpineSystem::clearEvents() {
    native_event_count_ = 0;
}

}  // namespace esengine::spine
