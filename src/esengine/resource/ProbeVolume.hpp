// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ProbeVolume.hpp
 * @brief   A baked environment sampled on a grid, rather than held at one value.
 */
#pragma once

#include "../core/Types.hpp"
#include "../math/Math.hpp"

#include <vector>

namespace esengine {

/**
 * @brief Irradiance at a grid of points — an @ref Environment sampled, not held.
 *
 * @details The same nine coefficients per probe, running x fastest then y then z:
 *          the order a bake writes and a trilinear read assumes. Where the grid
 *          STANDS is the component's, so moving a volume moves the light it holds
 *          and one bake can be read at a second placement.
 */
class ProbeVolume {
public:
    /** @brief Probes along each axis. One on an axis is a constant along it —
     *         which is what an Environment already is — so a flat volume is the
     *         same case and not a second one. */
    glm::ivec3 resolution{0};

    /** @brief Nine RGB coefficients per probe, in grid order. */
    std::vector<glm::vec3> irradiance;

    u32 probeCount() const {
        if (resolution.x <= 0 || resolution.y <= 0 || resolution.z <= 0) return 0;
        return static_cast<u32>(resolution.x) * static_cast<u32>(resolution.y)
             * static_cast<u32>(resolution.z);
    }

    bool isValid() const {
        const u32 probes = probeCount();
        return probes > 0 && irradiance.size() == static_cast<usize>(probes) * 9;
    }
};

}  // namespace esengine
