/**
 * @file    ESEngine.hpp
 * @brief   Main header file for ESEngine - includes all public API
 * @details ESEngine is a lightweight game engine designed for WebAssembly
 *          and WeChat MiniGames. This umbrella header provides convenient
 *          access to all engine subsystems.
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

// Core
#include "core/Types.hpp"
#include "core/Log.hpp"
#include "core/Engine.hpp"

// App Framework
#include "app/App.hpp"

// Math
#include "math/Math.hpp"

// Resource
#include "resource/Handle.hpp"

// ECS
#include "ecs/Entity.hpp"
#include "ecs/Component.hpp"
#include "ecs/System.hpp"
#include "ecs/SparseSet.hpp"
#include "ecs/View.hpp"
#include "ecs/Registry.hpp"
#include "ecs/TransformSystem.hpp"

// Renderer
#include "renderer/Buffer.hpp"
#include "renderer/Shader.hpp"
#include "renderer/Texture.hpp"
#include "renderer/RenderCommand.hpp"
#include "renderer/Renderer.hpp"

// Platform
#include "platform/Platform.hpp"
#include "platform/input/Input.hpp"

// =============================================================================
// Version Information
// =============================================================================

/** @brief Major version number */
#define ESENGINE_VERSION_MAJOR 0
/** @brief Minor version number */
#define ESENGINE_VERSION_MINOR 1
/** @brief Patch version number */
#define ESENGINE_VERSION_PATCH 0
/** @brief Full version string */
#define ESENGINE_VERSION_STRING "0.1.0"

// =============================================================================
// Entry Point Macro
// =============================================================================

/**
 * @brief Entry point macro for App-based applications
 *
 * @param SetupFunc A function void(esengine::App&) that configures the App
 *
 * @code
 * void setup(esengine::App& app) {
 *     app.setConfig({.title = "My Game", .width = 1280, .height = 720});
 *     app.addPlugin<MyPlugin>();
 *     app.addSystem(esengine::Schedule::Update, myUpdateSystem);
 * }
 * ES_APP_MAIN(setup)
 * @endcode
 */
#ifdef ES_PLATFORM_WEB
    #include <emscripten.h>
    #define ES_APP_MAIN(SetupFunc)                              \
        extern "C" {                                            \
            EMSCRIPTEN_KEEPALIVE void es_app_init() {           \
                static esengine::App app;                       \
                SetupFunc(app);                                 \
                app.run();                                      \
            }                                                   \
        }
#else
    #define ES_APP_MAIN(SetupFunc)                              \
        int main(int argc, char** argv) {                       \
            (void)argc; (void)argv;                             \
            esengine::App app;                                  \
            SetupFunc(app);                                     \
            app.run();                                          \
            return 0;                                           \
        }
#endif
