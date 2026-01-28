cmake_minimum_required(VERSION 3.16)
project(ESEngine VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Build options
option(ES_BUILD_WEB "Build for Web/Emscripten" OFF)
option(ES_BUILD_WXGAME "Build for WeChat MiniGame" OFF)
option(ES_BUILD_EXAMPLES "Build examples" ON)
option(ES_BUILD_TESTS "Build tests" ON)
option(ES_BUILD_EDITOR "Build editor (native only)" OFF)
option(ES_BUILD_MODULAR "Build modular WASM (Web only, dynamic linking)" OFF)

# Feature options (modular compilation)
option(ES_FEATURE_SDF_FONT "Enable SDF font rendering (requires FreeType)" ON)
option(ES_FEATURE_BITMAP_FONT "Enable bitmap font rendering (lightweight)" ON)

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
    src/esengine/resource/ResourceManager.cpp
    src/esengine/renderer/RenderContext.cpp
    src/esengine/renderer/Renderer.cpp
    src/esengine/renderer/Shader.cpp
    src/esengine/renderer/Buffer.cpp
    src/esengine/renderer/Texture.cpp
    src/esengine/renderer/Framebuffer.cpp
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
    # Docking System
    src/esengine/ui/docking/DockNode.cpp
    src/esengine/ui/docking/DockPanel.cpp
    src/esengine/ui/docking/DockTabBar.cpp
    src/esengine/ui/docking/DockZone.cpp
    src/esengine/ui/docking/DockArea.cpp
    src/esengine/ui/docking/DockLayoutSerializer.cpp
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
    # Docking System
    src/esengine/ui/docking/DockTypes.hpp
    src/esengine/ui/docking/DockNode.hpp
    src/esengine/ui/docking/DockPanel.hpp
    src/esengine/ui/docking/DockTabBar.hpp
    src/esengine/ui/docking/DockZone.hpp
    src/esengine/ui/docking/DockArea.hpp
    src/esengine/ui/docking/DockEvents.hpp
    src/esengine/ui/docking/DockLayoutSerializer.hpp
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

# Platform-specific sources
if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
    list(APPEND ESENGINE_SOURCES
        src/esengine/platform/web/WebPlatform.cpp
        src/esengine/platform/web/WebFileSystem.cpp
        # Generated Web bindings (from tools/generate_bindings.py)
        ${GENERATED_WEB_BINDINGS}
    )
else()
    # Native platform (GLFW + OpenGL)
    list(APPEND ESENGINE_SOURCES
        src/esengine/platform/native/NativePlatform.cpp
        src/esengine/platform/native/NativeFileSystem.cpp
        src/esengine/platform/FileDialog.cpp
        # Scripting (Native only - Web uses Emscripten bindings)
        src/esengine/scripting/ScriptContext.cpp
        src/esengine/scripting/ScriptValue.cpp
        # Generated QuickJS bindings (from tools/generate_bindings.py)
        ${GENERATED_QUICKJS_BINDINGS}
        src/esengine/ecs/systems/ScriptSystem.cpp
    )
    list(APPEND ESENGINE_HEADERS
        src/esengine/platform/native/NativePlatform.hpp
        # Scripting headers
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
# Automatic Binding Generation
# =============================================================================

# Find Python3 for binding generator
find_package(Python3 COMPONENTS Interpreter)

if(Python3_FOUND)
    # Generated binding files
    set(GENERATED_WEB_BINDINGS "${CMAKE_CURRENT_SOURCE_DIR}/src/esengine/bindings/WebBindings.generated.cpp")
    set(GENERATED_QUICKJS_BINDINGS "${CMAKE_CURRENT_SOURCE_DIR}/src/esengine/scripting/bindings/ECSBindings.generated.cpp")
    set(GENERATED_TS_DEFINITIONS "${CMAKE_CURRENT_SOURCE_DIR}/bindings/esengine.d.ts")

    # Component header files to scan
    file(GLOB_RECURSE COMPONENT_HEADERS
        "${CMAKE_CURRENT_SOURCE_DIR}/src/esengine/ecs/components/*.hpp"
    )

    # Custom command to generate bindings
    add_custom_command(
        OUTPUT
            ${GENERATED_WEB_BINDINGS}
            ${GENERATED_QUICKJS_BINDINGS}
            ${GENERATED_TS_DEFINITIONS}
        COMMAND ${Python3_EXECUTABLE}
            "${CMAKE_CURRENT_SOURCE_DIR}/tools/generate_bindings.py"
            --input "${CMAKE_CURRENT_SOURCE_DIR}/src/esengine/ecs/components"
            --output "${CMAKE_CURRENT_SOURCE_DIR}/src/esengine/bindings"
        DEPENDS
            ${COMPONENT_HEADERS}
            "${CMAKE_CURRENT_SOURCE_DIR}/tools/generate_bindings.py"
        WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
        COMMENT "Generating bindings from marked components..."
        VERBATIM
    )

    # Create custom target for binding generation
    add_custom_target(generate_bindings
        DEPENDS
            ${GENERATED_WEB_BINDINGS}
            ${GENERATED_QUICKJS_BINDINGS}
            ${GENERATED_TS_DEFINITIONS}
    )

    message(STATUS "Automatic binding generation: ENABLED")
else()
    message(WARNING "Python3 not found - automatic binding generation DISABLED")
    message(WARNING "Using pre-existing binding files (may be outdated)")
endif()

add_library(esengine STATIC ${ESENGINE_SOURCES} ${ESENGINE_HEADERS})

# Add dependency on binding generation if Python is available
if(Python3_FOUND)
    add_dependencies(esengine generate_bindings)
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

# Examples
if(ES_BUILD_EXAMPLES)
    add_subdirectory(examples)
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
