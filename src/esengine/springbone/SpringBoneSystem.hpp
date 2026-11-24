// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    SpringBoneSystem.hpp
 * @brief   Per-App secondary motion: runs every SpringBone chain after the animation has posed the
 *          skeleton and before the frame is drawn.
 * @details The runtime state (each chain's simulated points) lives HERE, keyed by the chain's root
 *          entity, not on the component — the split TrailSystem and ParticleSystem make, so the
 *          component stays configuration and serialization never sees the transient state.
 *
 *          Per chain, per frame: read the pose the animation gave the bones (world transforms
 *          composed from their local ones), step the simulation toward it, then write back, for each
 *          bone, the local rotation that aims it at where its child has got to. Positions of bones are
 *          never written, so a bone cannot leave its parent; only rotations change, which is what
 *          skinning needs.
 */
#pragma once

#include "../core/Types.hpp"
#include "../math/Math.hpp"
#include "../ecs/RegistrySystems.hpp"
#include "../ecs/TransformSystem.hpp"
#include "SpringBoneSolver.hpp"

#include <unordered_map>
#include <vector>

namespace esengine::springbone {

class SpringBoneSystem : public ecs::RegistrySystem {
public:
    SpringBoneSystem() = default;

    /** @brief Advance every enabled chain by `dt` seconds. Composes world transforms first if the animation moved any. */
    void update(ecs::Registry& registry, ecs::TransformSystem* transforms, f32 dt);

    /**
     * @brief Give a chain's bones back as the animation had them and forget its state: what stops a preview in the editor, where nothing animates the bones
     *        and a chain left as the simulation last turned it would stay that way.
     */
    void release(ecs::Registry& registry, Entity root);

    /** @brief Forget a chain's state: it starts again from the animated pose on its next frame (a teleport, a respawn). */
    void reset(Entity root);

    /** @brief How many chains the last update simulated. */
    u32 simulated() const { return simulated_; }

    /** @brief The simulated world positions of a chain, root first, in the order its bones were found (tips last); null if it has no state. */
    const std::vector<Particle>* chain(Entity root) const;

    /**
     * @brief A chain's particles as flat floats for the editor to draw: seven a particle, the simulated position, the position the animation gives, then
     *        the index of its parent (-1 for the root). Empty when the chain has no state.
     */
    void snapshot(Entity root, std::vector<f32>& out) const;

    u32 captureSnapshot(Entity root) {
        snapshot(root, snapshot_);
        return static_cast<u32>(snapshot_.size() / 7);
    }
    const std::vector<f32>& snapshotData() const { return snapshot_; }

private:
    /** @brief One bone (or a virtual tip) of a chain, beside its particle. */
    struct Node {
        Entity entity = INVALID_ENTITY;   ///< INVALID_ENTITY for a virtual tip.
        i32 firstChild = -1;              ///< The child this bone aims at; -1 for a tip.
    };

    /** @brief What a bone's pose was this frame, as the animation left it. */
    struct Pose {
        glm::vec3 animPos{0.0f};   ///< World position, rotation and scale the animation gives the bone.
        glm::quat animRot{1.0f, 0.0f, 0.0f, 0.0f};
        glm::vec3 animScale{1.0f};
        glm::vec3 localPosition{0.0f};
        glm::quat localRotation{1.0f, 0.0f, 0.0f, 0.0f};
    };

    struct State {
        std::vector<Entity> entities;     ///< The bones in the order they were found, to notice a hierarchy that changed.
        std::vector<Particle> particles;
        std::vector<Node> nodes;
        glm::vec3 rootPosition{0.0f};
        bool primed = false;
        f32 clock = 0.0f;   ///< Seconds this chain has been simulated, which the wind's gusts are a function of.
        /// The animation's local rotation of each bone, the one this system last wrote there, and whether it has written one. A bone
        /// still holding what was written was not animated this frame, so the animation's own value is the one kept from before.
        std::vector<glm::quat> animated;
        std::vector<glm::quat> written;
        std::vector<bool> hasWritten;
    };

    std::unordered_map<Entity, State> states_;
    // Scratch for one chain's frame, kept so a frame allocates nothing once the chains exist.
    std::vector<Collider> colliders_;
    std::vector<Entity> found_;
    std::vector<Entity> stack_;
    std::vector<Pose> poses_;
    std::vector<glm::vec3> tipOffsets_;
    std::vector<glm::vec3> fkPosition_;
    std::vector<glm::quat> fkRotation_;
    std::vector<i32> childCount_;
    std::vector<i32> parentOf_;
    u32 simulated_ = 0;
    std::vector<f32> snapshot_;
    void onEntityDestroyed(Entity entity) override { states_.erase(entity); }

    void restoreBones(ecs::Registry& registry, State& state);
    void collectBones(ecs::Registry& registry, Entity root, std::vector<Entity>& out);
    bool gatherColliders(ecs::Registry& registry, const std::vector<Entity>& entities, std::vector<Collider>& out);
};

}  // namespace esengine::springbone
