/**
 * @file    ScriptContext.hpp
 * @brief   JavaScript scripting context wrapper for QuickJS
 * @details Provides RAII-based JavaScript runtime management for native platforms.
 *          Web platforms use Emscripten bindings instead.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

#include "../core/Types.hpp"
#include <string>

#ifdef ES_SCRIPTING_ENABLED
    #include <quickjs.h>
#endif

namespace esengine {

/**
 * @brief JavaScript execution context using QuickJS
 *
 * @details Manages QuickJS runtime and context lifecycle. Only available
 *          on native platforms (Windows/Linux/macOS). Web platforms use
 *          browser's native JavaScript engine via Emscripten bindings.
 *
 * Usage:
 * @code
 * ScriptContext ctx;
 * ctx.init();
 * if (ctx.evalString("console.log('Hello from JavaScript!')")) {
 *     // Script executed successfully
 * } else {
 *     ES_LOG_ERROR("Script error: {}", ctx.getLastError());
 * }
 * ctx.shutdown();
 * @endcode
 */
class ScriptContext {
public:
    ScriptContext() = default;
    ~ScriptContext();

    ScriptContext(const ScriptContext&) = delete;
    ScriptContext& operator=(const ScriptContext&) = delete;

    /**
     * @brief Initialize JavaScript runtime and context
     * @return true if successful, false on error
     */
    bool init();

    /**
     * @brief Shutdown JavaScript runtime and free resources
     */
    void shutdown();

    /**
     * @brief Execute JavaScript code from a file
     * @param path File path to JavaScript source
     * @return true if execution succeeded, false on error
     */
    bool evalFile(const std::string& path);

    /**
     * @brief Execute JavaScript code from a string
     * @param code JavaScript source code
     * @param filename Optional filename for error messages (default: "<eval>")
     * @return true if execution succeeded, false on error
     */
    bool evalString(const std::string& code, const std::string& filename = "<eval>");

    /**
     * @brief Get last error message
     * @return Error string, empty if no error
     */
    std::string getLastError() const { return lastError_; }

    /**
     * @brief Check if an error occurred
     * @return true if there's an error, false otherwise
     */
    bool hasError() const { return !lastError_.empty(); }

    /**
     * @brief Clear error state
     */
    void clearError() { lastError_.clear(); }

    /**
     * @brief Check if context is initialized
     * @return true if initialized, false otherwise
     */
    bool isInitialized() const { return initialized_; }

#ifdef ES_SCRIPTING_ENABLED
    /**
     * @brief Get QuickJS context (for advanced bindings)
     * @return JSContext pointer or nullptr if not initialized
     */
    JSContext* getJSContext() { return ctx_; }

    /**
     * @brief Get QuickJS runtime (for advanced bindings)
     * @return JSRuntime pointer or nullptr if not initialized
     */
    JSRuntime* getJSRuntime() { return rt_; }
#endif

private:
    /**
     * @brief Extract error message from QuickJS exception
     */
    void captureException();

    bool initialized_ = false;
    std::string lastError_;

#ifdef ES_SCRIPTING_ENABLED
    JSRuntime* rt_ = nullptr;
    JSContext* ctx_ = nullptr;
#endif
};

}  // namespace esengine
