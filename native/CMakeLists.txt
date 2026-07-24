# Estella native host — the engine C++ core compiled arm64 + linked against an
# embedded Dawn. Requires a Dawn checkout + arm64 build (see README.md):
#   -DESTELLA_DAWN_DIR=<dawn source>  -DESTELLA_DAWN_BUILD=<dawn arm64 build dir>
# Invoke through the NDK toolchain file. NOT part of the web/emscripten build.
cmake_minimum_required(VERSION 3.22)
project(estella_native_host C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT ESTELLA_DAWN_DIR OR NOT ESTELLA_DAWN_BUILD)
    message(FATAL_ERROR "Set ESTELLA_DAWN_DIR (Dawn source) and ESTELLA_DAWN_BUILD (Dawn arm64 build). See native/README.md.")
endif()

set(REPO "${CMAKE_CURRENT_SOURCE_DIR}/..")
set(SRC "${REPO}/src")
set(TP "${REPO}/third_party")

# Prebuilt monolithic Dawn (libwebgpu_dawn.so).
add_library(webgpu_dawn SHARED IMPORTED)
set_target_properties(webgpu_dawn PROPERTIES
    IMPORTED_LOCATION "${ESTELLA_DAWN_BUILD}/src/dawn/native/libwebgpu_dawn.so")

# glm + yoga (the engine's non-emscripten third-party deps).
add_library(glm INTERFACE)
target_include_directories(glm INTERFACE "${TP}/glm")
target_compile_definitions(glm INTERFACE GLM_FORCE_RADIANS GLM_FORCE_DEPTH_ZERO_TO_ONE GLM_ENABLE_EXPERIMENTAL)

file(GLOB_RECURSE YOGA_SOURCES "${TP}/yoga/*.cpp")
add_library(yogacore STATIC ${YOGA_SOURCES})
target_include_directories(yogacore PUBLIC "${TP}")
target_compile_options(yogacore PRIVATE -Wno-unused-parameter)

add_library(native_app_glue STATIC
    "${ANDROID_NDK}/sources/android/native_app_glue/android_native_app_glue.c")
target_include_directories(native_app_glue PUBLIC
    "${ANDROID_NDK}/sources/android/native_app_glue")

# The engine core, native arm64. The source list is the SAME single-source file the
# web build uses (cmake/ESEngineSources.cmake) — selecting the WebGPU backend and
# dropping GL / bitmap text / particles / tilemap / post-process for this build. The
# bindings/ (emscripten embind) TUs are web-only and never listed there.
set(ESENGINE_ROOT "${REPO}")
list(APPEND CMAKE_MODULE_PATH "${REPO}/cmake")
set(ES_ENABLE_WEBGPU ON)
include(ESEngineSources)

# BitmapFont is self-contained (no freetype/msdfgen) and ResourceManager references
# it, so the WebGPU-only build (ES_ENABLE_BITMAP_TEXT off) still needs this one TU.
list(APPEND ESENGINE_SOURCES ${SRC}/esengine/text/BitmapFont.cpp)

add_library(esengine STATIC ${ESENGINE_SOURCES})

target_include_directories(esengine PUBLIC
    "${SRC}" "${TP}/stb"
    "${ESTELLA_DAWN_DIR}/include"                 # <webgpu/webgpu.h> forwarder
    "${ESTELLA_DAWN_BUILD}/gen/include")          # generated <dawn/webgpu.h>
target_compile_definitions(esengine PUBLIC ES_ENABLE_WEBGPU)  # NOT ES_PLATFORM_WEB / ES_ENABLE_BITMAP_TEXT
target_link_libraries(esengine PUBLIC glm yogacore webgpu_dawn)

# Reference host: boots EstellaContext with an injected WebGPUDevice over the
# NativeActivity's ANativeWindow and renders one ECS scene. See host/main.cpp.
add_library(estella_host SHARED host/main.cpp)
target_link_libraries(estella_host esengine native_app_glue android log)
set_target_properties(estella_host PROPERTIES LINK_FLAGS "-u ANativeActivity_onCreate")
