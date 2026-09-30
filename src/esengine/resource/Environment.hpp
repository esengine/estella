// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Environment.hpp
 * @brief   A baked environment: what a surface sees when no light faces it.
 */
#pragma once

#include "../core/Types.hpp"
#include "../math/Math.hpp"
#include "./Handle.hpp"

#include <array>

namespace esengine {

/**
 * @brief The two halves of an image-based light, as the importer baked them.
 *
 * @details The diffuse half is nine spherical-harmonic coefficients, already
 *          convolved and divided by pi, so evaluating them at a normal gives the
 *          value that multiplies albedo — where the flat ambient term sits. The
 *          specular half is an octahedral atlas, mip i for roughness i/(mipCount-1).
 */
class Environment {
public:
    std::array<glm::vec3, 9> irradiance{};

    resource::TextureHandle specular;

    /** @brief The panorama the sky is drawn from: equirectangular, row 0 up, RGBM
     *  under maxRange. Invalid draws the sky from the atlas' mip 0 instead. */
    resource::TextureHandle sky;

    /** Edge length of mip 0's octahedral face, in texels. */
    f32 faceSize = 0.0f;
    u32 mipCount = 0;
    /** RGBM decode range: `(rgb*a)^2 * maxRange` is the stored radiance. */
    f32 maxRange = 0.0f;

    /** @brief How many octahedral pyramids stand side by side in the atlas.
     *  @details One for a sky imported from a panorama. A scene's BAKE writes
     *           several — column 0 the sky it was baked under, the rest a
     *           reflection probe each — so one bound texture serves them all. */
    u32 columns = 1;

    /** @brief The sun the importer found in the panorama: the one compact source
     *  a directional light can stand in for. The irradiance above still carries
     *  it, so a scene without such a light is lit as the photograph was; one with
     *  a light following it takes @ref skyIrradiance instead, or the sun counts twice. */
    bool hasSun = false;
    /** Toward the sun, in the panorama's own frame (before any environment rotation). */
    glm::vec3 sunDirection{0.0f, 1.0f, 0.0f};
    /** The sun's irradiance over pi per channel — what a surface facing it adds to
     *  albedo, the unit the coefficients are in and a light's colour times intensity is. */
    glm::vec3 sunColor{0.0f};
    /** The same nine coefficients with the sun's texels replaced by the sky around it. */
    std::array<glm::vec3, 9> skyIrradiance{};

    bool hasSpecular() const { return specular.isValid() && mipCount > 0 && faceSize > 0.0f; }
};

}  // namespace esengine
