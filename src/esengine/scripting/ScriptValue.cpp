/**
 * @file    ScriptValue.cpp
 * @brief   RAII wrapper for QuickJS values implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "ScriptValue.hpp"
#include "../core/Log.hpp"

namespace esengine {

// =============================================================================
// Constructors and Destructor
// =============================================================================

ScriptValue::ScriptValue(ScriptContext& ctx)
    : ctx_(&ctx) {
#ifdef ES_SCRIPTING_ENABLED
    value_ = JS_UNDEFINED;
#endif
}

#ifdef ES_SCRIPTING_ENABLED
ScriptValue::ScriptValue(ScriptContext& ctx, JSValue value)
    : ctx_(&ctx), value_(value) {
}
#endif

ScriptValue::~ScriptValue() {
#ifdef ES_SCRIPTING_ENABLED
    if (ctx_ && ctx_->getJSContext()) {
        JS_FreeValue(ctx_->getJSContext(), value_);
    }
#endif
}

ScriptValue::ScriptValue(ScriptValue&& other) noexcept
    : ctx_(other.ctx_) {
#ifdef ES_SCRIPTING_ENABLED
    value_ = other.value_;
    other.value_ = JS_UNDEFINED;
#endif
    other.ctx_ = nullptr;
}

ScriptValue& ScriptValue::operator=(ScriptValue&& other) noexcept {
    if (this != &other) {
#ifdef ES_SCRIPTING_ENABLED
        if (ctx_ && ctx_->getJSContext()) {
            JS_FreeValue(ctx_->getJSContext(), value_);
        }
        value_ = other.value_;
        other.value_ = JS_UNDEFINED;
#endif
        ctx_ = other.ctx_;
        other.ctx_ = nullptr;
    }
    return *this;
}

// =============================================================================
// Factory methods
// =============================================================================

ScriptValue ScriptValue::undefined(ScriptContext& ctx) {
#ifdef ES_SCRIPTING_ENABLED
    return ScriptValue(ctx, JS_UNDEFINED);
#else
    return ScriptValue(ctx);
#endif
}

ScriptValue ScriptValue::null(ScriptContext& ctx) {
#ifdef ES_SCRIPTING_ENABLED
    return ScriptValue(ctx, JS_NULL);
#else
    return ScriptValue(ctx);
#endif
}

ScriptValue ScriptValue::boolean(ScriptContext& ctx, bool value) {
#ifdef ES_SCRIPTING_ENABLED
    return ScriptValue(ctx, JS_NewBool(ctx.getJSContext(), value));
#else
    (void)value;
    return ScriptValue(ctx);
#endif
}

ScriptValue ScriptValue::number(ScriptContext& ctx, f64 value) {
#ifdef ES_SCRIPTING_ENABLED
    return ScriptValue(ctx, JS_NewFloat64(ctx.getJSContext(), value));
#else
    (void)value;
    return ScriptValue(ctx);
#endif
}

ScriptValue ScriptValue::integer(ScriptContext& ctx, i32 value) {
#ifdef ES_SCRIPTING_ENABLED
    return ScriptValue(ctx, JS_NewInt32(ctx.getJSContext(), value));
#else
    (void)value;
    return ScriptValue(ctx);
#endif
}

ScriptValue ScriptValue::string(ScriptContext& ctx, const std::string& value) {
#ifdef ES_SCRIPTING_ENABLED
    return ScriptValue(ctx, JS_NewString(ctx.getJSContext(), value.c_str()));
#else
    (void)value;
    return ScriptValue(ctx);
#endif
}

ScriptValue ScriptValue::object(ScriptContext& ctx) {
#ifdef ES_SCRIPTING_ENABLED
    return ScriptValue(ctx, JS_NewObject(ctx.getJSContext()));
#else
    return ScriptValue(ctx);
#endif
}

ScriptValue ScriptValue::array(ScriptContext& ctx) {
#ifdef ES_SCRIPTING_ENABLED
    return ScriptValue(ctx, JS_NewArray(ctx.getJSContext()));
#else
    return ScriptValue(ctx);
#endif
}

// =============================================================================
// Type checking
// =============================================================================

bool ScriptValue::isUndefined() const {
#ifdef ES_SCRIPTING_ENABLED
    return JS_IsUndefined(value_);
#else
    return true;
#endif
}

bool ScriptValue::isNull() const {
#ifdef ES_SCRIPTING_ENABLED
    return JS_IsNull(value_);
#else
    return false;
#endif
}

bool ScriptValue::isBool() const {
#ifdef ES_SCRIPTING_ENABLED
    return JS_IsBool(value_);
#else
    return false;
#endif
}

bool ScriptValue::isNumber() const {
#ifdef ES_SCRIPTING_ENABLED
    return JS_IsNumber(value_);
#else
    return false;
#endif
}

bool ScriptValue::isString() const {
#ifdef ES_SCRIPTING_ENABLED
    return JS_IsString(value_);
#else
    return false;
#endif
}

bool ScriptValue::isObject() const {
#ifdef ES_SCRIPTING_ENABLED
    return JS_IsObject(value_);
#else
    return false;
#endif
}

bool ScriptValue::isArray() const {
#ifdef ES_SCRIPTING_ENABLED
    return JS_IsArray(ctx_->getJSContext(), value_);
#else
    return false;
#endif
}

bool ScriptValue::isFunction() const {
#ifdef ES_SCRIPTING_ENABLED
    return JS_IsFunction(ctx_->getJSContext(), value_);
#else
    return false;
#endif
}

// =============================================================================
// Type conversion
// =============================================================================

bool ScriptValue::toBool() const {
#ifdef ES_SCRIPTING_ENABLED
    return JS_ToBool(ctx_->getJSContext(), value_) != 0;
#else
    return false;
#endif
}

f64 ScriptValue::toNumber() const {
#ifdef ES_SCRIPTING_ENABLED
    f64 result = 0.0;
    if (JS_ToFloat64(ctx_->getJSContext(), &result, value_) < 0) {
        ES_LOG_WARN("Failed to convert ScriptValue to number");
        return 0.0;
    }
    return result;
#else
    return 0.0;
#endif
}

i32 ScriptValue::toInt32() const {
#ifdef ES_SCRIPTING_ENABLED
    i32 result = 0;
    if (JS_ToInt32(ctx_->getJSContext(), &result, value_) < 0) {
        ES_LOG_WARN("Failed to convert ScriptValue to int32");
        return 0;
    }
    return result;
#else
    return 0;
#endif
}

std::string ScriptValue::toString() const {
#ifdef ES_SCRIPTING_ENABLED
    const char* str = JS_ToCString(ctx_->getJSContext(), value_);
    if (!str) {
        ES_LOG_WARN("Failed to convert ScriptValue to string");
        return "";
    }
    std::string result(str);
    JS_FreeCString(ctx_->getJSContext(), str);
    return result;
#else
    return "";
#endif
}

// =============================================================================
// Object property access
// =============================================================================

ScriptValue ScriptValue::get(const std::string& key) const {
#ifdef ES_SCRIPTING_ENABLED
    if (!isObject()) {
        ES_LOG_WARN("Cannot get property '{}' from non-object", key);
        return ScriptValue::undefined(*ctx_);
    }
    JSValue prop = JS_GetPropertyStr(ctx_->getJSContext(), value_, key.c_str());
    return ScriptValue(*ctx_, prop);
#else
    (void)key;
    return ScriptValue(*ctx_);
#endif
}

void ScriptValue::set(const std::string& key, ScriptValue&& value) {
#ifdef ES_SCRIPTING_ENABLED
    if (!isObject()) {
        ES_LOG_WARN("Cannot set property '{}' on non-object", key);
        return;
    }
    // JS_SetPropertyStr takes ownership of the value, so we need to duplicate it
    JSValue val = JS_DupValue(ctx_->getJSContext(), value.value_);
    if (JS_SetPropertyStr(ctx_->getJSContext(), value_, key.c_str(), val) < 0) {
        ES_LOG_WARN("Failed to set property '{}'", key);
    }
#else
    (void)key;
    (void)value;
#endif
}

bool ScriptValue::has(const std::string& key) const {
#ifdef ES_SCRIPTING_ENABLED
    if (!isObject()) {
        return false;
    }
    JSAtom atom = JS_NewAtom(ctx_->getJSContext(), key.c_str());
    int result = JS_HasProperty(ctx_->getJSContext(), value_, atom);
    JS_FreeAtom(ctx_->getJSContext(), atom);
    return result > 0;
#else
    (void)key;
    return false;
#endif
}

// =============================================================================
// Array operations
// =============================================================================

usize ScriptValue::length() const {
#ifdef ES_SCRIPTING_ENABLED
    if (!isArray()) {
        return 0;
    }
    JSValue lengthVal = JS_GetPropertyStr(ctx_->getJSContext(), value_, "length");
    i32 len = 0;
    JS_ToInt32(ctx_->getJSContext(), &len, lengthVal);
    JS_FreeValue(ctx_->getJSContext(), lengthVal);
    return static_cast<usize>(len);
#else
    return 0;
#endif
}

ScriptValue ScriptValue::getAt(usize index) const {
#ifdef ES_SCRIPTING_ENABLED
    if (!isArray()) {
        ES_LOG_WARN("Cannot get index {} from non-array", index);
        return ScriptValue::undefined(*ctx_);
    }
    JSValue elem = JS_GetPropertyUint32(ctx_->getJSContext(), value_, static_cast<u32>(index));
    return ScriptValue(*ctx_, elem);
#else
    (void)index;
    return ScriptValue(*ctx_);
#endif
}

void ScriptValue::setAt(usize index, ScriptValue&& value) {
#ifdef ES_SCRIPTING_ENABLED
    if (!isArray()) {
        ES_LOG_WARN("Cannot set index {} on non-array", index);
        return;
    }
    JSValue val = JS_DupValue(ctx_->getJSContext(), value.value_);
    if (JS_SetPropertyUint32(ctx_->getJSContext(), value_, static_cast<u32>(index), val) < 0) {
        ES_LOG_WARN("Failed to set array element at index {}", index);
    }
#else
    (void)index;
    (void)value;
#endif
}

// =============================================================================
// Function calls
// =============================================================================

ScriptValue ScriptValue::call(const std::vector<ScriptValue>& args) {
#ifdef ES_SCRIPTING_ENABLED
    if (!isFunction()) {
        ES_LOG_ERROR("Cannot call non-function value");
        return ScriptValue::undefined(*ctx_);
    }

    // Prepare arguments
    std::vector<JSValue> jsArgs;
    jsArgs.reserve(args.size());
    for (const auto& arg : args) {
        jsArgs.push_back(arg.value_);
    }

    // Call function
    JSValue result = JS_Call(
        ctx_->getJSContext(),
        value_,
        JS_UNDEFINED,
        static_cast<int>(jsArgs.size()),
        jsArgs.data()
    );

    if (JS_IsException(result)) {
        ES_LOG_ERROR("Exception during function call");
        JS_FreeValue(ctx_->getJSContext(), result);
        return ScriptValue::undefined(*ctx_);
    }

    return ScriptValue(*ctx_, result);
#else
    (void)args;
    return ScriptValue(*ctx_);
#endif
}

ScriptValue ScriptValue::callMethod(const std::string& methodName, const std::vector<ScriptValue>& args) {
#ifdef ES_SCRIPTING_ENABLED
    if (!isObject()) {
        ES_LOG_ERROR("Cannot call method on non-object");
        return ScriptValue::undefined(*ctx_);
    }

    JSValue func = JS_GetPropertyStr(ctx_->getJSContext(), value_, methodName.c_str());
    if (!JS_IsFunction(ctx_->getJSContext(), func)) {
        ES_LOG_ERROR("Property '{}' is not a function", methodName);
        JS_FreeValue(ctx_->getJSContext(), func);
        return ScriptValue::undefined(*ctx_);
    }

    // Prepare arguments
    std::vector<JSValue> jsArgs;
    jsArgs.reserve(args.size());
    for (const auto& arg : args) {
        jsArgs.push_back(arg.value_);
    }

    // Call method with 'this' binding
    JSValue result = JS_Call(
        ctx_->getJSContext(),
        func,
        value_,  // 'this' object
        static_cast<int>(jsArgs.size()),
        jsArgs.data()
    );

    JS_FreeValue(ctx_->getJSContext(), func);

    if (JS_IsException(result)) {
        ES_LOG_ERROR("Exception during method call: {}", methodName);
        JS_FreeValue(ctx_->getJSContext(), result);
        return ScriptValue::undefined(*ctx_);
    }

    return ScriptValue(*ctx_, result);
#else
    (void)methodName;
    (void)args;
    return ScriptValue(*ctx_);
#endif
}

// =============================================================================
// Utilities
// =============================================================================

ScriptValue ScriptValue::clone() const {
#ifdef ES_SCRIPTING_ENABLED
    return ScriptValue(*ctx_, JS_DupValue(ctx_->getJSContext(), value_));
#else
    return ScriptValue(*ctx_);
#endif
}

}  // namespace esengine
