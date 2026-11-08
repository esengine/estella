// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    test_placement_bounds.cpp
 * @brief   Check placement bounds against transformed geometry, including affine shear.
 */
#include "esengine/renderer/draw/PlacementBounds.hpp"
#include <glm/gtc/matrix_transform.hpp>
#include <cstdio>
#include <array>

using namespace esengine;

int main() {
    int failures = 0;
    const auto check = [&](bool ok, const char* message) {
        std::printf("%s: %s\n", ok ? "ok" : "FAIL", message);
        if (!ok) ++failures;
    };
    const auto rowsOf = [](const glm::mat4& matrix) {
        std::array<f32, 12> rows{};
        for (int r = 0; r < 3; ++r) for (int c = 0; c < 4; ++c) rows[r * 4 + c] = matrix[c][r];
        return rows;
    };
    const auto trs = rowsOf(glm::scale(glm::rotate(glm::mat4(1), 0.73f, glm::normalize(glm::vec3(1, 2, 3))), glm::vec3(2, -3, 0.5f)));
    check(std::abs(placement_bounds::stretchSquared(trs.data()) - 9.0f) < 1e-5f, "rotated signed TRS keeps its exact largest scale");
    const f32 shear[12] = {1, 1, 1, 500, 0, 0.1f, 0, -500, 0, 0, 0.1f, 100};
    const glm::vec3 diagonal = glm::normalize(glm::vec3(1));
    const glm::vec3 sheared(diagonal.x + diagonal.y + diagonal.z, diagonal.y * 0.1f, diagonal.z * 0.1f);
    check(glm::dot(sheared, sheared) > 1.01f, "longest column alone underestimates an affine shear");
    check(placement_bounds::stretchSquared(shear) >= glm::dot(sheared, sheared), "shared stretch bound contains the sheared diagonal");
    const f32 zero[12]{};
    check(placement_bounds::stretchSquared(zero) == 0.0f, "collapsed placements have zero stretch");

    const glm::vec3 lo(-300, -10, 0), hi(300, 10, 0);
    const f32 radius = placement_bounds::radius(lo, hi, 40);
    bool contained = true;
    for (int mask = 0; mask < 8; ++mask) {
        glm::vec3 corner;
        for (int axis = 0; axis < 3; ++axis) corner[axis] = (mask & (1 << axis)) ? hi[axis] + 40 : lo[axis] - 40;
        contained &= glm::length(corner) <= radius + 1e-4f;
    }
    check(contained, "origin radius contains every displaced corner of an elongated mesh");
    check(placement_bounds::radius(lo, hi, -1) == placement_bounds::radius(lo, hi, 0), "negative displacement cannot shrink authored bounds");

    u32 seed = 42;
    const auto random = [&]() { seed = seed * 1664525u + 1013904223u; return static_cast<f32>(seed >> 8) / 16777216.0f * 8.0f - 4.0f; };
    bool allContained = true;
    for (int i = 0; i < 10000; ++i) {
        f32 rows[12];
        for (f32& value : rows) value = random();
        const glm::vec3 v(random(), random(), random());
        const glm::vec3 transformed(rows[0] * v.x + rows[1] * v.y + rows[2] * v.z,
                                    rows[4] * v.x + rows[5] * v.y + rows[6] * v.z,
                                    rows[8] * v.x + rows[9] * v.y + rows[10] * v.z);
        allContained &= glm::dot(transformed, transformed) <= placement_bounds::stretchSquared(rows) * glm::dot(v, v) + 1e-3f;
    }
    check(allContained, "10000 arbitrary affine placements contain independently transformed points");
    const glm::mat3 parent(glm::rotate(glm::scale(glm::mat4(1), glm::vec3(2, 3, 0.5f)), 0.8f, glm::vec3(0, 0, 1)));
    const glm::vec3 origin(500, -700, 30), localCentre(120, -30, 8), localHalf(10, 40, 2);
    glm::vec3 centre, half;
    placement_bounds::transformedBox(parent, shear, origin, localCentre, localHalf, centre, half);
    bool boxContains = true;
    for (int mask = 0; mask < 8; ++mask) {
        glm::vec3 corner = localCentre;
        for (int axis = 0; axis < 3; ++axis) corner[axis] += ((mask & (1 << axis)) ? 1 : -1) * localHalf[axis];
        const glm::vec3 placed(corner.x + corner.y + corner.z, corner.y * 0.1f, corner.z * 0.1f);
        const glm::vec3 actual = origin + parent * placed;
        boxContains &= glm::all(glm::lessThanEqual(glm::abs(actual - centre), half + glm::vec3(1e-3f)));
    }
    check(boxContains, "tight box contains offset geometry under parent scale, rotation and placement shear");
    return failures ? 1 : 0;
}
