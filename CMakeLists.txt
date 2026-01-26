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

# Include custom CMake modules
list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")
include(ESEngineConfig)

if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
    include(Emscripten)
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
    # UI System
    src/esengine/ui/UIContext.cpp
    src/esengine/ui/rendering/UIBatchRenderer.cpp
    src/esengine/ui/font/Font.cpp
    src/esengine/ui/layout/StackLayout.cpp
    src/esengine/ui/widgets/Widget.cpp
    src/esengine/ui/widgets/Panel.cpp
    src/esengine/ui/widgets/Label.cpp
    src/esengine/ui/widgets/Button.cpp
    src/esengine/ui/widgets/ScrollView.cpp
    src/esengine/ui/widgets/TreeView.cpp
    src/esengine/ui/widgets/TextField.cpp
    src/esengine/ui/widgets/Checkbox.cpp
    src/esengine/ui/widgets/Slider.cpp
    # Docking System
    src/esengine/ui/docking/DockNode.cpp
    src/esengine/ui/docking/DockPanel.cpp
    src/esengine/ui/docking/DockTabBar.cpp
    src/esengine/ui/docking/DockZone.cpp
    src/esengine/ui/docking/DockArea.cpp
    src/esengine/ui/docking/DockLayoutSerializer.cpp
)

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
    src/esengine/ui/font/Font.hpp
    src/esengine/ui/widgets/Widget.hpp
    src/esengine/ui/widgets/Panel.hpp
    src/esengine/ui/widgets/Label.hpp
    src/esengine/ui/widgets/Button.hpp
    src/esengine/ui/widgets/ScrollView.hpp
    src/esengine/ui/widgets/TreeView.hpp
    src/esengine/ui/widgets/TextField.hpp
    src/esengine/ui/widgets/Checkbox.hpp
    src/esengine/ui/widgets/Slider.hpp
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

# Platform-specific sources
if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
    list(APPEND ESENGINE_SOURCES
        src/esengine/platform/web/WebPlatform.cpp
    )
else()
    # Native platform (GLFW + OpenGL)
    list(APPEND ESENGINE_SOURCES
        src/esengine/platform/native/NativePlatform.cpp
        # Scripting (Native only - Web uses Emscripten bindings)
        src/esengine/scripting/ScriptContext.cpp
        src/esengine/scripting/ScriptValue.cpp
        src/esengine/scripting/bindings/ECSBindings.cpp
    )
    list(APPEND ESENGINE_HEADERS
        src/esengine/platform/native/NativePlatform.hpp
        # Scripting headers
        src/esengine/scripting/ScriptContext.hpp
        src/esengine/scripting/ScriptValue.hpp
        src/esengine/scripting/bindings/ECSBindings.hpp
    )

endif()

add_library(esengine STATIC ${ESENGINE_SOURCES} ${ESENGINE_HEADERS})

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

# Add QuickJS include path only for native platform (PRIVATE to avoid polluting consumers)
if(NOT ES_BUILD_WEB AND NOT ES_BUILD_WXGAME)
    target_include_directories(esengine PRIVATE ${QUICKJS_INCLUDE_DIR})
endif()

target_link_libraries(esengine PUBLIC glm)

# Platform-specific settings
if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
    # Emscripten-specific settings (link flags are in cmake/Emscripten.cmake)
    target_compile_definitions(esengine PUBLIC ES_PLATFORM_WEB)
    if(ES_BUILD_WXGAME)
        target_compile_definitions(esengine PUBLIC ES_PLATFORM_WXGAME)
    endif()
else()
    # Native platform - link GLFW, GLAD, OpenGL, and QuickJS
    find_package(OpenGL REQUIRED)
    target_compile_definitions(esengine PUBLIC ES_PLATFORM_NATIVE)
    target_link_libraries(esengine PUBLIC glfw glad OpenGL::GL quickjs)
    target_include_directories(esengine PUBLIC
        ${CMAKE_SOURCE_DIR}/third_party/glad/include
    )
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
