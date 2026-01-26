/**
 * @file    ScriptContext.cpp
 * @brief   JavaScript scripting context implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "ScriptContext.hpp"
#include "../core/Log.hpp"

#include <fstream>
#include <sstream>

namespace esengine {

ScriptContext::~ScriptContext() {
    if (initialized_) {
        shutdown();
    }
}

bool ScriptContext::init() {
    if (initialized_) {
        ES_LOG_WARN("ScriptContext already initialized");
        return true;
    }

#ifdef ES_SCRIPTING_ENABLED
    // Create QuickJS runtime
    rt_ = JS_NewRuntime();
    if (!rt_) {
        lastError_ = "Failed to create QuickJS runtime";
        ES_LOG_ERROR("{}", lastError_);
        return false;
    }

    // Create JavaScript context
    ctx_ = JS_NewContext(rt_);
    if (!ctx_) {
        lastError_ = "Failed to create QuickJS context";
        ES_LOG_ERROR("{}", lastError_);
        JS_FreeRuntime(rt_);
        rt_ = nullptr;
        return false;
    }

    initialized_ = true;
    ES_LOG_INFO("ScriptContext initialized (QuickJS)");
    return true;
#else
    lastError_ = "Scripting not enabled on this platform";
    ES_LOG_WARN("{}", lastError_);
    return false;
#endif
}

void ScriptContext::shutdown() {
    if (!initialized_) {
        return;
    }

#ifdef ES_SCRIPTING_ENABLED
    if (ctx_) {
        JS_FreeContext(ctx_);
        ctx_ = nullptr;
    }

    if (rt_) {
        JS_FreeRuntime(rt_);
        rt_ = nullptr;
    }

    ES_LOG_INFO("ScriptContext shutdown");
#endif

    initialized_ = false;
    lastError_.clear();
}

bool ScriptContext::evalString(const std::string& code, const std::string& filename) {
    if (!initialized_) {
        lastError_ = "ScriptContext not initialized";
        ES_LOG_ERROR("{}", lastError_);
        return false;
    }

    clearError();

#ifdef ES_SCRIPTING_ENABLED
    // Execute JavaScript code
    JSValue result = JS_Eval(
        ctx_,
        code.c_str(),
        code.size(),
        filename.c_str(),
        JS_EVAL_TYPE_GLOBAL
    );

    // Check for exceptions
    if (JS_IsException(result)) {
        captureException();
        JS_FreeValue(ctx_, result);
        return false;
    }

    // Free result value
    JS_FreeValue(ctx_, result);

    ES_LOG_DEBUG("Script executed: {}", filename);
    return true;
#else
    lastError_ = "Scripting not enabled on this platform";
    return false;
#endif
}

bool ScriptContext::evalFile(const std::string& path) {
    if (!initialized_) {
        lastError_ = "ScriptContext not initialized";
        ES_LOG_ERROR("{}", lastError_);
        return false;
    }

    // Read file contents
    std::ifstream file(path, std::ios::in | std::ios::binary);
    if (!file.is_open()) {
        lastError_ = "Failed to open script file: " + path;
        ES_LOG_ERROR("{}", lastError_);
        return false;
    }

    std::stringstream buffer;
    buffer << file.rdbuf();
    std::string code = buffer.str();

    if (code.empty()) {
        lastError_ = "Script file is empty: " + path;
        ES_LOG_WARN("{}", lastError_);
        return false;
    }

    // Execute code with file path as filename
    return evalString(code, path);
}

#ifdef ES_SCRIPTING_ENABLED
void ScriptContext::captureException() {
    if (!ctx_) {
        lastError_ = "No context available";
        return;
    }

    // Get exception object
    JSValue exception = JS_GetException(ctx_);
    if (JS_IsNull(exception)) {
        lastError_ = "Unknown JavaScript error";
        JS_FreeValue(ctx_, exception);
        return;
    }

    // Convert exception to string
    const char* errorStr = JS_ToCString(ctx_, exception);
    if (errorStr) {
        lastError_ = errorStr;
        JS_FreeCString(ctx_, errorStr);
    } else {
        lastError_ = "Failed to convert exception to string";
    }

    // Try to get stack trace if available
    JSValue stack = JS_GetPropertyStr(ctx_, exception, "stack");
    if (!JS_IsUndefined(stack)) {
        const char* stackStr = JS_ToCString(ctx_, stack);
        if (stackStr) {
            lastError_ += "\nStack trace:\n";
            lastError_ += stackStr;
            JS_FreeCString(ctx_, stackStr);
        }
        JS_FreeValue(ctx_, stack);
    }

    JS_FreeValue(ctx_, exception);

    ES_LOG_ERROR("JavaScript error: {}", lastError_);
}
#endif

}  // namespace esengine
