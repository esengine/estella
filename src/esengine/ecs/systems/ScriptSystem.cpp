/**
 * @file    ScriptSystem.cpp
 * @brief   Implementation of the script system
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "ScriptSystem.hpp"
#include "../Registry.hpp"
#include "../../core/Log.hpp"
#include "../../scripting/ScriptValue.hpp"

#ifdef ES_SCRIPTING_ENABLED
    #include <quickjs.h>
#endif

namespace esengine::ecs {

ScriptSystem::ScriptSystem(ScriptContext& scriptContext)
    : scriptContext_(scriptContext) {}

void ScriptSystem::init(Registry& registry) {
#ifdef ES_SCRIPTING_ENABLED
    if (!scriptContext_.isInitialized()) {
        ES_LOG_ERROR("ScriptSystem: ScriptContext not initialized");
        return;
    }

    // Load all scripts and call onInit
    registry.each<ScriptComponent>([this, &registry](Entity entity, ScriptComponent& script) {
        if (script.enabled && !script.isLoaded) {
            loadScript(entity, script, registry);

            if (script.isLoaded && !JS_IsUndefined(script.onInitFunc)) {
                callScriptFunction(script, "onInit");
            }
        }
    });

    ES_LOG_INFO("ScriptSystem initialized");
#else
    (void)registry;
    ES_LOG_WARN("ScriptSystem: Scripting not enabled on this platform");
#endif
}

void ScriptSystem::update(Registry& registry, f32 deltaTime) {
#ifdef ES_SCRIPTING_ENABLED
    if (!scriptContext_.isInitialized()) {
        return;
    }

    JSContext* ctx = scriptContext_.getJSContext();

    // Update all enabled scripts
    registry.each<ScriptComponent>([this, &registry, deltaTime, ctx](Entity entity, ScriptComponent& script) {
        if (!script.enabled) {
            return;
        }

        // Load script if not loaded yet
        if (!script.isLoaded) {
            loadScript(entity, script, registry);
            if (script.isLoaded && !JS_IsUndefined(script.onInitFunc)) {
                callScriptFunction(script, "onInit");
            }
        }

        // Call onUpdate if available
        if (script.isLoaded && !JS_IsUndefined(script.onUpdateFunc)) {
            // Create deltaTime argument
            JSValue dtArg = JS_NewFloat64(ctx, static_cast<f64>(deltaTime));

            // Call onUpdate(deltaTime)
            JSValue result = JS_Call(ctx, script.onUpdateFunc, script.instance, 1, &dtArg);
            JS_FreeValue(ctx, dtArg);

            if (JS_IsException(result)) {
                JSValue exception = JS_GetException(ctx);
                const char* errorStr = JS_ToCString(ctx, exception);
                if (errorStr) {
                    script.lastError = errorStr;
                    ES_LOG_ERROR("Script error in onUpdate: {}", errorStr);
                    JS_FreeCString(ctx, errorStr);
                }
                JS_FreeValue(ctx, exception);
                JS_FreeValue(ctx, result);
            } else {
                JS_FreeValue(ctx, result);
            }
        }
    });
#else
    (void)registry;
    (void)deltaTime;
#endif
}

void ScriptSystem::shutdown(Registry& registry) {
#ifdef ES_SCRIPTING_ENABLED
    if (!scriptContext_.isInitialized()) {
        return;
    }

    // Call onDestroy on all scripts
    registry.each<ScriptComponent>([this](Entity entity, ScriptComponent& script) {
        (void)entity;
        if (script.isLoaded && !JS_IsUndefined(script.onDestroyFunc)) {
            callScriptFunction(script, "onDestroy");
        }
        cleanupScript(script);
    });

    ES_LOG_INFO("ScriptSystem shutdown");
#else
    (void)registry;
#endif
}

void ScriptSystem::loadScript(Entity entity, ScriptComponent& script, Registry& registry) {
#ifdef ES_SCRIPTING_ENABLED
    if (!scriptContext_.isInitialized()) {
        script.lastError = "ScriptContext not initialized";
        return;
    }

    JSContext* ctx = scriptContext_.getJSContext();

    // Load script source
    std::string source;
    if (!script.scriptPath.empty()) {
        // Load from file
        if (!scriptContext_.evalFile(script.scriptPath)) {
            script.lastError = scriptContext_.getLastError();
            ES_LOG_ERROR("Failed to load script from {}: {}", script.scriptPath, script.lastError);
            return;
        }
        // Script file should define a class, we'll instantiate it below
    } else if (!script.scriptSource.empty()) {
        // Evaluate inline source
        if (!scriptContext_.evalString(script.scriptSource, "<inline>")) {
            script.lastError = scriptContext_.getLastError();
            ES_LOG_ERROR("Failed to evaluate inline script: {}", script.lastError);
            return;
        }
    } else {
        script.lastError = "No script source provided";
        ES_LOG_ERROR("ScriptComponent has no script path or source");
        return;
    }

    // Get global object
    JSValue global = JS_GetGlobalObject(ctx);

    // Assume script defines a class with the same name as the file (without extension)
    // Or for inline scripts, assume class is named "Script"
    std::string className = "Script";
    if (!script.scriptPath.empty()) {
        // Extract class name from file path (e.g., "player_controller.js" -> "PlayerController")
        usize lastSlash = script.scriptPath.find_last_of("/\\");
        usize lastDot = script.scriptPath.find_last_of('.');
        if (lastSlash != std::string::npos && lastDot != std::string::npos && lastDot > lastSlash) {
            className = script.scriptPath.substr(lastSlash + 1, lastDot - lastSlash - 1);
            // Convert snake_case to PascalCase (simple heuristic)
            if (!className.empty()) {
                className[0] = static_cast<char>(std::toupper(static_cast<u8>(className[0])));
            }
        }
    }

    // Get the class constructor
    JSValue classConstructor = JS_GetPropertyStr(ctx, global, className.c_str());
    JS_FreeValue(ctx, global);

    if (JS_IsUndefined(classConstructor) || !JS_IsFunction(ctx, classConstructor)) {
        script.lastError = "Class '" + className + "' not found in script";
        ES_LOG_ERROR("{}", script.lastError);
        JS_FreeValue(ctx, classConstructor);
        return;
    }

    // Create arguments for constructor: entity and registry
    JSValue entityArg = JS_NewUint32(ctx, static_cast<u32>(entity));
    JSValue registryArg = JS_GetGlobalObject(ctx);  // Registry is exposed globally
    JSValue registryObj = JS_GetPropertyStr(ctx, registryArg, "Registry");
    JS_FreeValue(ctx, registryArg);

    JSValue args[2] = {entityArg, registryObj};

    // Instantiate the class: new ClassName(entity, registry)
    script.instance = JS_CallConstructor(ctx, classConstructor, 2, args);
    JS_FreeValue(ctx, entityArg);
    JS_FreeValue(ctx, registryObj);
    JS_FreeValue(ctx, classConstructor);

    if (JS_IsException(script.instance)) {
        JSValue exception = JS_GetException(ctx);
        const char* errorStr = JS_ToCString(ctx, exception);
        if (errorStr) {
            script.lastError = errorStr;
            ES_LOG_ERROR("Failed to instantiate script class: {}", errorStr);
            JS_FreeCString(ctx, errorStr);
        }
        JS_FreeValue(ctx, exception);
        script.instance = JS_UNDEFINED;
        return;
    }

    // Cache lifecycle functions
    script.onInitFunc = JS_GetPropertyStr(ctx, script.instance, "onInit");
    script.onUpdateFunc = JS_GetPropertyStr(ctx, script.instance, "onUpdate");
    script.onDestroyFunc = JS_GetPropertyStr(ctx, script.instance, "onDestroy");

    script.isLoaded = true;
    ES_LOG_INFO("Successfully loaded script: {}", script.scriptPath.empty() ? "<inline>" : script.scriptPath);
#else
    (void)entity;
    (void)script;
    (void)registry;
#endif
}

bool ScriptSystem::callScriptFunction(ScriptComponent& script,
                                     const std::string& funcName,
                                     const std::vector<ScriptValue>& args) {
#ifdef ES_SCRIPTING_ENABLED
    if (!scriptContext_.isInitialized()) {
        return false;
    }

    JSContext* ctx = scriptContext_.getJSContext();

    // Get the function
    JSValue func = JS_GetPropertyStr(ctx, script.instance, funcName.c_str());
    if (JS_IsUndefined(func) || !JS_IsFunction(ctx, func)) {
        JS_FreeValue(ctx, func);
        return false;  // Function not defined, silently skip
    }

    // Prepare arguments
    std::vector<JSValue> jsArgs;
    jsArgs.reserve(args.size());
    for (const auto& arg : args) {
        // Note: ScriptValue doesn't expose JSValue directly yet
        // For now, we create arguments manually in the calling code
    }

    // Call the function
    JSValue result = JS_Call(ctx, func, script.instance,
                            static_cast<int>(jsArgs.size()),
                            jsArgs.empty() ? nullptr : jsArgs.data());
    JS_FreeValue(ctx, func);

    if (JS_IsException(result)) {
        JSValue exception = JS_GetException(ctx);
        const char* errorStr = JS_ToCString(ctx, exception);
        if (errorStr) {
            script.lastError = errorStr;
            ES_LOG_ERROR("Script error in {}: {}", funcName, errorStr);
            JS_FreeCString(ctx, errorStr);
        }
        JS_FreeValue(ctx, exception);
        JS_FreeValue(ctx, result);
        return false;
    }

    JS_FreeValue(ctx, result);
    return true;
#else
    (void)script;
    (void)funcName;
    (void)args;
    return false;
#endif
}

#ifdef ES_SCRIPTING_ENABLED
void ScriptSystem::cleanupScript(ScriptComponent& script) {
    if (!scriptContext_.isInitialized()) {
        return;
    }

    JSContext* ctx = scriptContext_.getJSContext();

    if (!JS_IsUndefined(script.instance)) {
        JS_FreeValue(ctx, script.instance);
        script.instance = JS_UNDEFINED;
    }

    if (!JS_IsUndefined(script.onInitFunc)) {
        JS_FreeValue(ctx, script.onInitFunc);
        script.onInitFunc = JS_UNDEFINED;
    }

    if (!JS_IsUndefined(script.onUpdateFunc)) {
        JS_FreeValue(ctx, script.onUpdateFunc);
        script.onUpdateFunc = JS_UNDEFINED;
    }

    if (!JS_IsUndefined(script.onDestroyFunc)) {
        JS_FreeValue(ctx, script.onDestroyFunc);
        script.onDestroyFunc = JS_UNDEFINED;
    }

    script.isLoaded = false;
}
#endif

}  // namespace esengine::ecs
