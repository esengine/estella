cmake_minimum_required(VERSION 3.16)
project(ESEngine VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(ES_BUILD_WEB "Build for Web/Emscripten" OFF)
option(ES_BUILD_WXGAME "Build for WeChat MiniGame" OFF)
option(ES_BUILD_TESTS "Build tests" ON)
option(ES_ENABLE_SPINE "Enable Spine animation support" ON)
# OFF by default: only the DragonBones side module turns it on, and nothing in the
# main engine links it (see third_party/CMakeLists.txt).
option(ES_ENABLE_DRAGONBONES "Build the DragonBones runtime (side module only)" OFF)
option(ES_ENABLE_BOX2D "Enable Box2D physics support" OFF)
option(ES_ENABLE_TILEMAP "Enable Tilemap support" ON)
option(ES_ENABLE_PARTICLES "Enable Particle system" ON)
option(ES_ENABLE_POSTPROCESS "Enable Post-processing pipeline" ON)
option(ES_ENABLE_BITMAP_TEXT "Enable Bitmap text rendering" ON)
# WebGPU render backend: compiles WebGPUDevice into the engine and pulls the
# emdawnwebgpu port (Dawn's webgpu.h + JS glue) into every SDK executable.
# ON for the web build; stays OFF for WeChat/playable (no WebGPU there, and
# the port's JS glue would only cost size). The web-tests build also leaves it
# OFF — its harness targets compile WebGPUDevice.cpp into themselves.
option(ES_ENABLE_WEBGPU "Enable the WebGPU render backend (emdawnwebgpu port)" OFF)
option(ES_ENABLE_BASIS "Build the Basis Universal KTX2 transcoder module" OFF)
option(ES_BUILD_MAIN_MODULE "Build as MAIN_MODULE for dynamic linking" OFF)
option(ES_BUILD_SIDE_MODULE "Build side modules for dynamic linking" OFF)
# The physics standalone module ships in two JS-glue flavours from the same wasm:
# the default require()-style module (WeChat host) and an ES6 variant imported like
# esengine.js (web editor's estella:// import-map host). They share OUTPUT_NAME
# "physics", so exactly one may exist per configure — pick the ESM flavour here.
option(ES_PHYSICS_ESM "Emit the physics module as an ES6 module (web) instead of require()-style (WeChat)" OFF)

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")
include(ESEngineConfig)
include(CompilerCache)

if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
    include(Emscripten)
endif()

add_subdirectory(third_party)

# =============================================================================
# ESEngine Library
# =============================================================================

# The engine source list lives in one place — cmake/ESEngineSources.cmake — shared
# with the native build (native/CMakeLists.txt) so the two never drift. It appends
# the sources the ES_* options select (GLDevice is web/WeChat only; text is under
# ES_ENABLE_BITMAP_TEXT).
set(ESENGINE_ROOT ${CMAKE_CURRENT_SOURCE_DIR})
include(ESEngineSources)


set(ESENGINE_HEADERS
    src/esengine/ESEngine.hpp
    src/esengine/core/Types.hpp
    src/esengine/core/Log.hpp
    src/esengine/core/Reflection.hpp
    src/esengine/core/ServiceRegistry.hpp
    src/esengine/ecs/Entity.hpp
    src/esengine/ecs/ComponentMask.hpp
    src/esengine/ecs/Component.hpp
    src/esengine/ecs/System.hpp
    src/esengine/ecs/Registry.hpp
    src/esengine/ecs/SparseSet.hpp
    src/esengine/ecs/View.hpp
    src/esengine/ecs/TransformSystem.hpp
    src/esengine/ecs/components/Transform.hpp
    src/esengine/ecs/components/Hierarchy.hpp
    src/esengine/ecs/components/Sprite.hpp
    src/esengine/ecs/components/Camera.hpp
    src/esengine/ecs/components/Velocity.hpp
    src/esengine/ecs/components/Common.hpp
    src/esengine/ecs/components/SpineAnimation.hpp
    src/esengine/ecs/components/BitmapText.hpp
    src/esengine/math/Math.hpp
    src/esengine/resource/Handle.hpp
    src/esengine/resource/ResourcePool.hpp
    src/esengine/resource/ResourceManager.hpp
    src/esengine/renderer/RenderContext.hpp
    src/esengine/renderer/Shader.hpp
    src/esengine/renderer/Buffer.hpp
    src/esengine/renderer/Texture.hpp
    src/esengine/renderer/Framebuffer.hpp
    src/esengine/renderer/RenderStage.hpp
    src/esengine/renderer/RenderItem.hpp
    src/esengine/renderer/plugins/TrailPlugin.hpp
    src/esengine/trail/TrailSystem.hpp
    src/esengine/ecs/components/TrailRenderer.hpp
    src/esengine/renderer/RenderTarget.hpp
    src/esengine/renderer/RenderFrame.hpp
    src/esengine/renderer/ImmediateDraw.hpp
    src/esengine/renderer/BlendMode.hpp
    src/esengine/renderer/CustomGeometry.hpp
    src/esengine/renderer/GfxEnums.hpp
    src/esengine/renderer/GfxDevice.hpp
    src/esengine/renderer/GLDevice.hpp
    src/esengine/renderer/TransientBufferPool.hpp
    src/esengine/renderer/DrawCommand.hpp
    src/esengine/renderer/DrawList.hpp
    src/esengine/renderer/ClipState.hpp
    src/esengine/renderer/FrameConstants.hpp
    src/esengine/renderer/PipelineState.hpp
    src/esengine/renderer/BatchBuilder.hpp
    src/esengine/renderer/RenderTypePlugin.hpp
    src/esengine/renderer/plugins/BatchPlugin.hpp
    src/esengine/renderer/plugins/SpritePlugin.hpp
    src/esengine/renderer/plugins/UIElementPlugin.hpp
    src/esengine/renderer/plugins/TextPlugin.hpp
    src/esengine/renderer/plugins/ShapePlugin.hpp
    src/esengine/platform/FileSystem.hpp
    src/esengine/events/Events.hpp
    src/esengine/events/Connection.hpp
    src/esengine/events/Signal.hpp
    src/esengine/events/Sink.hpp
    src/esengine/events/Dispatcher.hpp
    src/esengine/animation/TweenData.hpp
    src/esengine/animation/EasingFunctions.hpp
    src/esengine/animation/TweenSystem.hpp
)

if(ES_ENABLE_POSTPROCESS)
    list(APPEND ESENGINE_HEADERS
        src/esengine/renderer/PostProcessPipeline.hpp
    )
endif()

if(ES_ENABLE_TILEMAP)
    list(APPEND ESENGINE_HEADERS
        src/esengine/renderer/plugins/TilemapRenderPlugin.hpp
        src/esengine/tilemap/TilemapSystem.hpp
    )
endif()

if(ES_ENABLE_PARTICLES)
    list(APPEND ESENGINE_HEADERS
        src/esengine/renderer/plugins/ParticlePlugin.hpp
        src/esengine/particle/ParticleSystem.hpp
    )
endif()

    list(APPEND ESENGINE_HEADERS
        src/esengine/text/BitmapFont.hpp
        src/esengine/text/SdfGenerator.hpp
    )


list(APPEND ESENGINE_HEADERS
    src/esengine/ecs/components/RigidBody.hpp
    src/esengine/ecs/components/Collider.hpp
)

set(GENERATED_WEB_BINDINGS "${CMAKE_CURRENT_SOURCE_DIR}/src/esengine/bindings/WebBindings.generated.cpp")
set(GENERATED_EDITOR_API "${CMAKE_CURRENT_SOURCE_DIR}/src/esengine/bindings/EditorAPI.generated.cpp")
set(GENERATED_TS_DEFINITIONS "${CMAKE_CURRENT_SOURCE_DIR}/sdk/src/wasm.generated.ts")

list(APPEND ESENGINE_SOURCES
    src/esengine/platform/web/WebFileSystem.cpp
)

# =============================================================================
# EHT - ESEngine Header Tool
# =============================================================================

find_package(Python3 COMPONENTS Interpreter)

if(Python3_FOUND)
    file(GLOB_RECURSE COMPONENT_HEADERS
        "${CMAKE_CURRENT_SOURCE_DIR}/src/esengine/ecs/components/*.hpp"
    )

    add_custom_command(
        OUTPUT ${GENERATED_WEB_BINDINGS} ${GENERATED_TS_DEFINITIONS}
        COMMAND ${Python3_EXECUTABLE}
            "${CMAKE_CURRENT_SOURCE_DIR}/tools/eht.py"
            --input "${CMAKE_CURRENT_SOURCE_DIR}/src/esengine/ecs/components"
            --output "${CMAKE_CURRENT_SOURCE_DIR}/src/esengine/bindings"
            --ts-output "${CMAKE_CURRENT_SOURCE_DIR}/sdk/src"
        DEPENDS ${COMPONENT_HEADERS} "${CMAKE_CURRENT_SOURCE_DIR}/tools/eht.py"
        WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
        COMMENT "Running EHT..."
        VERBATIM
    )

    add_custom_target(eht DEPENDS ${GENERATED_WEB_BINDINGS} ${GENERATED_TS_DEFINITIONS})
    message(STATUS "EHT: ENABLED")
else()
    message(WARNING "Python3 not found - EHT DISABLED")
endif()

add_library(esengine STATIC ${ESENGINE_SOURCES} ${ESENGINE_HEADERS})

if(Python3_FOUND)
    add_dependencies(esengine eht)
endif()

target_include_directories(esengine
    PUBLIC
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/src>
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/third_party/stb>
        $<INSTALL_INTERFACE:include>
    PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/src
        ${CMAKE_CURRENT_SOURCE_DIR}/third_party/stb
)

target_link_libraries(esengine PUBLIC glm yogacore)

if(ES_ENABLE_TILEMAP)
    target_compile_definitions(esengine PUBLIC ES_ENABLE_TILEMAP)
endif()

if(ES_ENABLE_PARTICLES)
    target_compile_definitions(esengine PUBLIC ES_ENABLE_PARTICLES)
endif()


if(ES_ENABLE_POSTPROCESS)
    target_compile_definitions(esengine PUBLIC ES_ENABLE_POSTPROCESS)
endif()

if(ES_ENABLE_WEBGPU)
    target_compile_definitions(esengine PUBLIC ES_ENABLE_WEBGPU)
    # PUBLIC: the port supplies webgpu.h at compile time and its JS glue at
    # link time — every SDK executable linking the engine needs both sides.
    target_compile_options(esengine PUBLIC --use-port=emdawnwebgpu)
    target_link_options(esengine PUBLIC --use-port=emdawnwebgpu)
endif()

if(ES_ENABLE_BITMAP_TEXT)
    target_compile_definitions(esengine PUBLIC ES_ENABLE_BITMAP_TEXT)
endif()

if(ES_ENABLE_SPINE)
    # Core links no spine runtime — spine is fully side-module (spine{NN}.wasm).
    # ES_ENABLE_SPINE still gates the renderer's spine RenderItem plumbing and the
    # side-module mesh-submit binding (renderer_submitSpineBatch).
    target_compile_definitions(esengine PUBLIC ES_ENABLE_SPINE)
endif()

# ESEngine is a web-only engine: it targets Emscripten (WebGL2 / GLES3) and ships
# as wasm for web, WeChat MiniGame, and the Tauri desktop shell. There is no native
# GPU/runtime build. (The header-only / MockGfxDevice unit tests under tests/ still
# compile on any C++20 toolchain — they don't link this target.)
target_compile_options(esengine PRIVATE ${ES_EMSCRIPTEN_COMPILE_FLAGS})
target_compile_definitions(esengine PUBLIC ES_PLATFORM_WEB)
if(ES_BUILD_WXGAME)
    target_compile_definitions(esengine PUBLIC ES_PLATFORM_WXGAME)
endif()

esengine_set_strict_warnings(esengine)

# =============================================================================
# Web SDK
# =============================================================================

if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
    set(SDK_BINDING_SOURCES
        src/esengine/bindings/WebSDKEntry.cpp
        src/esengine/bindings/EngineContext.cpp
        src/esengine/bindings/ResourceManagerBindings.cpp
        src/esengine/bindings/RendererBindings.cpp
        src/esengine/bindings/UIBindings.cpp
        src/esengine/bindings/ImmediateDrawBindings.cpp
        src/esengine/bindings/GeometryBindings.cpp
        src/esengine/bindings/AnimationBindings.cpp
        src/esengine/bindings/MaterialBindings.cpp
        ${GENERATED_WEB_BINDINGS}
        ${GENERATED_EDITOR_API}
    )
    if(ES_ENABLE_POSTPROCESS)
        list(APPEND SDK_BINDING_SOURCES src/esengine/bindings/PostProcessBindings.cpp)
    endif()
    if(ES_ENABLE_TILEMAP)
        list(APPEND SDK_BINDING_SOURCES src/esengine/bindings/TilemapBindings.cpp)
    endif()

    add_executable(esengine_sdk ${SDK_BINDING_SOURCES})
    target_link_libraries(esengine_sdk PRIVATE esengine)
    es_apply_sdk_settings(esengine_sdk)

    set_target_properties(esengine_sdk PROPERTIES
        OUTPUT_NAME "esengine"
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/sdk"
    )

    # Core-only SDK (no Spine, for modular builds)
    if(NOT ES_ENABLE_SPINE)
        set_target_properties(esengine_sdk PROPERTIES
            OUTPUT_NAME "esengine-core"
        )
    endif()

    # WeChat MiniGame SDK (CommonJS compatible)
    if(ES_BUILD_WXGAME)
        add_executable(esengine_wxgame ${SDK_BINDING_SOURCES})
        target_link_libraries(esengine_wxgame PRIVATE esengine)
        es_apply_wxgame_sdk_settings(esengine_wxgame)

        set_target_properties(esengine_wxgame PROPERTIES
            OUTPUT_NAME "esengine.wxgame"
            RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/sdk"
        )
    endif()

    # One standalone WASM module per vendored Spine release: same exported ABI
    # (SpineBindings.hpp), a different runtime backend behind it. Everything that
    # varies is the vendored tree's own shape, so the modules are one function
    # rather than one copied block each.
    if(ES_ENABLE_SPINE)
        es_add_spine_module(spine_module    4.2 spine42)
        es_add_spine_module(spine_module_43 4.3 spine43)
        es_add_spine_module(spine_module_41 4.1 spine41)
        es_add_spine_module(spine_module_38 3.8 spine38)
        es_add_spine_module(spine_module_21 2.1 spine21)
    endif()

    # DragonBones: one module, not one per version. Its authoring tool is no
    # longer developed, so the format cannot move and there is nothing to track.
    if(ES_ENABLE_DRAGONBONES)
        add_library(dragonbones_adapter STATIC
            src/esengine/bindings/DragonBonesAdapter.cpp
        )
        target_link_libraries(dragonbones_adapter PUBLIC dragonbones)
        target_include_directories(dragonbones_adapter PUBLIC
            ${CMAKE_CURRENT_SOURCE_DIR}/src/esengine/bindings
        )
        if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
            target_compile_options(dragonbones_adapter PRIVATE ${ES_EMSCRIPTEN_COMPILE_FLAGS})
        endif()
    endif()

    # Basis Universal KTX2 transcoder module (compressed textures — RC6)
    if(ES_ENABLE_BASIS)
        add_executable(basis_module
            src/esengine/bindings/BasisModuleEntry.cpp
            third_party/basis_universal/transcoder/basisu_transcoder.cpp
        )
        target_include_directories(basis_module PRIVATE
            ${CMAKE_CURRENT_SOURCE_DIR}/third_party/basis_universal/transcoder
        )
        # ETC1S works without zstd; disabling it avoids the zstd dependency. UASTC
        # assets must then be encoded without zstd supercompression.
        target_compile_definitions(basis_module PRIVATE
            BASISD_SUPPORT_KTX2=1
            BASISD_SUPPORT_KTX2_ZSTD=0
        )
        es_apply_basis_module_settings(basis_module)
        set_target_properties(basis_module PROPERTIES
            OUTPUT_NAME "basis"
            RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/sdk"
        )
    endif()

    # MPEG-1 video decoder module (pl_mpeg) — the engine-owned software decode
    # path behind the wasm video backend (WeChat / headless).
    if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/third_party/pl_mpeg")
        add_executable(video_module
            src/esengine/bindings/VideoModuleEntry.cpp
        )
        target_include_directories(video_module PRIVATE
            ${CMAKE_CURRENT_SOURCE_DIR}/third_party/pl_mpeg
        )
        es_apply_video_module_settings(video_module)
        set_target_properties(video_module PROPERTIES
            OUTPUT_NAME "videodec"
            RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/sdk"
        )
    endif()

    # Physics standalone WASM module. The require()-style and ES6 flavours both emit
    # sdk/physics.{js,wasm} from identical sources, so only one may be defined per
    # configure (ES_PHYSICS_ESM selects which) — defining both makes Ninja error with
    # "multiple rules generate sdk/physics.js".
    if(ES_ENABLE_BOX2D)
        set(ES_PHYSICS_SOURCES
            src/esengine/bindings/PhysicsModuleEntry.cpp
            src/esengine/bindings/PhysicsReadback.cpp
            src/esengine/bindings/PhysicsContext.cpp
            src/esengine/bindings/PhysicsShapes.cpp
            src/esengine/bindings/PhysicsJoints.cpp
            src/esengine/bindings/PhysicsQueries.cpp
            src/esengine/bindings/PhysicsTaskPool.cpp
        )
        if(ES_PHYSICS_ESM)
            # ESM variant (EXPORT_ES6=1) for the web editor's estella:// ESM host —
            # imported like esengine.js. Same sources/wasm, no dynamic linking.
            add_executable(physics_module_esm ${ES_PHYSICS_SOURCES})
            target_link_libraries(physics_module_esm PRIVATE box2d)
            target_include_directories(physics_module_esm PRIVATE
                ${CMAKE_CURRENT_SOURCE_DIR}/third_party/box2d/include
            )
            es_apply_physics_esm_module_settings(physics_module_esm)
            set_target_properties(physics_module_esm PROPERTIES
                OUTPUT_NAME "physics"
                RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/sdk"
            )
        else()
            add_executable(physics_module ${ES_PHYSICS_SOURCES})
            target_link_libraries(physics_module PRIVATE box2d)
            target_include_directories(physics_module PRIVATE
                ${CMAKE_CURRENT_SOURCE_DIR}/third_party/box2d/include
            )
            es_apply_physics_module_settings(physics_module)
            set_target_properties(physics_module PROPERTIES
                OUTPUT_NAME "physics"
                RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/sdk"
            )
        endif()
    endif()

    # Main module SDK (MAIN_MODULE=2, supports loading side modules)
    if(ES_BUILD_MAIN_MODULE)
        add_executable(esengine_sdk_main ${SDK_BINDING_SOURCES})
        target_link_libraries(esengine_sdk_main PRIVATE esengine)
        es_apply_main_module_settings(esengine_sdk_main)
        set_target_properties(esengine_sdk_main PROPERTIES
            OUTPUT_NAME "esengine"
            RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/sdk"
        )

        if(ES_BUILD_WXGAME)
            add_executable(esengine_wxgame_main ${SDK_BINDING_SOURCES})
            target_link_libraries(esengine_wxgame_main PRIVATE esengine)
            es_apply_wxgame_main_module_settings(esengine_wxgame_main)
            set_target_properties(esengine_wxgame_main PROPERTIES
                OUTPUT_NAME "esengine.wxgame"
                RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/sdk"
            )
        endif()
    endif()

    # Physics side module (SIDE_MODULE=2, pure .wasm, no JS glue)
    if(ES_ENABLE_BOX2D AND ES_BUILD_SIDE_MODULE)
        add_executable(physics_side_module
            src/esengine/bindings/PhysicsModuleEntry.cpp
            src/esengine/bindings/PhysicsContext.cpp
            src/esengine/bindings/PhysicsShapes.cpp
            src/esengine/bindings/PhysicsJoints.cpp
            src/esengine/bindings/PhysicsQueries.cpp
            src/esengine/bindings/PhysicsTaskPool.cpp
        )
        target_link_libraries(physics_side_module PRIVATE box2d)
        target_include_directories(physics_side_module PRIVATE
            ${CMAKE_CURRENT_SOURCE_DIR}/third_party/box2d/include
        )
        es_apply_physics_side_module_settings(physics_side_module)
        set_target_properties(physics_side_module PROPERTIES
            OUTPUT_NAME "physics"
            RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/sdk"
        )
    endif()
endif()

if(ES_BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests)
endif()


install(TARGETS esengine
    EXPORT ESEngineTargets
    LIBRARY DESTINATION lib
    ARCHIVE DESTINATION lib
    RUNTIME DESTINATION bin
)

install(DIRECTORY src/esengine/ DESTINATION include/esengine FILES_MATCHING PATTERN "*.hpp")
