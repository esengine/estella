/**
 * @file    Math.hpp
 * @brief   Math utilities and GLM configuration for ESEngine
 * @details Provides GLM configuration, math constants, and utility functions
 *          for common game development operations.
 *
 * @author  ESEngine Team
 * @date    2025
 *
 * @copyright Copyright (c) 2025 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

// =============================================================================
// GLM Configuration
// =============================================================================

#ifndef GLM_FORCE_RADIANS
    #define GLM_FORCE_RADIANS
#endif
#ifndef GLM_FORCE_DEPTH_ZERO_TO_ONE
    #define GLM_FORCE_DEPTH_ZERO_TO_ONE
#endif
#ifndef GLM_ENABLE_EXPERIMENTAL
    #define GLM_ENABLE_EXPERIMENTAL
#endif

// =============================================================================
// GLM Includes
// =============================================================================

#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/type_ptr.hpp>
#include <glm/gtc/quaternion.hpp>
#include <glm/gtx/quaternion.hpp>
#include <glm/gtx/euler_angles.hpp>

namespace esengine {

// =============================================================================
// Math Namespace
// =============================================================================

/**
 * @brief Math constants and utility functions
 *
 * @details Provides common mathematical constants and helper functions
 *          for angles, interpolation, matrix operations, etc.
 */
namespace math {

// =============================================================================
// Constants
// =============================================================================

/** @brief Pi constant */
constexpr float PI = 3.14159265358979323846f;

/** @brief Two times pi (full circle in radians) */
constexpr float TWO_PI = 2.0f * PI;

/** @brief Half pi (quarter circle in radians) */
constexpr float HALF_PI = 0.5f * PI;

/** @brief Degrees to radians conversion factor */
constexpr float DEG_TO_RAD = PI / 180.0f;

/** @brief Radians to degrees conversion factor */
constexpr float RAD_TO_DEG = 180.0f / PI;

/** @brief Small epsilon for floating-point comparisons */
constexpr float EPSILON = 1e-6f;

// =============================================================================
// Angle Conversion
// =============================================================================

/**
 * @brief Converts degrees to radians
 * @param degrees Angle in degrees
 * @return Angle in radians
 */
inline float toRadians(float degrees) {
    return degrees * DEG_TO_RAD;
}

/**
 * @brief Converts radians to degrees
 * @param radians Angle in radians
 * @return Angle in degrees
 */
inline float toDegrees(float radians) {
    return radians * RAD_TO_DEG;
}

/**
 * @brief Converts a vec3 of degrees to radians
 * @param degrees Euler angles in degrees
 * @return Euler angles in radians
 */
inline glm::vec3 toRadians(const glm::vec3& degrees) {
    return degrees * DEG_TO_RAD;
}

/**
 * @brief Converts a vec3 of radians to degrees
 * @param radians Euler angles in radians
 * @return Euler angles in degrees
 */
inline glm::vec3 toDegrees(const glm::vec3& radians) {
    return radians * RAD_TO_DEG;
}

// =============================================================================
// Interpolation
// =============================================================================

/**
 * @brief Linear interpolation between two values
 * @tparam T Value type (float, vec2, vec3, vec4, etc.)
 * @param a Start value
 * @param b End value
 * @param t Interpolation factor (0 = a, 1 = b)
 * @return Interpolated value
 *
 * @code
 * float val = math::lerp(0.0f, 10.0f, 0.5f); // 5.0f
 * glm::vec3 pos = math::lerp(startPos, endPos, t);
 * @endcode
 */
template<typename T>
inline T lerp(const T& a, const T& b, float t) {
    return a + t * (b - a);
}

/**
 * @brief Clamps a value between min and max
 * @tparam T Value type
 * @param value Value to clamp
 * @param min Minimum bound
 * @param max Maximum bound
 * @return Clamped value
 */
template<typename T>
inline T clamp(const T& value, const T& min, const T& max) {
    return glm::clamp(value, min, max);
}

// =============================================================================
// Comparisons
// =============================================================================

/**
 * @brief Checks if two floats are approximately equal
 * @param a First value
 * @param b Second value
 * @param epsilon Maximum difference threshold
 * @return True if |a - b| < epsilon
 */
inline bool approxEqual(float a, float b, float epsilon = EPSILON) {
    return std::abs(a - b) < epsilon;
}

/**
 * @brief Checks if two vec3s are approximately equal
 * @param a First vector
 * @param b Second vector
 * @param epsilon Maximum component difference threshold
 * @return True if all components are approximately equal
 */
inline bool approxEqual(const glm::vec3& a, const glm::vec3& b, float epsilon = EPSILON) {
    return approxEqual(a.x, b.x, epsilon) &&
           approxEqual(a.y, b.y, epsilon) &&
           approxEqual(a.z, b.z, epsilon);
}

// =============================================================================
// Projection Matrices
// =============================================================================

/**
 * @brief Creates an orthographic projection matrix
 * @param left Left boundary
 * @param right Right boundary
 * @param bottom Bottom boundary
 * @param top Top boundary
 * @param near Near plane distance
 * @param far Far plane distance
 * @return Orthographic projection matrix
 */
inline glm::mat4 ortho(float left, float right, float bottom, float top, float near, float far) {
    return glm::ortho(left, right, bottom, top, near, far);
}

/**
 * @brief Creates a perspective projection matrix
 * @param fov Field of view in radians
 * @param aspect Aspect ratio (width / height)
 * @param near Near plane distance
 * @param far Far plane distance
 * @return Perspective projection matrix
 */
inline glm::mat4 perspective(float fov, float aspect, float near, float far) {
    return glm::perspective(fov, aspect, near, far);
}

/**
 * @brief Creates a look-at view matrix
 * @param eye Camera position
 * @param center Point to look at
 * @param up World up vector
 * @return View matrix
 */
inline glm::mat4 lookAt(const glm::vec3& eye, const glm::vec3& center, const glm::vec3& up) {
    return glm::lookAt(eye, center, up);
}

// =============================================================================
// Matrix Decomposition
// =============================================================================

/**
 * @brief Decomposes a transformation matrix into components
 * @param matrix The transformation matrix to decompose
 * @param position Output: extracted position
 * @param rotation Output: extracted Euler angles (radians)
 * @param scale Output: extracted scale factors
 *
 * @code
 * glm::vec3 pos, rot, scl;
 * math::decompose(transform, pos, rot, scl);
 * @endcode
 */
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
