/**
 * @file    ScriptValue.hpp
 * @brief   RAII wrapper for QuickJS values
 * @details Provides type-safe JavaScript value management with automatic
 *          reference counting and lifetime management.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

#include "../core/Types.hpp"
#include "ScriptContext.hpp"

#include <string>
#include <vector>

namespace esengine {

/**
 * @brief RAII wrapper for JavaScript values
 *
 * @details Manages QuickJS JSValue lifecycle with automatic reference counting.
 *          Provides type-safe conversion and object manipulation methods.
 *
 * Usage:
 * @code
 * ScriptContext ctx;
 * ctx.init();
 *
 * // Create values
 * ScriptValue num = ScriptValue::number(ctx, 42.0);
 * ScriptValue str = ScriptValue::string(ctx, "Hello");
 * ScriptValue obj = ScriptValue::object(ctx);
 *
 * // Set object properties
 * obj.set("name", ScriptValue::string(ctx, "Player"));
 * obj.set("health", ScriptValue::number(ctx, 100.0));
 *
 * // Get properties
 * ScriptValue name = obj.get("name");
 * std::string nameStr = name.toString();
 * @endcode
 */
class ScriptValue {
public:
    /**
     * @brief Create undefined value
     */
    ScriptValue(ScriptContext& ctx);

    /**
     * @brief Create from existing JSValue (takes ownership)
     */
#ifdef ES_SCRIPTING_ENABLED
    ScriptValue(ScriptContext& ctx, JSValue value);
#endif

    ~ScriptValue();

    // Move semantics
    ScriptValue(ScriptValue&& other) noexcept;
    ScriptValue& operator=(ScriptValue&& other) noexcept;

    // Disable copy (use clone() instead for explicit copying)
    ScriptValue(const ScriptValue&) = delete;
    ScriptValue& operator=(const ScriptValue&) = delete;

    // =============================================================================
    // Factory methods for creating values
    // =============================================================================

    static ScriptValue undefined(ScriptContext& ctx);
    static ScriptValue null(ScriptContext& ctx);
    static ScriptValue boolean(ScriptContext& ctx, bool value);
    static ScriptValue number(ScriptContext& ctx, f64 value);
    static ScriptValue integer(ScriptContext& ctx, i32 value);
    static ScriptValue string(ScriptContext& ctx, const std::string& value);
    static ScriptValue object(ScriptContext& ctx);
    static ScriptValue array(ScriptContext& ctx);

    // =============================================================================
    // Type checking
    // =============================================================================

    bool isUndefined() const;
    bool isNull() const;
    bool isBool() const;
    bool isNumber() const;
    bool isString() const;
    bool isObject() const;
    bool isArray() const;
    bool isFunction() const;

    // =============================================================================
    // Type conversion
    // =============================================================================

    bool toBool() const;
    f64 toNumber() const;
    i32 toInt32() const;
    std::string toString() const;

    // =============================================================================
    // Object property access
    // =============================================================================

    /**
     * @brief Get object property by name
     * @param key Property name
     * @return ScriptValue containing the property value
     */
    ScriptValue get(const std::string& key) const;

    /**
     * @brief Set object property
     * @param key Property name
     * @param value Value to set
     */
    void set(const std::string& key, ScriptValue&& value);

    /**
     * @brief Check if object has property
     * @param key Property name
     * @return true if property exists, false otherwise
     */
    bool has(const std::string& key) const;

    // =============================================================================
    // Array operations
    // =============================================================================

    /**
     * @brief Get array length
     * @return Array length or 0 if not an array
     */
    usize length() const;

    /**
     * @brief Get array element by index
     * @param index Array index
     * @return ScriptValue containing the element
     */
    ScriptValue getAt(usize index) const;

    /**
     * @brief Set array element
     * @param index Array index
     * @param value Value to set
     */
    void setAt(usize index, ScriptValue&& value);

    // =============================================================================
    // Function calls
    // =============================================================================

    /**
     * @brief Call function with arguments
     * @param args Function arguments
     * @return Return value of the function
     */
    ScriptValue call(const std::vector<ScriptValue>& args);

    /**
     * @brief Call method on object
     * @param methodName Method name
     * @param args Method arguments
     * @return Return value of the method
     */
    ScriptValue callMethod(const std::string& methodName, const std::vector<ScriptValue>& args);

    // =============================================================================
    // Utilities
    // =============================================================================

    /**
     * @brief Create a deep copy of this value
     * @return Cloned ScriptValue
     */
    ScriptValue clone() const;

    /**
     * @brief Get context this value belongs to
     */
    ScriptContext* getContext() { return ctx_; }

#ifdef ES_SCRIPTING_ENABLED
    /**
     * @brief Get underlying JSValue (advanced usage)
     * @return JSValue handle
     */
    JSValue getJSValue() const { return value_; }
#endif

private:
    ScriptContext* ctx_ = nullptr;

#ifdef ES_SCRIPTING_ENABLED
    JSValue value_;
#endif
};

}  // namespace esengine
