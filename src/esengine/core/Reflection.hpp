// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
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
 *            Licensed under the Apache License, Version 2.0.
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
 *
 *          This is the single authoring site for a field's editor/serialization
 *          metadata (RC9-1): the value lives in the struct, the presentation policy
 *          lives in the annotation, and EHT generates both the TS metadata and the
 *          C++ editor schema from it. Vocabulary parsed/validated by EHT:
 *
 *          Semantics (flags):
 *          - asset=<type>     : asset reference (texture, material, font, audio, spine_skeleton, spine_atlas)
 *          - animatable       : keyframeable via the Sequencer/timeline
 *          - anim_override    : field may be tween-driven; layout must not clobber it
 *          - anim_flag=<flag> : animation side-effect flag (e.g. ANIM_POS_X on UINode)
 *          - entity_ref       : entity reference (remapped on scene load / instancing)
 *          - readonly         : not editable in the inspector
 *
 *          Editor presentation:
 *          - min=<n> / max=<n> / step=<n> : numeric range and scrub granularity
 *          - slider             : render as a slider (requires both min= and max=)
 *          - unit=<s>           : unit suffix shown after the value (e.g. °, px, %)
 *          - label=<s> / tooltip=<s> : human label / hover text
 *          - category=<s>       : inspector group header
 *          - advanced           : tuck behind an "advanced" fold
 *          - enum_source=<name> / bitmask_source=<name> : editor-resolved option/label source
 *
 *          Serialization / runtime policy:
 *          - invalidates=<field> : after an editor set, flip <field> so the owning
 *                                  system re-runs its load path next tick
 *          - skip_serialize      : omit from scene serialization (runtime-only state)
 *          - replicated          : eligible for network replication (RC11; reserved)
 *
 *          Malformed *known* metadata (a non-numeric min=, slider without a range,
 *          invalidates= naming no field) is a hard EHT error, not a silent drop.
 *
 *          Examples:
 *            ES_PROPERTY(asset=texture)
 *            ES_PROPERTY(animatable, anim_flag=ANIM_POS_X)
 *            ES_PROPERTY(min=0, max=180, unit="°", advanced, category="Spot")
 *            ES_PROPERTY(invalidates=needsReload)
 */
#define ES_PROPERTY(...)

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
