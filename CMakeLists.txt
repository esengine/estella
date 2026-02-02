cmake_minimum_required(VERSION 3.16)
project(ESEngine VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Build options
option(ES_BUILD_WEB "Build for Web/Emscripten" OFF)
option(ES_BUILD_WXGAME "Build for WeChat MiniGame" OFF)
option(ES_BUILD_TESTS "Build tests" ON)
option(ES_BUILD_EDITOR "Build editor (native only)" OFF)
option(ES_BUILD_MODULAR "Build modular WASM (Web only, dynamic linking)" OFF)

# Feature options (modular compilation)
option(ES_FEATURE_SDF_FONT "Enable SDF font rendering (requires FreeType)" OFF)
option(ES_FEATURE_BITMAP_FONT "Enable bitmap font rendering (lightweight)" OFF)

# Auto-configure font features based on build target
if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
    # Web/Mini-game: Force disable SDF font to reduce package size
    set(ES_FEATURE_SDF_FONT OFF CACHE BOOL "" FORCE)
    message(STATUS "Web build: SDF font disabled, using SystemFont")
elseif(ES_BUILD_EDITOR)
    # Editor: Enable SDF font by default for better quality
    if(NOT DEFINED CACHE{ES_FEATURE_SDF_FONT} OR NOT ES_FEATURE_SDF_FONT)
        set(ES_FEATURE_SDF_FONT ON CACHE BOOL "" FORCE)
        message(STATUS "Editor build: SDF font enabled")
    endif()
endif()

# Include custom CMake modules
list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")
include(ESEngineConfig)

if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
    include(Emscripten)
endif()

# Modular build configuration (dynamic linking for Web)
if(ES_BUILD_MODULAR AND ES_BUILD_WEB)
    include(ModularBuild)
endif()

# Third party libraries
add_subdirectory(third_party)

# ESEngine library
set(ESENGINE_SOURCES
    src/esengine/core/Application.cpp
    src/esengine/core/Engine.cpp
    src/esengine/core/Log.cpp
    src/esengine/app/App.cpp
    src/esengine/resource/ResourceManager.cpp
    src/esengine/resource/ShaderParser.cpp
    src/esengine/resource/LoaderJobQueue.cpp
    src/esengine/resource/HotReloadManager.cpp
    src/esengine/resource/loaders/ShaderLoader.cpp
    src/esengine/renderer/RenderContext.cpp
    src/esengine/renderer/Renderer.cpp
    src/esengine/renderer/Shader.cpp
    src/esengine/renderer/Buffer.cpp
    src/esengine/renderer/Texture.cpp
    src/esengine/renderer/Framebuffer.cpp
    src/esengine/renderer/RenderPipeline.cpp
    src/esengine/renderer/stb_image_impl.cpp
    src/esengine/platform/input/Input.cpp
    src/esengine/platform/PathResolver.cpp
    # UI System
    src/esengine/ui/UIContext.cpp
    src/esengine/ui/rendering/UIBatchRenderer.cpp
    src/esengine/ui/layout/StackLayout.cpp
    src/esengine/ui/layout/WrapLayout.cpp
    src/esengine/ui/widgets/Widget.cpp
    src/esengine/ui/widgets/Panel.cpp
    src/esengine/ui/widgets/Label.cpp
    src/esengine/ui/widgets/Button.cpp
    src/esengine/ui/widgets/ScrollView.cpp
    src/esengine/ui/widgets/TreeView.cpp
    src/esengine/ui/widgets/TextField.cpp
    src/esengine/ui/widgets/Checkbox.cpp
    src/esengine/ui/widgets/Slider.cpp
    src/esengine/ui/widgets/ContextMenu.cpp
    src/esengine/ui/widgets/Dropdown.cpp
    src/esengine/ui/widgets/DropdownPopup.cpp
    src/esengine/ui/widgets/ClickablePanel.cpp
    # Text utilities
    src/esengine/ui/text/TextMeasureHelper.cpp
)

# Font sources (conditional)
if(ES_FEATURE_SDF_FONT)
    list(APPEND ESENGINE_SOURCES
        src/esengine/ui/font/SDFFont.cpp
        src/esengine/ui/font/MSDFFont.cpp
    )
endif()

if(ES_FEATURE_BITMAP_FONT)
    list(APPEND ESENGINE_SOURCES src/esengine/ui/font/BitmapFont.cpp)
endif()

# SystemFont is always available (uses OS native APIs)
list(APPEND ESENGINE_SOURCES src/esengine/ui/font/SystemFont.cpp)

set(ESENGINE_HEADERS
    src/esengine/ESEngine.hpp
    src/esengine/core/Types.hpp
    src/esengine/core/Application.hpp
    src/esengine/core/Engine.hpp
    src/esengine/core/Log.hpp
    src/esengine/ecs/Entity.hpp
    src/esengine/ecs/Component.hpp
    src/esengine/ecs/System.hpp
    src/esengine/ecs/Registry.hpp
    src/esengine/ecs/SparseSet.hpp
    src/esengine/ecs/View.hpp
    src/esengine/ecs/TransformSystem.hpp
    # ECS Components (split for modularity)
    src/esengine/ecs/components/Transform.hpp
    src/esengine/ecs/components/Hierarchy.hpp
    src/esengine/ecs/components/Sprite.hpp
    src/esengine/ecs/components/Camera.hpp
    src/esengine/ecs/components/Velocity.hpp
    src/esengine/ecs/components/Common.hpp
    src/esengine/math/Math.hpp
    src/esengine/resource/Handle.hpp
    src/esengine/resource/ResourcePool.hpp
    src/esengine/resource/ResourceManager.hpp
    src/esengine/resource/Resource.hpp
    src/esengine/renderer/RenderContext.hpp
    src/esengine/renderer/Renderer.hpp
    src/esengine/renderer/Shader.hpp
    src/esengine/renderer/Buffer.hpp
    src/esengine/renderer/Texture.hpp
    src/esengine/renderer/Framebuffer.hpp
    src/esengine/renderer/RenderCommand.hpp
    src/esengine/platform/Platform.hpp
    src/esengine/platform/input/Input.hpp
    # Event system
    src/esengine/events/Events.hpp
    src/esengine/events/Connection.hpp
    src/esengine/events/Signal.hpp
    src/esengine/events/Sink.hpp
    src/esengine/events/Dispatcher.hpp
    # UI System
    src/esengine/ui/UIContext.hpp
    src/esengine/ui/core/Types.hpp
    src/esengine/ui/core/Theme.hpp
    src/esengine/ui/events/UIEvent.hpp
    src/esengine/ui/layout/SizeValue.hpp
    src/esengine/ui/layout/Layout.hpp
    src/esengine/ui/layout/StackLayout.hpp
    src/esengine/ui/rendering/UIBatchRenderer.hpp
    src/esengine/ui/icons/Icons.hpp
    src/esengine/ui/widgets/Widget.hpp
    src/esengine/ui/widgets/Panel.hpp
    src/esengine/ui/widgets/Label.hpp
    src/esengine/ui/widgets/Button.hpp
    src/esengine/ui/widgets/ScrollView.hpp
    src/esengine/ui/widgets/TreeView.hpp
    src/esengine/ui/widgets/TextField.hpp
    src/esengine/ui/widgets/Checkbox.hpp
    src/esengine/ui/widgets/Slider.hpp
    src/esengine/ui/widgets/ContextMenu.hpp
    src/esengine/ui/widgets/Dropdown.hpp
    src/esengine/ui/widgets/DropdownPopup.hpp
    src/esengine/ui/widgets/ClickablePanel.hpp
    # Text utilities
    src/esengine/ui/text/TextMeasureHelper.hpp
)

# Font headers (conditional)
if(ES_FEATURE_SDF_FONT)
    list(APPEND ESENGINE_HEADERS
        src/esengine/ui/font/SDFFont.hpp
        src/esengine/ui/font/MSDFFont.hpp
    )
endif()

if(ES_FEATURE_BITMAP_FONT)
    list(APPEND ESENGINE_HEADERS src/esengine/ui/font/BitmapFont.hpp)
endif()

list(APPEND ESENGINE_HEADERS
    src/esengine/ui/font/IFont.hpp
    src/esengine/ui/font/SystemFont.hpp
)

# Generated binding file paths (defined early for use in source lists)
set(GENERATED_WEB_BINDINGS "${CMAKE_CURRENT_SOURCE_DIR}/src/esengine/bindings/WebBindings.generated.cpp")
set(GENERATED_TS_DEFINITIONS "${CMAKE_CURRENT_SOURCE_DIR}/bindings/esengine.d.ts")

# Platform-specific sources
if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
    list(APPEND ESENGINE_SOURCES
        src/esengine/platform/web/WebPlatform.cpp
        src/esengine/platform/web/WebFileSystem.cpp
        ${GENERATED_WEB_BINDINGS}
    )
else()
    # Native platform (GLFW + OpenGL)
    list(APPEND ESENGINE_SOURCES
        src/esengine/platform/native/NativePlatform.cpp
        src/esengine/platform/native/NativeFileSystem.cpp
        src/esengine/platform/FileDialog.cpp
        src/esengine/scripting/ScriptContext.cpp
        src/esengine/scripting/ScriptValue.cpp
        src/esengine/ecs/systems/ScriptSystem.cpp
    )
    list(APPEND ESENGINE_HEADERS
        src/esengine/platform/native/NativePlatform.hpp
        src/esengine/scripting/ScriptContext.hpp
        src/esengine/scripting/ScriptValue.hpp
        src/esengine/scripting/bindings/ECSBindings.hpp
        src/esengine/ecs/systems/ScriptSystem.hpp
        src/esengine/ecs/components/Script.hpp
    )

endif()

# Platform-independent headers
list(APPEND ESENGINE_HEADERS
    src/esengine/platform/FileSystem.hpp
    src/esengine/platform/FileDialog.hpp
    src/esengine/core/Reflection.hpp
)

# =============================================================================
# EHT - ESEngine Header Tool (Binding Generation)
# =============================================================================

# Find Python3 for EHT
find_package(Python3 COMPONENTS Interpreter)

if(Python3_FOUND)
    file(GLOB_RECURSE COMPONENT_HEADERS
        "${CMAKE_CURRENT_SOURCE_DIR}/src/esengine/ecs/components/*.hpp"
    )

    # Custom command to run EHT
    add_custom_command(
        OUTPUT
            ${GENERATED_WEB_BINDINGS}
            ${GENERATED_TS_DEFINITIONS}
        COMMAND ${Python3_EXECUTABLE}
            "${CMAKE_CURRENT_SOURCE_DIR}/tools/eht.py"
            --input "${CMAKE_CURRENT_SOURCE_DIR}/src/esengine/ecs/components"
            --output "${CMAKE_CURRENT_SOURCE_DIR}/src/esengine/bindings"
            --ts-output "${CMAKE_CURRENT_SOURCE_DIR}/bindings"
        DEPENDS
            ${COMPONENT_HEADERS}
            "${CMAKE_CURRENT_SOURCE_DIR}/tools/eht.py"
        WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
        COMMENT "Running EHT (ESEngine Header Tool)..."
        VERBATIM
    )

    # Create custom target for EHT
    add_custom_target(eht
        DEPENDS
            ${GENERATED_WEB_BINDINGS}
            ${GENERATED_TS_DEFINITIONS}
    )

    message(STATUS "EHT (ESEngine Header Tool): ENABLED")
else()
    message(WARNING "Python3 not found - EHT DISABLED")
    message(WARNING "Using pre-existing binding files (may be outdated)")
endif()

add_library(esengine STATIC ${ESENGINE_SOURCES} ${ESENGINE_HEADERS})

# Add dependency on EHT if Python is available
if(Python3_FOUND)
    add_dependencies(esengine eht)
endif()

target_include_directories(esengine
    PUBLIC
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/src>
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/third_party/stb>
        $<INSTALL_INTERFACE:include>
    PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/src
        ${CMAKE_CURRENT_SOURCE_DIR}/third_party/stb
)

# Add QuickJS include path only for native platform (SYSTEM to prevent version file issues)
if(NOT ES_BUILD_WEB AND NOT ES_BUILD_WXGAME)
    target_include_directories(esengine SYSTEM PRIVATE ${QUICKJS_INCLUDE_DIR})
endif()

# Core dependencies
target_link_libraries(esengine PUBLIC glm)

# FreeType dependency (only needed for SDF fonts)
if(ES_FEATURE_SDF_FONT)
    target_link_libraries(esengine PUBLIC freetype msdfgen-core msdfgen-ext)
    target_include_directories(esengine PUBLIC
        ${CMAKE_SOURCE_DIR}/third_party/freetype/include
        ${CMAKE_SOURCE_DIR}/third_party/msdfgen
    )
    target_compile_definitions(esengine PUBLIC ES_FEATURE_SDF_FONT=1)
endif()

if(ES_FEATURE_BITMAP_FONT)
    target_compile_definitions(esengine PUBLIC ES_FEATURE_BITMAP_FONT=1)
endif()

# Platform-specific settings
if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
    # Emscripten-specific settings (link flags are in cmake/Emscripten.cmake)
    target_compile_definitions(esengine PUBLIC ES_PLATFORM_WEB)
    if(ES_BUILD_WXGAME)
        target_compile_definitions(esengine PUBLIC ES_PLATFORM_WXGAME)
    endif()
else()
    # Native platform - link GLFW, GLAD, OpenGL, QuickJS
    find_package(OpenGL REQUIRED)
    target_compile_definitions(esengine PUBLIC ES_PLATFORM_NATIVE)
    # Development mode: use source directory for editor assets
    target_compile_definitions(esengine PUBLIC ES_SOURCE_DIR="${CMAKE_SOURCE_DIR}")
    target_link_libraries(esengine PUBLIC glfw glad OpenGL::GL quickjs)
    target_include_directories(esengine PUBLIC
        ${CMAKE_SOURCE_DIR}/third_party/glad/include
    )
    if(WIN32)
        target_compile_definitions(esengine PUBLIC ES_PLATFORM_WINDOWS)
    endif()
endif()

# Strict compiler warnings
esengine_set_strict_warnings(esengine)

# =============================================================================
# Web SDK Library
# =============================================================================

if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
    add_executable(esengine_sdk src/esengine/bindings/WebSDKEntry.cpp)
    # Use --whole-archive to force link entire engine (prevent dead code elimination)
    target_link_libraries(esengine_sdk PRIVATE
        -Wl,--whole-archive esengine -Wl,--no-whole-archive
    )
    es_apply_sdk_settings(esengine_sdk)

    set_target_properties(esengine_sdk PROPERTIES
        OUTPUT_NAME "esengine"
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/sdk"
    )

    add_custom_command(TARGET esengine_sdk POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy
            "${CMAKE_SOURCE_DIR}/bindings/esengine.d.ts"
            "${CMAKE_BINARY_DIR}/sdk/esengine.d.ts"
        COMMENT "Copying TypeScript definitions to SDK output"
    )
endif()

# Tests
if(ES_BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests)
endif()

# Editor (native platform only)
if(ES_BUILD_EDITOR AND NOT ES_BUILD_WEB AND NOT ES_BUILD_WXGAME)
    add_subdirectory(src/esengine/editor)
endif()

# Install rules
install(TARGETS esengine
    EXPORT ESEngineTargets
    LIBRARY DESTINATION lib
    ARCHIVE DESTINATION lib
    RUNTIME DESTINATION bin
)

install(DIRECTORY src/esengine/
    DESTINATION include/esengine
    FILES_MATCHING PATTERN "*.hpp"
)

install(DIRECTORY include/esengine/
    DESTINATION include/esengine
    FILES_MATCHING PATTERN "*.hpp"
)
