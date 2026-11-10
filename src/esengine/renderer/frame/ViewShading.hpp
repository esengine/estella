// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ViewShading.hpp
 * @brief   How a view shades the meshes it draws: as authored, clay, flat albedo, wireframe, or one part of the light.
 */
#pragma once

#include "../../core/Types.hpp"

#include <unordered_map>

namespace esengine {

/**
 * @brief What a mesh is drawn WITH in a view, whatever its own material says.
 *
 * @details A debugging question, not a style: shape is asked of clay, texture of albedo.
 *          View state, so a camera preview drawn in the same frame keeps the authored
 *          look. Only the camera collect reads it; a shadow map draws depth either way.
 */
enum class ShadingMode : u8 {
    /// Each mesh as authored: its material, its textures, its light.
    Shaded = 0,
    /// One neutral matte surface, lit: form and silhouette without anyone's colours.
    Clay = 1,
    /// Base colour and texture with no light and no material: what was painted.
    Albedo = 2,
    /// A dark surface with every triangle edge drawn on it, hidden edges hidden.
    Wireframe = 3,
    /// Clay lit by the lights alone: no ambient, environment, reflection, probe or bake. Unreal's lighting
    /// components with Indirect off; with IndirectLighting it splits what Clay shows into the two halves.
    DirectLighting = 4,
    /// Clay lit by what is NOT a light: the ambient, the environment and sky, reflections, probe volumes and
    /// bakes. What fills a shadow, on its own.
    IndirectLighting = 5,
};

inline constexpr u8 kShadingModeCount = 6;

/// Whether a mode draws meshes as clay (the lit neutral surface).
inline bool shadesAsClay(ShadingMode mode) {
    return mode == ShadingMode::Clay || mode == ShadingMode::DirectLighting || mode == ShadingMode::IndirectLighting;
}

/**
 * @brief The one skinned entity a view colours by a joint's weights, and which joint.
 * @details Not a ShadingMode: it picks out ONE draw among many, and everything else keeps the
 *          view's shading. A view with none stands for "the weights of nothing".
 */
struct WeightTarget {
    Entity entity = INVALID_ENTITY;
    u32 joint = 0;
    bool active() const { return entity != INVALID_ENTITY; }
};

/**
 * @brief The mode each view asked for. A view that never asked is Shaded, which is
 *        why a frame with nothing set costs a hash lookup per collect and nothing else.
 */
class ViewShading {
public:
    void set(u32 view, ShadingMode mode) {
        if (mode == ShadingMode::Shaded) modes_.erase(view);
        else modes_[view] = mode;
    }

    ShadingMode get(u32 view) const {
        const auto it = modes_.find(view);
        return it == modes_.end() ? ShadingMode::Shaded : it->second;
    }

    /// Views holding a non-default mode, for a criterion that checks nothing leaked.
    usize count() const { return modes_.size() + weights_.size(); }

    /// Colour @p entity in @p view by how much @p joint moves each vertex; an invalid entity stops.
    void setWeights(u32 view, Entity entity, u32 joint) {
        if (entity == INVALID_ENTITY) weights_.erase(view);
        else weights_[view] = {entity, joint};
    }

    WeightTarget weights(u32 view) const {
        const auto it = weights_.find(view);
        return it == weights_.end() ? WeightTarget{} : it->second;
    }

private:
    std::unordered_map<u32, ShadingMode> modes_;
    std::unordered_map<u32, WeightTarget> weights_;
};

}  // namespace esengine
