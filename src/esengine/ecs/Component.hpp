#pragma once

#include "../core/Types.hpp"
#include "../math/Math.hpp"

namespace esengine::ecs {

// Components are plain data structures
// They should not contain logic, only data

// Transform component - position, rotation, scale
struct Transform {
    glm::vec3 position{0.0f, 0.0f, 0.0f};
    glm::vec3 rotation{0.0f, 0.0f, 0.0f};  // Euler angles in radians
    glm::vec3 scale{1.0f, 1.0f, 1.0f};

    Transform() = default;
    Transform(const glm::vec3& pos) : position(pos) {}
    Transform(const glm::vec3& pos, const glm::vec3& rot, const glm::vec3& scl)
        : position(pos), rotation(rot), scale(scl) {}

    // Get model matrix
    glm::mat4 getMatrix() const {
        glm::mat4 model = glm::mat4(1.0f);
        model = glm::translate(model, position);
        model = glm::rotate(model, rotation.x, glm::vec3(1.0f, 0.0f, 0.0f));
        model = glm::rotate(model, rotation.y, glm::vec3(0.0f, 1.0f, 0.0f));
        model = glm::rotate(model, rotation.z, glm::vec3(0.0f, 0.0f, 1.0f));
        model = glm::scale(model, scale);
        return model;
    }
};

// Velocity component for physics
struct Velocity {
    glm::vec3 linear{0.0f};
    glm::vec3 angular{0.0f};

    Velocity() = default;
    Velocity(const glm::vec3& lin) : linear(lin) {}
    Velocity(const glm::vec3& lin, const glm::vec3& ang) : linear(lin), angular(ang) {}
};

// Sprite component for 2D rendering
struct Sprite {
    u32 textureId{0};
    glm::vec4 color{1.0f, 1.0f, 1.0f, 1.0f};
    glm::vec2 size{1.0f, 1.0f};
    glm::vec2 uvOffset{0.0f, 0.0f};
    glm::vec2 uvScale{1.0f, 1.0f};
    i32 layer{0};

    Sprite() = default;
    Sprite(u32 texId) : textureId(texId) {}
    Sprite(u32 texId, const glm::vec4& col) : textureId(texId), color(col) {}
};

// Tag components (empty, just for marking entities)
struct Active {};
struct Visible {};
struct Static {};

// Name component for debugging
struct Name {
    std::string value;

    Name() = default;
    Name(const std::string& name) : value(name) {}
    Name(std::string&& name) : value(std::move(name)) {}
};

}  // namespace esengine::ecs
