// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "SpringBoneSystem.hpp"

#include "../ecs/components/Hierarchy.hpp"
#include "../ecs/components/SpringBone.hpp"
#include "../ecs/components/Transform.hpp"

#include <algorithm>
#include <cmath>

namespace esengine::springbone {

void SpringBoneSystem::collectBones(ecs::Registry& registry, Entity root, std::vector<Entity>& out) {
    out.clear();
    stack_.clear();
    stack_.push_back(root);
    // Preorder: a bone comes before everything below it, which is the order the solver wants.
    while (!stack_.empty()) {
        const Entity e = stack_.back();
        stack_.pop_back();
        out.push_back(e);
        if (const auto* children = registry.tryGet<ecs::Children>(e)) {
            for (auto it = children->entities.rbegin(); it != children->entities.rend(); ++it) {
                if (registry.valid(*it) && registry.has<ecs::Transform>(*it)) stack_.push_back(*it);
            }
        }
    }
}

bool SpringBoneSystem::gatherColliders(ecs::Registry& registry, const std::vector<Entity>& entities, std::vector<Collider>& out) {
    out.clear();
    for (const Entity e : entities) {
        if (!registry.valid(e)) continue;
        const auto* shape = registry.tryGet<ecs::SpringBoneCollider>(e);
        auto* t = registry.tryGet<ecs::Transform>(e);
        if (!shape || !t) continue;
        t->ensureDecomposed();
        const glm::vec3 centre = t->worldPosition + t->worldRotation * (shape->offset * t->worldScale);
        const f32 scale = std::max({std::abs(t->worldScale.x), std::abs(t->worldScale.y), std::abs(t->worldScale.z)});
        Collider c;
        c.radius = shape->radius * scale;
        if (shape->shape == ecs::SpringBoneShape::Capsule) {
            const glm::vec3 axis = t->worldRotation * glm::vec3(0.0f, 1.0f, 0.0f);
            const f32 half = shape->height * std::abs(t->worldScale.y) * 0.5f;
            c.a = centre - axis * half;
            c.b = centre + axis * half;
        } else {
            c.a = c.b = centre;
        }
        out.push_back(c);
    }
    return !out.empty();
}

void SpringBoneSystem::restoreBones(ecs::Registry& registry, State& state) {
    for (size_t i = 1; i < state.entities.size() && i < state.animated.size(); ++i) {
        if (!registry.valid(state.entities[i])) continue;
        auto* t = registry.tryGet<ecs::Transform>(state.entities[i]);
        if (t && state.hasWritten[i] && t->rotation == state.written[i]) {
            t->rotation = state.animated[i];
            registry.markChanged<ecs::Transform>(state.entities[i]);
            ecs::invalidateTransformComposition();
        }
    }
}

void SpringBoneSystem::release(ecs::Registry& registry, Entity root) {
    const auto it = states_.find(root);
    if (it == states_.end()) return;
    restoreBones(registry, it->second);
    states_.erase(it);
}

void SpringBoneSystem::reset(Entity root) {
    auto it = states_.find(root);
    if (it != states_.end()) it->second.primed = false;
}

void SpringBoneSystem::snapshot(Entity root, std::vector<f32>& out) const {
    out.clear();
    const auto it = states_.find(root);
    if (it == states_.end()) return;
    for (const Particle& p : it->second.particles) {
        out.insert(out.end(), {p.position.x, p.position.y, p.position.z, p.target.x, p.target.y, p.target.z, static_cast<f32>(p.parent)});
    }
}

const std::vector<Particle>* SpringBoneSystem::chain(Entity root) const {
    const auto it = states_.find(root);
    return it == states_.end() ? nullptr : &it->second.particles;
}

void SpringBoneSystem::update(ecs::Registry& registry, ecs::TransformSystem* transforms, f32 dt) {
    if (!destroyConn_.isConnected()) {
        destroyConn_ = registry.onDestroy([this](Entity entity) {
            states_.erase(entity);
        });
    }
    simulated_ = 0;

    // A chain whose component is gone, or switched off, gives its bones back to the animation as the animation had them.
    for (auto it = states_.begin(); it != states_.end();) {
        const Entity root = it->first;
        const auto* sb = registry.valid(root) ? registry.tryGet<ecs::SpringBone>(root) : nullptr;
        if (sb && sb->enabled && sb->weight > 0.0f) { ++it; continue; }
        restoreBones(registry, it->second);
        it = states_.erase(it);
    }

    auto view = registry.activeView<ecs::Transform, ecs::SpringBone>();
    bool any = false;
    for (auto entity : view) { (void)entity; any = true; break; }
    if (!any) return;

    // The animation has written local rotations; the world transforms this reads are composed from them.
    if (transforms) transforms->ensureComposed(registry);

    for (auto entity : view) {
        const auto& sb = view.get<ecs::SpringBone>(entity);
        if (!sb.enabled || sb.weight <= 0.0f) continue;

        collectBones(registry, entity, found_);
        const size_t bones = found_.size();
        if (bones < 2 && !(bones == 1 && sb.endLength > 0.0f)) continue;

        State& st = states_[entity];

        // The bones this chain has, and which are leaves (those get a virtual tip when the chain has an end length).
        size_t leaves = 0;
        childCount_.assign(bones, 0);
        parentOf_.assign(bones, -1);
        auto& childCount = childCount_;
        auto& parentOf = parentOf_;
        for (size_t i = 1; i < bones; ++i) {
            const auto* p = registry.tryGet<ecs::Parent>(found_[i]);
            i32 parent = 0;
            if (p) {
                for (size_t j = i; j-- > 0;) if (found_[j] == p->entity) { parent = static_cast<i32>(j); break; }
            }
            parentOf[i] = parent;
            childCount[static_cast<size_t>(parent)]++;
        }
        for (size_t i = 0; i < bones; ++i) if (childCount[i] == 0) ++leaves;
        const size_t tips = sb.endLength > 0.0f ? leaves : 0;

        if (st.entities != found_ || st.particles.size() != bones + tips) {
            st.entities = found_;
            st.particles.assign(bones + tips, Particle{});
            st.nodes.assign(bones + tips, Node{});
            for (size_t i = 0; i < bones; ++i) {
                st.nodes[i].entity = found_[i];
                st.particles[i].parent = parentOf[i];
            }
            for (size_t i = 1; i < bones; ++i) {
                Node& parent = st.nodes[static_cast<size_t>(parentOf[i])];
                if (parent.firstChild < 0) parent.firstChild = static_cast<i32>(i);
            }
            size_t next = bones;
            if (tips > 0) {
                for (size_t i = 0; i < bones; ++i) {
                    if (childCount[i] != 0) continue;
                    st.nodes[i].firstChild = static_cast<i32>(next);
                    st.particles[next].parent = static_cast<i32>(i);
                    ++next;
                }
            }
            st.primed = false;
            st.animated.assign(bones, glm::quat(1.0f, 0.0f, 0.0f, 0.0f));
            st.written.assign(bones, glm::quat(1.0f, 0.0f, 0.0f, 0.0f));
            st.hasWritten.assign(bones, false);
        }

        // Read the pose the animation gave: a bone whose rotation is still the one this system wrote was not animated this frame,
        // so the animation's own value is the one kept from before (otherwise the chain would spring toward its own last result).
        poses_.resize(bones);
        tipOffsets_.assign(bones + tips, glm::vec3(0.0f));
        for (size_t i = 0; i < bones; ++i) {
            auto& t = registry.get<ecs::Transform>(found_[i]);
            t.ensureDecomposed();
            Pose& pose = poses_[i];
            pose.animScale = t.worldScale;
            pose.localPosition = t.position;
            if (i > 0) {
                if (st.hasWritten[i] && t.rotation == st.written[i]) {
                    pose.localRotation = st.animated[i];
                } else {
                    pose.localRotation = t.rotation;
                    st.animated[i] = t.rotation;
                    st.hasWritten[i] = false;
                }
                // The pose the animation gave, worked out down the chain from the root with the animation's own rotations: the composed world
                // transforms of the bones below the root include what this system wrote last frame, and a target taken from them would be the chain's own result.
                const Pose& parent = poses_[static_cast<size_t>(parentOf[i])];
                pose.animRot = parent.animRot * pose.localRotation;
                pose.animPos = parent.animPos + parent.animRot * (pose.localPosition * parent.animScale);
            } else {
                pose.localRotation = t.rotation;
                pose.animPos = t.worldPosition;
                pose.animRot = t.worldRotation;
            }
        }

        // Targets: where the animation puts each bone, and the distance each keeps from its parent.
        f32 totalRest = 0.0f;
        for (size_t i = 0; i < bones; ++i) {
            Particle& p = st.particles[i];
            p.target = poses_[i].animPos;
            if (p.parent >= 0) {
                p.restLength = glm::length(p.target - poses_[static_cast<size_t>(p.parent)].animPos);
                totalRest += p.restLength;
            }
        }
        for (size_t i = 0; i < bones; ++i) {
            const i32 tip = st.nodes[i].firstChild;
            if (tip < static_cast<i32>(bones) || tip < 0) continue;
            glm::vec3 direction = poses_[i].animRot * glm::vec3(0.0f, 1.0f, 0.0f);
            if (parentOf[i] >= 0) {
                const glm::vec3 along = poses_[i].animPos - poses_[static_cast<size_t>(parentOf[i])].animPos;
                if (glm::dot(along, along) > 1e-12f) direction = glm::normalize(along);
            }
            Particle& p = st.particles[static_cast<size_t>(tip)];
            p.target = poses_[i].animPos + direction * sb.endLength;
            p.restLength = sb.endLength;
            totalRest += sb.endLength;
            // The tip as the bone sees it in its own animated frame, so forward kinematics with the animated rotation lands on the target.
            tipOffsets_[static_cast<size_t>(tip)] = glm::inverse(poses_[i].animRot) * (p.target - poses_[i].animPos);
        }

        // A jump of the root, or a long stall, is not motion the hair should trail through: put it back at its pose.
        const glm::vec3 rootPosition = poses_[0].animPos;
        const bool teleported = st.primed && glm::length(rootPosition - st.rootPosition) > std::max(totalRest, 1e-3f) * 4.0f;
        if (!st.primed || teleported || dt > 0.5f) {
            springbone::reset(st.particles);
            st.primed = true;
        }
        st.rootPosition = rootPosition;

        gatherColliders(registry, sb.colliders, colliders_);
        StepParams params;
        params.stiffness = sb.stiffness;
        params.drag = sb.drag;
        params.gravity = sb.gravity;
        params.radius = sb.radius;
        params.wind = sb.wind;
        params.windGust = sb.windGust;
        params.windFrequency = sb.windFrequency;
        params.time = st.clock;
        step(st.particles, params, colliders_, dt);
        st.clock += std::min(dt, springbone::kMaxStep);
        ++simulated_;

        // Write back: each bone is turned to aim at where its child's simulated point is, going down the chain so a bone's own position
        // already follows its turned parent.
        fkPosition_.resize(bones);
        fkRotation_.resize(bones);
        const f32 weight = std::clamp(sb.weight, 0.0f, 1.0f);
        bool wrote = false;
        for (size_t i = 0; i < bones; ++i) {
            glm::quat unaimed;
            if (i == 0) {
                fkPosition_[0] = poses_[0].animPos;
                fkRotation_[0] = poses_[0].animRot;
                unaimed = fkRotation_[0];
            } else {
                const size_t b = static_cast<size_t>(parentOf[i]);
                fkPosition_[i] = fkPosition_[b] + fkRotation_[b] * (poses_[i].localPosition * poses_[b].animScale);
                unaimed = fkRotation_[b] * poses_[i].localRotation;
                fkRotation_[i] = unaimed;
            }
            const i32 c = st.nodes[i].firstChild;
            if (i == 0 || c < 0) continue;
            const glm::vec3 offset = static_cast<size_t>(c) < bones
                ? poses_[static_cast<size_t>(c)].localPosition * poses_[i].animScale
                : tipOffsets_[static_cast<size_t>(c)];
            const glm::vec3 current = fkRotation_[i] * offset;
            const glm::vec3 wanted = st.particles[static_cast<size_t>(c)].position - fkPosition_[i];
            glm::quat aimed = shortestArc(current, wanted) * fkRotation_[i];
            if (weight < 1.0f) aimed = glm::slerp(unaimed, aimed, weight);
            fkRotation_[i] = aimed;

            const size_t b = static_cast<size_t>(parentOf[i]);
            const glm::quat local = glm::normalize(glm::inverse(fkRotation_[b]) * aimed);
            auto& t = registry.get<ecs::Transform>(found_[i]);
            if (t.rotation != local) {
                t.rotation = local;
                registry.markChanged<ecs::Transform>(found_[i]);
            }
            st.written[i] = local;
            st.hasWritten[i] = true;
            wrote = true;
        }
        if (wrote) ecs::invalidateTransformComposition();
    }
}

}  // namespace esengine::springbone
