cmake_minimum_required(VERSION 3.16)
project(ESEngine VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Build options
option(ES_BUILD_WEB "Build for Web/Emscripten" OFF)
option(ES_BUILD_WXGAME "Build for WeChat MiniGame" OFF)
option(ES_BUILD_EXAMPLES "Build examples" ON)
option(ES_BUILD_TESTS "Build tests" ON)

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
    src/esengine/renderer/stb_image_impl.cpp
    src/esengine/platform/input/Input.cpp
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
    src/esengine/renderer/RenderCommand.hpp
    src/esengine/platform/Platform.hpp
    src/esengine/platform/input/Input.hpp
)

# Platform-specific sources
if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
    list(APPEND ESENGINE_SOURCES
        src/esengine/platform/web/WebPlatform.cpp
    )
else()
    # Native platform (for debugging)
    list(APPEND ESENGINE_SOURCES
        src/esengine/platform/web/WebPlatform.cpp
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

target_link_libraries(esengine PUBLIC glm)

# Emscripten-specific settings (link flags are in cmake/Emscripten.cmake)
if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
    target_compile_definitions(esengine PUBLIC ES_PLATFORM_WEB)
    if(ES_BUILD_WXGAME)
        target_compile_definitions(esengine PUBLIC ES_PLATFORM_WXGAME)
    endif()
endif()

# Compiler warnings
if(MSVC)
    target_compile_options(esengine PRIVATE /W4)
else()
    target_compile_options(esengine PRIVATE -Wall -Wextra -Wpedantic)
endif()

# Examples
if(ES_BUILD_EXAMPLES)
    add_subdirectory(examples)
endif()

# Tests
if(ES_BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests)
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
