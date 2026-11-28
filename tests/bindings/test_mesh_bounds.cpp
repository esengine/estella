// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>

#include "esengine/bindings/BoundarySpan.hpp"
#include "esengine/bindings/RendererBindings.hpp"
#include "esengine/ecs/Registry.hpp"
#include "esengine/ecs/components/MeshRenderer.hpp"

#include <array>

using namespace esengine;

TEST_CASE("mesh bounds write the inline geometry once and leave rejected outputs untouched") {
    ecs::Registry registry;
    const auto entity = registry.create();
    auto& mesh = registry.emplace<ecs::MeshRenderer>(entity);
    mesh.localMin = {-3.0f, -5.0f};
    mesh.localMax = {7.0f, 9.0f};
    std::array<f32, 6> out{};
    const auto ptr = reinterpret_cast<uintptr_t>(out.data());
    CHECK(meshRenderer_copyLocalBounds(registry, entity.id(), ptr));
    const std::array<f32, 6> expected{-3.0f, -5.0f, 0.0f, 7.0f, 9.0f, 0.0f};
    CHECK(out == expected);

    const auto empty = registry.create();
    CHECK_FALSE(meshRenderer_copyLocalBounds(registry, empty.id(), ptr));
    setBoundaryRegion(ptr, sizeof(out) - sizeof(f32));
    CHECK_FALSE(meshRenderer_copyLocalBounds(registry, entity.id(), ptr));
    setBoundaryRegion(0, 0);
    CHECK(out == expected);
}
