// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
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
 *            Licensed under the PolyForm Noncommercial License 1.0.0.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

#include "../core/Types.hpp"

#include <functional>
#include <optional>
#include <string>
#include <vector>
#include <unordered_map>

namespace esengine::resource {

// =============================================================================
// Include Resolver
// =============================================================================

/**
 * @brief Resolves an #include path to its file contents.
 *
 * Return std::nullopt to signal "not found" — the parser will report a
 * descriptive error. Resolvers are free to cache, normalize paths, or
 * delegate to a virtual filesystem.
 */
using ShaderIncludeResolver = std::function<std::optional<std::string>(const std::string&)>;

// =============================================================================
// Source Line Mapping
// =============================================================================

/**
 * @brief A (file, line) pair identifying an original source location.
 *
 * Empty `file` denotes the primary shader source (the one passed directly
 * to parse()); non-empty names an #included file.
 */
struct SourceLine {
    std::string file;
    u32 line = 0;
};

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
    std::string defaultValue;             ///< Default value as string (comma-separated for vectors)
    std::string displayName;              ///< Display name for editor

    /// True when declared via `#pragma param` (the modern path: ShaderParser owns the GLSL
    /// codegen + std140 layout). False for the legacy `#pragma properties` block, which is
    /// reflection-only — the shader declares those uniforms itself, so they are not codegen'd.
    bool fromParam = false;

    /// Byte offset of this param inside the std140 MaterialConstants block, or -1 for
    /// texture params (which are samplers, not block members).
    i32 std140Offset = -1;
    /// Sampler unit for a texture param (>= MATERIAL_TEXTURE_UNIT_BASE), or -1 otherwise.
    i32 textureUnit = -1;

    /// Optional editor metadata (range slider bounds, UI hint). Drives the inspector panel;
    /// not used in codegen. hasRange == false leaves the field a plain numeric input.
    bool hasRange = false;
    f32 rangeMin = 0.0f;
    f32 rangeMax = 1.0f;
    std::string ui;                       ///< UI hint, e.g. "slider", "color" (free-form).
};

/**
 * @brief A material-controlled static switch (#pragma switch): a boolean the material sets,
 *        selecting a compile-time shader permutation via a #define. Distinct from #pragma
 *        feature (an engine-chosen variant keyword) only in being material-facing + defaulted.
 */
struct ShaderSwitch {
    std::string name;
    bool defaultOn = false;
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
    std::vector<std::string> features;                        ///< Declared #pragma feature keywords (compile-time variants)
    std::vector<ShaderSwitch> switches;                       ///< Material-controlled #pragma switch toggles (name + default)
    std::vector<ShaderProperty> properties;                   ///< Exposed material params (#pragma param / properties block)
    std::string domain = "Unlit2D";                           ///< #pragma domain (Unlit2D/Lit2D/PostProcess/UI)
    /// std140 byte size of the generated MaterialConstants block (16-aligned), 0 if no
    /// non-texture params. The render path sizes the per-material UBO to this.
    u32 materialBlockSize = 0;
    std::string errorMessage;                                 ///< Parse error if any
    bool valid = false;                                       ///< True if parsing succeeded

    /**
     * @brief Line map for the expanded pre-parse source.
     *
     * expandedLineMap[i] is the original SourceLine that produced line
     * (i + 1) of the post-#include-expansion source. Callers that know
     * the expanded-source line of a compile error can resolve it back
     * to the original file.
     */
    std::vector<SourceLine> expandedLineMap;

    /**
     * @brief Per-stage line maps, parallel to stages[].
     *
     * Entry N is the SourceLine for line (N + 1) of the stage body (the
     * code between `#pragma vertex`/`#pragma fragment` and `#pragma end`,
     * not including the assembled `#version`/sharedCode prefix).
     */
    std::unordered_map<ShaderStage, std::vector<SourceLine>> stageLineMaps;
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
     * @brief Parses shader source into structured format (no include support)
     * @param source The complete .esshader file content
     * @return Parsed shader data with valid flag indicating success
     */
    static ParsedShader parse(const std::string& source);

    /**
     * @brief Parses shader source with #include "path" expansion
     * @param source The complete .esshader file content
     * @param resolver Callback used to fetch included file contents
     * @return Parsed shader data with valid flag indicating success
     */
    static ParsedShader parse(const std::string& source,
                              const ShaderIncludeResolver& resolver);

    /**
     * @brief Assembles final GLSL source for a specific stage
     * @param parsed The parsed shader data
     * @param stage The shader stage to assemble
     * @param platform Platform variant name (empty for default)
     * @param features Feature keywords to enable; each is injected as `#define <name> 1`
     *                 right after `#version`, so shaders can `#ifdef` compile-time variants.
     * @return Complete GLSL source ready for compilation
     */
    static std::string assembleStage(const ParsedShader& parsed,
                                     ShaderStage stage,
                                     const std::string& platform = "",
                                     const std::vector<std::string>& features = {});

    /**
     * @brief Stable cache key for a feature set (order-independent), e.g. "GRAYSCALE|TINT".
     *        Consumers key their compiled-variant cache on (shader, variantKey(features)).
     */
    static std::string variantKey(const std::vector<std::string>& features);

    /**
     * @brief Like assembleStage, but also reports the line count of the
     *        assembled prefix (version + variant + sharedCode).
     *
     * Stage body starts at output line (headerLineCount + 1); pass
     * headerLineCount to remapCompilerLog as its `headerLineOffset`
     * so GL log line numbers can be translated back to the original file.
     */
    struct AssembledStage {
        std::string source;
        u32 headerLineCount = 0;
    };

    static AssembledStage assembleStageEx(const ParsedShader& parsed,
                                          ShaderStage stage,
                                          const std::string& platform = "",
                                          const std::vector<std::string>& features = {});

    /**
     * @brief Rewrites GL compile-log line references back to original files
     *
     * Scans @p log for `0:N:` and `0(N)` patterns (the two common vendor
     * prefixes) and rewrites each occurrence to `file:origLine:`. Lines
     * before @p headerLineOffset are treated as synthetic header (e.g.
     * `#version`, sharedCode) and left unchanged.
     *
     * @param log GL driver log (from glGetShaderInfoLog / glGetProgramInfoLog)
     * @param stageMap Per-stage line map from ParsedShader::stageLineMaps
     * @param headerLineOffset Line count prepended by assembleStage before
     *        the stage body (typically 1 for `#version` + sharedCode line
     *        count)
     * @return Log with line references rewritten to original locations
     */
    static std::string remapCompilerLog(const std::string& log,
                                        const std::vector<SourceLine>& stageMap,
                                        u32 headerLineOffset);

private:
    static void parseDirective(const std::string& line,
                              std::string& directive,
                              std::string& argument);

    /// Parses a `#pragma param <name> <type> [default(..)] [range(min,max)] [ui(..)]` line.
    static ShaderProperty parseParamDirective(const std::string& argument);

    /// Assigns std140 offsets to non-texture params and sampler units to texture params,
    /// and sets ParsedShader::materialBlockSize. Run once after all params are collected.
    static void computeMaterialLayout(ParsedShader& shader);

    static ShaderProperty parsePropertyAnnotation(const std::string& line);

    static ShaderPropertyType stringToPropertyType(const std::string& typeStr);

    static std::string trim(const std::string& str);
};

}  // namespace esengine::resource
