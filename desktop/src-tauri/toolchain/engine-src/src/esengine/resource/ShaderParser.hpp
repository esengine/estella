/**
 * @file    ShaderParser.hpp
 * @brief   Parser for unified .esshader file format
 * @details Parses single-file shader format containing multiple stages
 *          (vertex, fragment) with optional properties and platform variants.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

#include "../core/Types.hpp"

#include <string>
#include <vector>
#include <unordered_map>

namespace esengine::resource {

// =============================================================================
// Shader Stage Enum
// =============================================================================

enum class ShaderStage : u8 {
    Vertex,
    Fragment
};

// =============================================================================
// Shader Property
// =============================================================================

enum class ShaderPropertyType : u8 {
    Float,
    Vec2,
    Vec3,
    Vec4,
    Color,
    Int,
    Texture,
    Unknown
};

struct ShaderProperty {
    std::string name;                     ///< Uniform name
    ShaderPropertyType type;              ///< Property type
    std::string defaultValue;             ///< Default value as string
    std::string displayName;              ///< Display name for editor
};

// =============================================================================
// Parsed Shader
// =============================================================================

/**
 * @brief Result of parsing an .esshader file
 *
 * @details Contains all extracted information from a unified shader file
 *          including stages, properties, and platform variants.
 */
struct ParsedShader {
    std::string name;                                         ///< Shader name
    std::string version;                                      ///< GLSL version
    std::string sharedCode;                                   ///< Code shared by all stages
    std::unordered_map<ShaderStage, std::string> stages;      ///< Stage source code
    std::unordered_map<std::string, std::string> variants;    ///< Platform variants
    std::vector<ShaderProperty> properties;                   ///< Exposed properties
    std::string errorMessage;                                 ///< Parse error if any
    bool valid = false;                                       ///< True if parsing succeeded
};

// =============================================================================
// ShaderParser Class
// =============================================================================

/**
 * @brief Parser for .esshader unified shader format
 *
 * @details Parses shader files that contain multiple stages in a single file.
 *          Uses #pragma directives to separate sections.
 *
 * File format:
 * @code
 * #pragma shader "MyShader"
 * #pragma version 300 es
 *
 * #pragma properties
 * uniform sampler2D u_texture;  // @property(type=texture)
 * #pragma end
 *
 * #pragma vertex
 * // vertex shader code
 * #pragma end
 *
 * #pragma fragment
 * // fragment shader code
 * #pragma end
 * @endcode
 */
class ShaderParser {
public:
    /**
     * @brief Parses shader source into structured format
     * @param source The complete .esshader file content
     * @return Parsed shader data with valid flag indicating success
     */
    static ParsedShader parse(const std::string& source);

    /**
     * @brief Assembles final GLSL source for a specific stage
     * @param parsed The parsed shader data
     * @param stage The shader stage to assemble
     * @param platform Platform variant name (empty for default)
     * @return Complete GLSL source ready for compilation
     */
    static std::string assembleStage(const ParsedShader& parsed,
                                     ShaderStage stage,
                                     const std::string& platform = "");

private:
    static void parseDirective(const std::string& line,
                              std::string& directive,
                              std::string& argument);

    static ShaderProperty parsePropertyAnnotation(const std::string& line);

    static ShaderPropertyType stringToPropertyType(const std::string& typeStr);

    static std::string trim(const std::string& str);
};

}  // namespace esengine::resource
