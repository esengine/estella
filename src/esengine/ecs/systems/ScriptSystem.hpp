/**
 * @file    ScriptSystem.hpp
 * @brief   System for executing JavaScript scripts attached to entities
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#pragma once

#include "../System.hpp"
#include "../components/Script.hpp"
#include "../../scripting/ScriptContext.hpp"

namespace esengine::ecs {

/**
 * @brief System that manages and executes JavaScript scripts on entities
 *
 * @details This system:
 *          - Loads scripts from files or inline source
 *          - Instantiates JavaScript class instances for each entity
 *          - Calls lifecycle methods (onInit, onUpdate, onDestroy)
 *          - Handles errors without crashing the engine
 *          - Supports persistent variables across frames
 */
class ScriptSystem : public System {
public:
    /**
     * @brief Construct a new Script System
     * @param scriptContext Reference to the global script context
     */
    explicit ScriptSystem(ScriptContext& scriptContext);

    /**
     * @brief Initialize the script system
     * @param registry The ECS registry
     *
     * @details Loads all scripts and calls their onInit methods
     */
    void init(Registry& registry) override;

    /**
     * @brief Update all script components
     * @param registry The ECS registry
     * @param deltaTime Time since last frame in seconds
     *
     * @details Calls onUpdate(deltaTime) on all enabled scripts
     */
    void update(Registry& registry, f32 deltaTime) override;

    /**
     * @brief Shutdown the script system
     * @param registry The ECS registry
     *
     * @details Calls onDestroy on all scripts and cleans up resources
     */
    void shutdown(Registry& registry) override;

private:
    /**
     * @brief Load a script from file or source
     * @param entity The target entity
     * @param script The script component to load
     * @param registry The ECS registry for passing to script constructor
     */
    void loadScript(Entity entity, ScriptComponent& script, Registry& registry);

    /**
     * @brief Call a JavaScript function on a script instance
     * @param script The script component
     * @param funcName Name of the function to call
     * @param args Arguments to pass to the function
     * @return true if call succeeded, false if error occurred
     */
    bool callScriptFunction(ScriptComponent& script,
                           const std::string& funcName,
                           const std::vector<ScriptValue>& args = {});

#ifdef ES_SCRIPTING_ENABLED
    /**
     * @brief Clean up JavaScript resources for a script
     * @param script The script component to clean up
     */
    void cleanupScript(ScriptComponent& script);
#endif

    ScriptContext& scriptContext_;  ///< Reference to global script context
};

}  // namespace esengine::ecs
