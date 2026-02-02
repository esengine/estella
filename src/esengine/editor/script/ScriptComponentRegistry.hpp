/**
 * @file    ScriptComponentRegistry.hpp
 * @brief   Registry for script-defined components
 * @details Parses TypeScript source files to discover defineComponent calls.
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

#include "../../core/Types.hpp"

#include <glm/glm.hpp>
#include <optional>
#include <string>
#include <unordered_map>
#include <variant>
#include <vector>

namespace esengine::editor {

// =============================================================================
// Field Types
// =============================================================================

enum class ScriptFieldType : u8 {
    F32,
    I32,
    Bool,
    String,
    Vec2,
    Vec3,
    Vec4,
    Color,
    Entity
};

// =============================================================================
// Field Value
// =============================================================================

using ScriptFieldValue = std::variant<
    f32,
    i32,
    bool,
    std::string,
    glm::vec2,
    glm::vec3,
    glm::vec4,
    u32  // Entity
>;

// =============================================================================
// Script Field Definition
// =============================================================================

struct ScriptFieldDef {
    std::string name;
    ScriptFieldType type;
    ScriptFieldValue defaultValue;
};

// =============================================================================
// Script Component Definition
// =============================================================================

struct ScriptComponentDef {
    std::string name;
    std::string sourceFile;  ///< Source file where component is defined
    std::vector<ScriptFieldDef> fields;
};

// =============================================================================
// Script Component Instance
// =============================================================================

struct ScriptComponentInstance {
    std::string componentName;
    std::unordered_map<std::string, ScriptFieldValue> values;
};

// =============================================================================
// ScriptComponentRegistry
// =============================================================================

/**
 * @brief Registry for script-defined components
 * @details Scans TypeScript source files and parses defineComponent calls
 *          to discover custom component definitions.
 */
class ScriptComponentRegistry {
public:
    ScriptComponentRegistry() = default;
    ~ScriptComponentRegistry() = default;

    // =========================================================================
    // Scanning
    // =========================================================================

    /**
     * @brief Scan project source directory for component definitions
     * @param projectPath Path to project root
     * @return True if scanning succeeded
     */
    bool scanProject(const std::string& projectPath);

    /**
     * @brief Rescan the project source files
     */
    bool rescan();

    /**
     * @brief Parse a single TypeScript file for component definitions
     * @param filePath Path to the .ts file
     * @return Number of components found
     */
    usize parseFile(const std::string& filePath);

    // =========================================================================
    // Query
    // =========================================================================

    /** @brief Get all registered component definitions */
    const std::vector<ScriptComponentDef>& getComponents() const { return components_; }

    /** @brief Get component definition by name */
    const ScriptComponentDef* getComponent(const std::string& name) const;

    /** @brief Check if a component is registered */
    bool hasComponent(const std::string& name) const;

    /** @brief Get number of registered components */
    usize componentCount() const { return components_.size(); }

    // =========================================================================
    // Instance Creation
    // =========================================================================

    /**
     * @brief Create a component instance with default values
     * @param name Component name
     * @return Instance with default values, or nullopt if not found
     */
    std::optional<ScriptComponentInstance> createInstance(const std::string& name) const;

    // =========================================================================
    // Serialization Helpers
    // =========================================================================

    /** @brief Convert field type to string */
    static std::string fieldTypeToString(ScriptFieldType type);

    /** @brief Parse field type from string */
    static ScriptFieldType stringToFieldType(const std::string& str);

    /** @brief Serialize field value to JSON string */
    static std::string serializeValue(const ScriptFieldValue& value, ScriptFieldType type);

    /** @brief Parse field value from JSON string */
    static ScriptFieldValue parseValue(const std::string& json, ScriptFieldType type);

private:
    std::string projectPath_;
    std::vector<ScriptComponentDef> components_;
    std::unordered_map<std::string, usize> nameToIndex_;

    /** @brief Find all .ts files in directory recursively */
    std::vector<std::string> findTypeScriptFiles(const std::string& dir);

    /** @brief Parse defineComponent call from source code */
    bool parseDefineComponent(const std::string& source, usize pos, ScriptComponentDef& outDef);

    /** @brief Parse schema object { field: Type.xxx, ... } */
    bool parseSchema(const std::string& source, usize start, usize end,
                     std::vector<ScriptFieldDef>& outFields);

    /** @brief Parse defaults object { field: value, ... } */
    void parseDefaults(const std::string& source, usize start, usize end,
                       std::vector<ScriptFieldDef>& fields);

    /** @brief Find matching brace/bracket */
    usize findMatchingBrace(const std::string& source, usize openPos, char open, char close);
};

}  // namespace esengine::editor
