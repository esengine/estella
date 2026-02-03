cmake_minimum_required(VERSION 3.16)
project(ESEngine VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(ES_BUILD_WEB "Build for Web/Emscripten" OFF)
option(ES_BUILD_WXGAME "Build for WeChat MiniGame" OFF)
option(ES_BUILD_TESTS "Build tests" ON)

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")
include(ESEngineConfig)

if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
    include(Emscripten)
endif()

add_subdirectory(third_party)

# =============================================================================
# ESEngine Library
# =============================================================================

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
)

set(ESENGINE_HEADERS
    src/esengine/ESEngine.hpp
    src/esengine/core/Types.hpp
    src/esengine/core/Application.hpp
    src/esengine/core/Engine.hpp
    src/esengine/core/Log.hpp
    src/esengine/core/Reflection.hpp
    src/esengine/ecs/Entity.hpp
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
    src/esengine/renderer/RenderPipeline.hpp
    src/esengine/platform/Platform.hpp
    src/esengine/platform/FileSystem.hpp
    src/esengine/platform/input/Input.hpp
    src/esengine/events/Events.hpp
    src/esengine/events/Connection.hpp
    src/esengine/events/Signal.hpp
    src/esengine/events/Sink.hpp
    src/esengine/events/Dispatcher.hpp
)

set(GENERATED_WEB_BINDINGS "${CMAKE_CURRENT_SOURCE_DIR}/src/esengine/bindings/WebBindings.generated.cpp")
set(GENERATED_TS_DEFINITIONS "${CMAKE_CURRENT_SOURCE_DIR}/bindings/esengine.d.ts")

if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
    list(APPEND ESENGINE_SOURCES
        src/esengine/platform/web/WebPlatform.cpp
        src/esengine/platform/web/WebFileSystem.cpp
        ${GENERATED_WEB_BINDINGS}
    )
else()
    list(APPEND ESENGINE_SOURCES
        src/esengine/platform/native/NativePlatform.cpp
        src/esengine/platform/native/NativeFileSystem.cpp
        src/esengine/platform/FileDialog.cpp
    )
    list(APPEND ESENGINE_HEADERS
        src/esengine/platform/native/NativePlatform.hpp
        src/esengine/platform/FileDialog.hpp
    )
endif()

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
            --ts-output "${CMAKE_CURRENT_SOURCE_DIR}/bindings"
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

# EHT disabled - WebBindings.generated.cpp manually maintained
# if(Python3_FOUND)
#     add_dependencies(esengine eht)
# endif()

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

target_link_libraries(esengine PUBLIC glm)

if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
    target_compile_definitions(esengine PUBLIC ES_PLATFORM_WEB)
    if(ES_BUILD_WXGAME)
        target_compile_definitions(esengine PUBLIC ES_PLATFORM_WXGAME)
    endif()
else()
    find_package(OpenGL REQUIRED)
    target_compile_definitions(esengine PUBLIC ES_PLATFORM_NATIVE ES_SOURCE_DIR="${CMAKE_SOURCE_DIR}")
    target_link_libraries(esengine PUBLIC glfw glad OpenGL::GL)
    target_include_directories(esengine PUBLIC ${CMAKE_SOURCE_DIR}/third_party/glad/include)
    if(WIN32)
        target_compile_definitions(esengine PUBLIC ES_PLATFORM_WINDOWS)
    endif()
endif()

esengine_set_strict_warnings(esengine)

# =============================================================================
# Web SDK
# =============================================================================

if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
    add_executable(esengine_sdk src/esengine/bindings/WebSDKEntry.cpp)
    target_link_libraries(esengine_sdk PRIVATE -Wl,--whole-archive esengine -Wl,--no-whole-archive)
    es_apply_sdk_settings(esengine_sdk)

    set_target_properties(esengine_sdk PROPERTIES
        OUTPUT_NAME "esengine"
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/sdk"
    )

    add_custom_command(TARGET esengine_sdk POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy
            "${CMAKE_SOURCE_DIR}/bindings/esengine.d.ts"
            "${CMAKE_BINARY_DIR}/sdk/esengine.d.ts"
    )
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
