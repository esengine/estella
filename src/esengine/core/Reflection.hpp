/**
 * @file    Reflection.hpp
 * @brief   Reflection and metadata system for automatic binding generation
 * @details Provides macros for marking components and properties that should
 *          be automatically exposed to scripting languages. Uses a declarative
 *          macro-based approach for code generation.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

// =============================================================================
// Reflection Macros
// =============================================================================

/**
 * @brief Mark a struct/class as a component that should be exposed to scripts
 *
 * @details This macro generates metadata that the binding generator tool uses
 *          to automatically create JavaScript/TypeScript bindings. Place this
 *          macro immediately before the struct/class definition.
 *
 * @code
 * ES_COMPONENT()
 * struct Transform {
 *     ES_PROPERTY()
 *     glm::vec3 position{0.0f};
 * };
 * @endcode
 */
#define ES_COMPONENT()

/**
 * @brief Mark a field as a property that should be exposed to scripts
 *
 * @details Properties marked with this macro will be accessible from
 *          JavaScript/TypeScript with automatic getter/setter generation.
 *          Only works inside ES_COMPONENT() marked types.
 */
#define ES_PROPERTY()

/**
 * @brief Mark a method that should be exposed to scripts
 *
 * @details Methods marked with this macro will be callable from
 *          JavaScript/TypeScript. Works for both member functions
 *          and static functions.
 *
 * @param ... Optional attributes (e.g., "const", "static")
 */
#define ES_METHOD(...)

/**
 * @brief Mark an enum that should be exposed to scripts
 *
 * @details Enums marked with this macro will be available as
 *          TypeScript enums with proper type checking.
 */
#define ES_ENUM()

/**
 * @brief Mark an enum value for explicit naming in bindings
 *
 * @details Use this to provide custom names for enum values in scripts,
 *          or to document their meaning for the binding generator.
 *
 * @param name Optional custom name for the enum value
 */
#define ES_ENUM_VALUE(name)

// =============================================================================
// Metadata Extraction Markers
// =============================================================================

/**
 * @brief Begin a reflection block for the binding generator
 *
 * @details The binding generator tool scans for blocks between
 *          ES_REFLECT_BEGIN and ES_REFLECT_END to find types that
 *          need bindings. This is used in header files.
 */
#define ES_REFLECT_BEGIN

/**
 * @brief End a reflection block for the binding generator
 */
#define ES_REFLECT_END

// =============================================================================
// Type Traits for Reflection
// =============================================================================

namespace esengine {

/**
 * @brief Type trait to detect if a type is a reflected component
 *
 * @details This is used by the binding system to verify types at compile time.
 *          Specialized by the binding generator for each ES_COMPONENT type.
 *
 * @tparam T Type to check
 */
template<typename T>
struct is_component : std::false_type {};

/**
 * @brief Helper variable template for is_component
 */
template<typename T>
inline constexpr bool is_component_v = is_component<T>::value;

/**
 * @brief Get the script name for a component type
 *
 * @details Returns the name used in JavaScript/TypeScript bindings.
 *          Specialized by the binding generator for each ES_COMPONENT type.
 *
 * @tparam T Component type
 * @return Script name as string literal
 */
template<typename T>
inline constexpr const char* component_name() {
    return "UnknownComponent";
}

}  // namespace esengine

// =============================================================================
// Usage Examples
// =============================================================================

/**
 * @example Basic Component
 *
 * @code
 * ES_COMPONENT()
 * struct Position {
 *     ES_PROPERTY()
 *     f32 x = 0.0f;
 *
 *     ES_PROPERTY()
 *     f32 y = 0.0f;
 * };
 * @endcode
 *
 * @example Component with Methods
 *
 * @code
 * ES_COMPONENT()
 * struct Health {
 *     ES_PROPERTY()
 *     f32 current = 100.0f;
 *
 *     ES_PROPERTY()
 *     f32 maximum = 100.0f;
 *
 *     ES_METHOD()
 *     void heal(f32 amount) {
 *         current = std::min(current + amount, maximum);
 *     }
 *
 *     ES_METHOD(const)
 *     bool isDead() const {
 *         return current <= 0.0f;
 *     }
 * };
 * @endcode
 *
 * @example Enum Binding
 *
 * @code
 * ES_ENUM()
 * enum class DamageType : u8 {
 *     ES_ENUM_VALUE("Physical")
 *     Physical,
 *
 *     ES_ENUM_VALUE("Magical")
 *     Magical,
 *
 *     ES_ENUM_VALUE("True")
 *     True
 * };
 * @endcode
 */
