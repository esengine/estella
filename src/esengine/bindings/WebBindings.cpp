/**
 * @file    WebBindings.cpp
 * @brief   Emscripten bindings for exposing C++ ECS API to JavaScript
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#ifdef ES_PLATFORM_WEB

#include <emscripten/bind.h>
#include "../ecs/Registry.hpp"
#include "../ecs/Entity.hpp"
#include "../ecs/components/Transform.hpp"
#include "../ecs/components/Hierarchy.hpp"
#include "../ecs/components/Velocity.hpp"
#include "../ecs/components/Camera.hpp"
#include "../ecs/components/Sprite.hpp"
#include "../math/Math.hpp"

using namespace emscripten;

namespace esengine {

// =============================================================================
// Math Types
// =============================================================================

EMSCRIPTEN_BINDINGS(esengine_math) {
    // Vec2
    value_object<glm::vec2>("Vec2")
        .field("x", &glm::vec2::x)
        .field("y", &glm::vec2::y);

    // Vec3
    value_object<glm::vec3>("Vec3")
        .field("x", &glm::vec3::x)
        .field("y", &glm::vec3::y)
        .field("z", &glm::vec3::z);

    // Vec4
    value_object<glm::vec4>("Vec4")
        .field("x", &glm::vec4::x)
        .field("y", &glm::vec4::y)
        .field("z", &glm::vec4::z)
        .field("w", &glm::vec4::w);

    // Quat
    value_object<glm::quat>("Quat")
        .field("x", &glm::quat::x)
        .field("y", &glm::quat::y)
        .field("z", &glm::quat::z)
        .field("w", &glm::quat::w);

    // Mat4 (exposed as array for simplicity)
    // JavaScript can construct and pass as Float32Array
}

// =============================================================================
// ECS Entity Type
// =============================================================================

EMSCRIPTEN_BINDINGS(esengine_entity) {
    // Entity is just u32, expose as integer
    // JavaScript will treat it as a number
}

// =============================================================================
// ECS Components
// =============================================================================

EMSCRIPTEN_BINDINGS(esengine_components) {
    // LocalTransform component
    value_object<ecs::LocalTransform>("LocalTransform")
        .field("position", &ecs::LocalTransform::position)
        .field("rotation", &ecs::LocalTransform::rotation)
        .field("scale", &ecs::LocalTransform::scale);

    // WorldTransform component (read-only from JS)
    value_object<ecs::WorldTransform>("WorldTransform")
        .field("matrix", &ecs::WorldTransform::matrix)
        .field("position", &ecs::WorldTransform::position)
        .field("rotation", &ecs::WorldTransform::rotation)
        .field("scale", &ecs::WorldTransform::scale);

    // Parent component
    value_object<ecs::Parent>("Parent")
        .field("entity", &ecs::Parent::entity);

    // Children component (expose size and access)
    class_<ecs::Children>("Children")
        .function("count", &ecs::Children::count)
        .function("empty", &ecs::Children::empty)
        .function("at", optional_override([](const ecs::Children& children, usize index) {
            return children.entities[index];
        }));

    // Velocity component
    value_object<ecs::Velocity>("Velocity")
        .field("linear", &ecs::Velocity::linear)
        .field("angular", &ecs::Velocity::angular);

    // Camera component
    value_object<ecs::Camera>("Camera")
        .field("fov", &ecs::Camera::fov)
        .field("nearPlane", &ecs::Camera::nearPlane)
        .field("farPlane", &ecs::Camera::farPlane)
        .field("aspectRatio", &ecs::Camera::aspectRatio);

    // Sprite component
    value_object<ecs::Sprite>("Sprite")
        .field("color", &ecs::Sprite::color)
        .field("size", &ecs::Sprite::size);
}

// =============================================================================
// ECS Registry
// =============================================================================

EMSCRIPTEN_BINDINGS(esengine_registry) {
    class_<ecs::Registry>("Registry")
        .constructor<>()

        // Entity management
        .function("create", optional_override([](ecs::Registry& self) {
            return self.create();
        }))
        .function("destroy", optional_override([](ecs::Registry& self, Entity e) {
            self.destroy(e);
        }))
        .function("valid", optional_override([](ecs::Registry& self, Entity e) {
            return self.valid(e);
        }))
        .function("entityCount", optional_override([](const ecs::Registry& self) {
            return self.entityCount();
        }))

        // LocalTransform component
        .function("hasTransform", optional_override([](ecs::Registry& self, Entity e) {
            return self.has<ecs::LocalTransform>(e);
        }))
        .function("getTransform", optional_override([](ecs::Registry& self, Entity e) -> ecs::LocalTransform& {
            return self.get<ecs::LocalTransform>(e);
        }))
        .function("addTransform", optional_override([](ecs::Registry& self, Entity e, const ecs::LocalTransform& t) -> ecs::LocalTransform& {
            return self.emplaceOrReplace<ecs::LocalTransform>(e, t);
        }))
        .function("removeTransform", optional_override([](ecs::Registry& self, Entity e) {
            self.remove<ecs::LocalTransform>(e);
        }))

        // WorldTransform component (usually managed by TransformSystem)
        .function("hasWorldTransform", optional_override([](ecs::Registry& self, Entity e) {
            return self.has<ecs::WorldTransform>(e);
        }))
        .function("getWorldTransform", optional_override([](ecs::Registry& self, Entity e) -> ecs::WorldTransform& {
            return self.get<ecs::WorldTransform>(e);
        }))

        // Parent/Children hierarchy
        .function("hasParent", optional_override([](ecs::Registry& self, Entity e) {
            return self.has<ecs::Parent>(e);
        }))
        .function("getParent", optional_override([](ecs::Registry& self, Entity e) -> ecs::Parent& {
            return self.get<ecs::Parent>(e);
        }))
        .function("addParent", optional_override([](ecs::Registry& self, Entity e, const ecs::Parent& p) -> ecs::Parent& {
            return self.emplaceOrReplace<ecs::Parent>(e, p);
        }))
        .function("removeParent", optional_override([](ecs::Registry& self, Entity e) {
            self.remove<ecs::Parent>(e);
        }))

        .function("hasChildren", optional_override([](ecs::Registry& self, Entity e) {
            return self.has<ecs::Children>(e);
        }))
        .function("getChildren", optional_override([](ecs::Registry& self, Entity e) -> ecs::Children& {
            return self.get<ecs::Children>(e);
        }))

        // Velocity component
        .function("hasVelocity", optional_override([](ecs::Registry& self, Entity e) {
            return self.has<ecs::Velocity>(e);
        }))
        .function("getVelocity", optional_override([](ecs::Registry& self, Entity e) -> ecs::Velocity& {
            return self.get<ecs::Velocity>(e);
        }))
        .function("addVelocity", optional_override([](ecs::Registry& self, Entity e, const ecs::Velocity& v) -> ecs::Velocity& {
            return self.emplaceOrReplace<ecs::Velocity>(e, v);
        }))
        .function("removeVelocity", optional_override([](ecs::Registry& self, Entity e) {
            self.remove<ecs::Velocity>(e);
        }))

        // Camera component
        .function("hasCamera", optional_override([](ecs::Registry& self, Entity e) {
            return self.has<ecs::Camera>(e);
        }))
        .function("getCamera", optional_override([](ecs::Registry& self, Entity e) -> ecs::Camera& {
            return self.get<ecs::Camera>(e);
        }))
        .function("addCamera", optional_override([](ecs::Registry& self, Entity e, const ecs::Camera& c) -> ecs::Camera& {
            return self.emplaceOrReplace<ecs::Camera>(e, c);
        }))
        .function("removeCamera", optional_override([](ecs::Registry& self, Entity e) {
            self.remove<ecs::Camera>(e);
        }))

        // Sprite component
        .function("hasSprite", optional_override([](ecs::Registry& self, Entity e) {
            return self.has<ecs::Sprite>(e);
        }))
        .function("getSprite", optional_override([](ecs::Registry& self, Entity e) -> ecs::Sprite& {
            return self.get<ecs::Sprite>(e);
        }))
        .function("addSprite", optional_override([](ecs::Registry& self, Entity e, const ecs::Sprite& s) -> ecs::Sprite& {
            return self.emplaceOrReplace<ecs::Sprite>(e, s);
        }))
        .function("removeSprite", optional_override([](ecs::Registry& self, Entity e) {
            self.remove<ecs::Sprite>(e);
        }));
}

}  // namespace esengine

#endif  // ES_PLATFORM_WEB
