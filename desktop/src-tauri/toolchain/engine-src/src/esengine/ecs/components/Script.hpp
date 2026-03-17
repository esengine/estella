/**
 * @file    Script.hpp
 * @brief   Script component for attaching JavaScript behaviors to entities
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#pragma once

#include "../../core/Types.hpp"
#include <string>
#include <any>
#include <unordered_map>

#ifdef ES_SCRIPTING_ENABLED
    #include <quickjs.h>
#endif

namespace esengine::ecs {

/**
 * @brief Component for attaching JavaScript scripts to entities
 *
 * @details Scripts can be loaded from files or provided as inline source code.
 *          Each script should export a class with lifecycle methods:
 *          - constructor(entity, registry): Initialize script instance
 *          - onInit(): Called once when script is loaded
 *          - onUpdate(deltaTime): Called every frame
 *          - onDestroy(): Called when entity is destroyed
 */
struct ScriptComponent {
    std::string scriptPath;          ///< Path to JavaScript file (if loading from file)
    std::string scriptSource;        ///< Inline JavaScript source code
    bool enabled = true;             ///< Whether the script should execute

#ifdef ES_SCRIPTING_ENABLED
    JSValue instance = JS_UNDEFINED; ///< JavaScript object instance
    JSValue onInitFunc = JS_UNDEFINED;    ///< Cached onInit function
    JSValue onUpdateFunc = JS_UNDEFINED;  ///< Cached onUpdate function
    JSValue onDestroyFunc = JS_UNDEFINED; ///< Cached onDestroy function
#endif

    bool isLoaded = false;           ///< Whether the script has been loaded
    std::string lastError;           ///< Last error message (if any)

    /**
     * @brief Persistent variables that survive between frames
     * @details These are stored in C++ and restored to the JavaScript context each frame
     */
    std::unordered_map<std::string, std::any> persistentVariables;
};

}  // namespace esengine::ecs
