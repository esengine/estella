#pragma once

// ESEngine - Game Engine for WebAssembly and WeChat MiniGames
// Main header file - includes all public API

// Core
#include "core/Types.hpp"
#include "core/Log.hpp"
#include "core/Engine.hpp"
#include "core/Application.hpp"

// Math
#include "math/Math.hpp"

// ECS
#include "ecs/Entity.hpp"
#include "ecs/Component.hpp"
#include "ecs/System.hpp"
#include "ecs/SparseSet.hpp"
#include "ecs/View.hpp"
#include "ecs/Registry.hpp"

// Renderer
#include "renderer/Buffer.hpp"
#include "renderer/Shader.hpp"
#include "renderer/Texture.hpp"
#include "renderer/RenderCommand.hpp"
#include "renderer/Renderer.hpp"

// Platform
#include "platform/Platform.hpp"
#include "platform/input/Input.hpp"

// Version info
#define ESENGINE_VERSION_MAJOR 0
#define ESENGINE_VERSION_MINOR 1
#define ESENGINE_VERSION_PATCH 0
#define ESENGINE_VERSION_STRING "0.1.0"

// Entry point macro for applications
#ifdef ES_PLATFORM_WEB
    // Web: No main needed, entry is through es_init
    #define ES_MAIN(AppClass)                                   \
        extern "C" {                                            \
            static AppClass* g_app = nullptr;                   \
            EMSCRIPTEN_KEEPALIVE void es_app_init() {           \
                g_app = new AppClass();                         \
                g_app->run();                                   \
            }                                                   \
        }
#else
    // Native: Standard main
    #define ES_MAIN(AppClass)                                   \
        int main(int argc, char** argv) {                       \
            (void)argc; (void)argv;                             \
            AppClass app;                                       \
            app.run();                                          \
            return 0;                                           \
        }
#endif
