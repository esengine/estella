/**
 * @file    SpineSystem.hpp
 * @brief   Spine animation update system
 * @details Updates Spine skeletons and animation states for all entities.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

#include "../core/Types.hpp"
#include "../ecs/Registry.hpp"
#include "../ecs/components/SpineAnimation.hpp"
#include "SpineResourceManager.hpp"

#include <spine/spine.h>

#include <unordered_map>

namespace esengine::spine {

// =============================================================================
// SpineInstance
// =============================================================================

/**
 * @brief Per-entity Spine runtime instance
 *
 * @details Contains the Skeleton and AnimationState objects for a single
 *          entity. These are created from the shared SpineSkeletonData.
 */
struct SpineInstance {
    Unique<::spine::Skeleton> skeleton;
    Unique<::spine::AnimationState> state;

    SpineInstance() = default;
    ~SpineInstance() = default;

    SpineInstance(const SpineInstance&) = delete;
    SpineInstance& operator=(const SpineInstance&) = delete;
    SpineInstance(SpineInstance&&) = default;
    SpineInstance& operator=(SpineInstance&&) = default;
};

// =============================================================================
// SpineSystem
// =============================================================================

/**
 * @brief System for updating Spine animations
 *
 * @details Manages the lifecycle of Spine instances per entity and updates
 *          animation states each frame. Creates/destroys instances as needed
 *          when SpineAnimation components are added/removed.
 *
 * @code
 * SpineSystem spineSystem(spineResourceManager);
 *
 * // In update loop
 * spineSystem.update(registry, deltaTime);
 * @endcode
 */
class SpineSystem {
public:
    explicit SpineSystem(SpineResourceManager& resourceManager);
    ~SpineSystem();

    SpineSystem(const SpineSystem&) = delete;
    SpineSystem& operator=(const SpineSystem&) = delete;

    /**
     * @brief Updates all Spine animations
     * @param registry ECS registry containing SpineAnimation components
     * @param deltaTime Time elapsed since last update (seconds)
     */
    void update(ecs::Registry& registry, f32 deltaTime);

    /**
     * @brief Forces reload of all skeleton assets
     * @param registry ECS registry to update
     */
    void reloadAssets(ecs::Registry& registry);

    /**
     * @brief Gets the Spine instance for an entity
     * @param entity Entity to query
     * @return Pointer to SpineInstance, or nullptr if not found
     */
    SpineInstance* getInstance(Entity entity);

    /**
     * @brief Gets the Spine instance for an entity (const)
     * @param entity Entity to query
     * @return Const pointer to SpineInstance, or nullptr if not found
     */
    const SpineInstance* getInstance(Entity entity) const;

    /**
     * @brief Plays an animation on an entity
     * @param entity Target entity
     * @param animation Animation name
     * @param loop Whether to loop
     * @param track Animation track (default 0)
     * @return True if animation was set
     */
    bool playAnimation(Entity entity, const std::string& animation,
                       bool loop = true, i32 track = 0);

    /**
     * @brief Adds an animation to the queue
     * @param entity Target entity
     * @param animation Animation name
     * @param loop Whether to loop
     * @param delay Delay before starting
     * @param track Animation track (default 0)
     * @return True if animation was queued
     */
    bool addAnimation(Entity entity, const std::string& animation,
                      bool loop = true, f32 delay = 0.0f, i32 track = 0);

    /**
     * @brief Sets skin on an entity
     * @param entity Target entity
     * @param skinName Skin name
     * @return True if skin was set
     */
    bool setSkin(Entity entity, const std::string& skinName);

    /**
     * @brief Gets bone world position
     * @param entity Target entity
     * @param boneName Bone name
     * @param outX Output X position
     * @param outY Output Y position
     * @return True if bone was found
     */
    bool getBonePosition(Entity entity, const std::string& boneName,
                         f32& outX, f32& outY) const;

    /**
     * @brief Gets bone world rotation
     * @param entity Target entity
     * @param boneName Bone name
     * @param outRotation Output rotation in degrees
     * @return True if bone was found
     */
    bool getBoneRotation(Entity entity, const std::string& boneName,
                         f32& outRotation) const;

    /**
     * @brief Gets skeleton bounds
     * @param entity Target entity
     * @param outX Output X offset
     * @param outY Output Y offset
     * @param outWidth Output width
     * @param outHeight Output height
     * @return True if bounds were retrieved
     */
    bool getSkeletonBounds(Entity entity, f32& outX, f32& outY,
                           f32& outWidth, f32& outHeight) const;

private:
    void loadSkeletonForEntity(Entity entity, ecs::SpineAnimation& comp);
    void updateAnimation(Entity entity, ecs::SpineAnimation& comp, f32 deltaTime);
    void syncComponentToInstance(Entity entity, ecs::SpineAnimation& comp);

    SpineResourceManager& resource_manager_;
    std::unordered_map<Entity, SpineInstance> instances_;
};

}  // namespace esengine::spine
