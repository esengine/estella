#pragma once

// GLM Configuration
#ifndef GLM_FORCE_RADIANS
    #define GLM_FORCE_RADIANS
#endif
#ifndef GLM_FORCE_DEPTH_ZERO_TO_ONE
    #define GLM_FORCE_DEPTH_ZERO_TO_ONE
#endif
#ifndef GLM_ENABLE_EXPERIMENTAL
    #define GLM_ENABLE_EXPERIMENTAL
#endif

// GLM Core
#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/type_ptr.hpp>
#include <glm/gtc/quaternion.hpp>
#include <glm/gtx/quaternion.hpp>
#include <glm/gtx/euler_angles.hpp>

namespace esengine {

// Math constants
namespace math {

constexpr float PI = 3.14159265358979323846f;
constexpr float TWO_PI = 2.0f * PI;
constexpr float HALF_PI = 0.5f * PI;
constexpr float DEG_TO_RAD = PI / 180.0f;
constexpr float RAD_TO_DEG = 180.0f / PI;
constexpr float EPSILON = 1e-6f;

// Utility functions
inline float toRadians(float degrees) {
    return degrees * DEG_TO_RAD;
}

inline float toDegrees(float radians) {
    return radians * RAD_TO_DEG;
}

inline glm::vec3 toRadians(const glm::vec3& degrees) {
    return degrees * DEG_TO_RAD;
}

inline glm::vec3 toDegrees(const glm::vec3& radians) {
    return radians * RAD_TO_DEG;
}

// Linear interpolation
template<typename T>
inline T lerp(const T& a, const T& b, float t) {
    return a + t * (b - a);
}

// Clamp value
template<typename T>
inline T clamp(const T& value, const T& min, const T& max) {
    return glm::clamp(value, min, max);
}

// Approximately equal for floating point
inline bool approxEqual(float a, float b, float epsilon = EPSILON) {
    return std::abs(a - b) < epsilon;
}

inline bool approxEqual(const glm::vec3& a, const glm::vec3& b, float epsilon = EPSILON) {
    return approxEqual(a.x, b.x, epsilon) &&
           approxEqual(a.y, b.y, epsilon) &&
           approxEqual(a.z, b.z, epsilon);
}

// Create orthographic projection matrix
inline glm::mat4 ortho(float left, float right, float bottom, float top, float near, float far) {
    return glm::ortho(left, right, bottom, top, near, far);
}

// Create perspective projection matrix
inline glm::mat4 perspective(float fov, float aspect, float near, float far) {
    return glm::perspective(fov, aspect, near, far);
}

// Create look-at view matrix
inline glm::mat4 lookAt(const glm::vec3& eye, const glm::vec3& center, const glm::vec3& up) {
    return glm::lookAt(eye, center, up);
}

// Decompose transformation matrix
inline void decompose(const glm::mat4& matrix, glm::vec3& position, glm::vec3& rotation, glm::vec3& scale) {
    // Extract position
    position = glm::vec3(matrix[3]);

    // Extract scale
    scale.x = glm::length(glm::vec3(matrix[0]));
    scale.y = glm::length(glm::vec3(matrix[1]));
    scale.z = glm::length(glm::vec3(matrix[2]));

    // Remove scale from matrix for rotation extraction
    glm::mat3 rotMatrix(
        glm::vec3(matrix[0]) / scale.x,
        glm::vec3(matrix[1]) / scale.y,
        glm::vec3(matrix[2]) / scale.z
    );

    // Extract Euler angles from rotation matrix
    rotation.x = std::atan2(rotMatrix[2][1], rotMatrix[2][2]);
    rotation.y = std::atan2(-rotMatrix[2][0],
        std::sqrt(rotMatrix[2][1] * rotMatrix[2][1] + rotMatrix[2][2] * rotMatrix[2][2]));
    rotation.z = std::atan2(rotMatrix[1][0], rotMatrix[0][0]);
}

}  // namespace math
}  // namespace esengine
