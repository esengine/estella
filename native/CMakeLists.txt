# Estella native host — the engine C++ core compiled arm64 + linked against an
# embedded Dawn. Requires a Dawn checkout + arm64 build (see README.md):
#   -DESTELLA_DAWN_DIR=<dawn source>  -DESTELLA_DAWN_BUILD=<dawn arm64 build dir>
# Android: invoke through the NDK toolchain file (Vulkan Dawn, shared library host).
# iOS:     -DCMAKE_SYSTEM_NAME=iOS (Metal Dawn, static library linked by a thin app).
# NOT part of the web/emscripten build.
cmake_minimum_required(VERSION 3.22)
project(estella_native_host C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT ESTELLA_DAWN_DIR OR NOT ESTELLA_DAWN_BUILD)
    message(FATAL_ERROR "Set ESTELLA_DAWN_DIR (Dawn source) and ESTELLA_DAWN_BUILD (Dawn arm64 build). See native/README.md.")
endif()

if(CMAKE_SYSTEM_NAME STREQUAL "iOS")
    set(ESTELLA_IOS ON)
elseif(NOT ANDROID)
    message(FATAL_ERROR "Unsupported platform: configure with the NDK toolchain (Android) or -DCMAKE_SYSTEM_NAME=iOS.")
endif()

set(REPO "${CMAKE_CURRENT_SOURCE_DIR}/..")
set(SRC "${REPO}/src")
set(TP "${REPO}/third_party")

# Prebuilt monolithic Dawn: a shared library on Android, a static one on iOS (where
# the app embeds everything). Override ESTELLA_DAWN_LIB if your build lays it out
# elsewhere. A device build and a simulator build are different target triples, so
# each needs its own Dawn — see ESTELLA_IOS_SIMULATOR below.
if(ESTELLA_IOS)
    if(NOT ESTELLA_DAWN_LIB)
        set(ESTELLA_DAWN_LIB "${ESTELLA_DAWN_BUILD}/src/dawn/native/libwebgpu_dawn.a")
    endif()
    add_library(webgpu_dawn STATIC IMPORTED)
else()
    if(NOT ESTELLA_DAWN_LIB)
        set(ESTELLA_DAWN_LIB "${ESTELLA_DAWN_BUILD}/src/dawn/native/libwebgpu_dawn.so")
    endif()
    add_library(webgpu_dawn SHARED IMPORTED)
endif()
if(NOT EXISTS "${ESTELLA_DAWN_LIB}")
    message(FATAL_ERROR "Dawn library not found: ${ESTELLA_DAWN_LIB}. Build Dawn for this platform (see native/README.md) or pass -DESTELLA_DAWN_LIB=<path>.")
endif()
set_target_properties(webgpu_dawn PROPERTIES IMPORTED_LOCATION "${ESTELLA_DAWN_LIB}")
if(ESTELLA_IOS)
    # Dawn's Metal backend pulls these in; a static Dawn does not carry them along.
    set_target_properties(webgpu_dawn PROPERTIES
        INTERFACE_LINK_LIBRARIES "-framework Metal;-framework QuartzCore;-framework Foundation;-framework IOSurface;-framework CoreGraphics")
endif()

# glm + yoga (the engine's non-emscripten third-party deps).
add_library(glm INTERFACE)
target_include_directories(glm INTERFACE "${TP}/glm")
target_compile_definitions(glm INTERFACE GLM_FORCE_RADIANS GLM_FORCE_DEPTH_ZERO_TO_ONE GLM_ENABLE_EXPERIMENTAL)

file(GLOB_RECURSE YOGA_SOURCES "${TP}/yoga/*.cpp")
add_library(yogacore STATIC ${YOGA_SOURCES})
target_include_directories(yogacore PUBLIC "${TP}")
target_compile_options(yogacore PRIVATE -Wno-unused-parameter)

# Box2D + the physics module's own TUs, compiled INTO the host. On the web physics
# ships as a separate wasm side module (dynamic linking, its own emscripten runtime);
# a native app has no such story and no reason for one — the same C sources link
# straight in, and the SDK reaches them through the generated es_physics_* wrappers.
# Vendored, so nothing extra to fetch.
set(BOX2D_SAMPLES OFF CACHE BOOL "" FORCE)
set(BOX2D_BENCHMARKS OFF CACHE BOOL "" FORCE)
set(BOX2D_DOCS OFF CACHE BOOL "" FORCE)
set(BOX2D_UNIT_TESTS OFF CACHE BOOL "" FORCE)
set(BOX2D_VALIDATE OFF CACHE BOOL "" FORCE)   # release: no heavy internal assertions
add_subdirectory("${TP}/box2d" "${CMAKE_BINARY_DIR}/box2d" EXCLUDE_FROM_ALL)

# The Spine runtime: the vendored release plus the module's entry points, compiled
# into the host. Every runtime backend exports the same symbol names, so a binary
# carries exactly ONE — which is why the web ships a module per version and a native
# app picks at build time. `spine_runtimeVersion()` reports the choice, and the SDK's
# acquirer answers only that version's id.
#
# Which backend goes with which release is the tree's shape, exactly as the web build
# reads it (es_add_spine_module in cmake/Emscripten.cmake): 3.8 - 4.2 vendor the pure-C
# runtime nested a level deep, 2.1 the same runtime flat and in a dialect of its own,
# and 4.3 replaced it with a generated wrapper so we bind spine-cpp instead.
set(ESTELLA_SPINE_VERSION "4.2" CACHE STRING "Spine runtime to link (4.3 / 4.2 / 4.1 / 3.8 / 2.1)")
set(SPINE_ROOT "${TP}/spine-runtimes-${ESTELLA_SPINE_VERSION}")
if(EXISTS "${SPINE_ROOT}/spine-c/spine-c/include")
    set(SPINE_BACKEND "${SRC}/esengine/bindings/modules/spine/SpineRuntimeC.cpp")
    set(SPINE_INCLUDE "${SPINE_ROOT}/spine-c/spine-c/include")
    file(GLOB SPINE_SOURCES "${SPINE_ROOT}/spine-c/spine-c/src/spine/*.c")
elseif(EXISTS "${SPINE_ROOT}/spine-cpp/include")
    set(SPINE_BACKEND "${SRC}/esengine/bindings/modules/spine/SpineRuntimeCpp.cpp")
    set(SPINE_INCLUDE "${SPINE_ROOT}/spine-cpp/include")
    file(GLOB SPINE_SOURCES "${SPINE_ROOT}/spine-cpp/src/spine/*.cpp")
elseif(EXISTS "${SPINE_ROOT}/spine-c/include/spine")
    set(SPINE_BACKEND "${SRC}/esengine/bindings/modules/spine/SpineRuntime21.cpp")
    set(SPINE_INCLUDE "${SPINE_ROOT}/spine-c/include")
    file(GLOB SPINE_SOURCES "${SPINE_ROOT}/spine-c/src/spine/*.c")
else()
    message(FATAL_ERROR "Spine runtime ${ESTELLA_SPINE_VERSION} not vendored at ${SPINE_ROOT}. "
        "Pass -DESTELLA_SPINE_VERSION=<4.3|4.2|4.1|3.8|2.1>.")
endif()

add_library(spine_runtime STATIC ${SPINE_SOURCES})
target_include_directories(spine_runtime PUBLIC "${SPINE_INCLUDE}")
target_compile_options(spine_runtime PRIVATE -w)   # vendored, not ours to lint

string(REPLACE "." "" SPINE_TAG ${ESTELLA_SPINE_VERSION})
add_library(estella_spine STATIC
    "${SRC}/esengine/bindings/modules/spine/SpineModuleEntry.cpp"
    "${SPINE_BACKEND}")
target_include_directories(estella_spine PUBLIC "${SRC}")
target_link_libraries(estella_spine PUBLIC spine_runtime)
target_compile_definitions(estella_spine PRIVATE ES_SPINE_VERSION=${SPINE_TAG})

# DragonBones: the same two TUs the web links as the "dragonbones" side module,
# over the vendored core. One runtime, not one per version — the format is frozen,
# so there is no ESTELLA_DRAGONBONES_VERSION to pick.
file(GLOB_RECURSE DRAGONBONES_SOURCES "${TP}/dragonbones/src/dragonBones/*.cpp")
add_library(dragonbones_runtime STATIC ${DRAGONBONES_SOURCES})
target_include_directories(dragonbones_runtime PUBLIC "${TP}/dragonbones/src" "${TP}/rapidjson")
target_compile_options(dragonbones_runtime PRIVATE -w)   # vendored, not ours to lint

add_library(estella_dragonbones STATIC
    "${SRC}/esengine/bindings/modules/dragonbones/DragonBonesModuleEntry.cpp"
    "${SRC}/esengine/bindings/modules/dragonbones/DragonBonesAdapter.cpp")
target_include_directories(estella_dragonbones PUBLIC "${SRC}")
target_link_libraries(estella_dragonbones PUBLIC dragonbones_runtime)

# The engine's own MPEG-1 decoder (pl_mpeg), the same TU the web links as the
# "videodec" side module. Header-only dependency, so nothing to fetch.
add_library(estella_video STATIC "${SRC}/esengine/bindings/modules/video/VideoModuleEntry.cpp")
target_include_directories(estella_video PUBLIC "${SRC}" "${TP}/pl_mpeg")

set(ESTELLA_PHYSICS_SOURCES
    "${SRC}/esengine/bindings/modules/physics/PhysicsModuleEntry.cpp"
    "${SRC}/esengine/bindings/modules/physics/PhysicsContext.cpp"
    "${SRC}/esengine/bindings/modules/physics/PhysicsShapes.cpp"
    "${SRC}/esengine/bindings/modules/physics/PhysicsJoints.cpp"
    "${SRC}/esengine/bindings/modules/physics/PhysicsQueries.cpp"
    "${SRC}/esengine/bindings/modules/physics/PhysicsReadback.cpp"
    "${SRC}/esengine/bindings/modules/physics/PhysicsTaskPool.cpp")
add_library(estella_physics STATIC ${ESTELLA_PHYSICS_SOURCES})
target_include_directories(estella_physics PUBLIC "${SRC}" "${TP}/box2d/include")
target_link_libraries(estella_physics PUBLIC box2d)

if(ANDROID)
    add_library(native_app_glue STATIC
        "${ANDROID_NDK}/sources/android/native_app_glue/android_native_app_glue.c")
    target_include_directories(native_app_glue PUBLIC
        "${ANDROID_NDK}/sources/android/native_app_glue")
endif()

# The engine core, native arm64. The source list is the SAME single-source file the
# web build uses (cmake/ESEngineSources.cmake) — selecting the WebGPU backend and
# dropping GL for this build. It also brings in the portable binding entry points
# (RendererBindings.cpp and friends), whose QuickJS wrappers are generated from the
# same declarations embind registers.
set(ESENGINE_ROOT "${REPO}")
list(APPEND CMAKE_MODULE_PATH "${REPO}/cmake")
set(ES_ENABLE_WEBGPU ON)
# Text is on: the SDK's `Text` draws through the shared glyph atlas (the host
# rasterizes — see host/media/glyph_raster.cpp — and needs the engine's own
# SdfGenerator so both platforms encode the field identically), and the C++
# BitmapText path comes along with it. Neither needs freetype/msdfgen.
set(ES_ENABLE_BITMAP_TEXT ON)
# Tilemaps, particles and post-processing: pure engine C++ with no emscripten
# dependency, driven from the SDK through entry points that marshal buffers. What
# kept them off a device was the marshalling, not the code — see host/heap.hpp.
set(ES_ENABLE_TILEMAP ON)
set(ES_ENABLE_PARTICLES ON)
set(ES_ENABLE_POSTPROCESS ON)
# Spine: the runtime itself is a separate library (above); this only gates the
# renderer's spine RenderItem plumbing inside the engine's own TUs.
set(ES_ENABLE_SPINE ON)
include(ESEngineSources)

add_library(esengine STATIC ${ESENGINE_SOURCES})

target_include_directories(esengine PUBLIC
    "${SRC}" "${TP}/stb"
    "${ESTELLA_DAWN_DIR}/include"                 # <webgpu/webgpu.h> forwarder
    "${ESTELLA_DAWN_BUILD}/gen/include")          # generated <dawn/webgpu.h>
target_compile_definitions(esengine PUBLIC   # NOT ES_PLATFORM_WEB
    ES_ENABLE_WEBGPU ES_ENABLE_BITMAP_TEXT
    ES_ENABLE_TILEMAP ES_ENABLE_PARTICLES ES_ENABLE_POSTPROCESS ES_ENABLE_SPINE)
target_link_libraries(esengine PUBLIC glm yogacore webgpu_dawn)

# The host (opt-in): a QuickJS runtime drives the engine through the EHT-generated
# bindings + the real SDK. Built only when QuickJS is provided; the
# `node build-tools/cli.js native --quickjs <dir>` orchestration fetches QuickJS,
# generates NativeBindings.generated.cpp (single reflection source), ptraccessors_js.h,
# the SDK bundle and bootstrap.js into ESTELLA_NATIVE_GEN_DIR, then configures this.
if(ESTELLA_QUICKJS_DIR)
    if(NOT ESTELLA_NATIVE_GEN_DIR)
        set(ESTELLA_NATIVE_GEN_DIR "${CMAKE_BINARY_DIR}/gen")
    endif()
    set(NATIVE_BINDINGS "${ESTELLA_NATIVE_GEN_DIR}/NativeBindings.generated.cpp")
    if(NOT EXISTS "${NATIVE_BINDINGS}")
        message(FATAL_ERROR "ESTELLA_QUICKJS_DIR set but ${NATIVE_BINDINGS} is missing. "
            "Generate it (and ptraccessors_js.h) via `cli native --quickjs`, which runs "
            "`python -m eht --native-output ... --native-only`.")
    endif()
    # The engine's binding entry points, wrapped for QuickJS from the SAME
    # declarations embind registers (`--native-functions`). The bodies are in the
    # binding TUs the engine target compiles, so both platforms run one
    # implementation and only the registration differs.
    set(NATIVE_FN_BINDINGS "${ESTELLA_NATIVE_GEN_DIR}/NativeFunctionBindings.generated.cpp")
    if(NOT EXISTS "${NATIVE_FN_BINDINGS}")
        message(FATAL_ERROR "Missing ${NATIVE_FN_BINDINGS} — generate it via `cli native --quickjs`.")
    endif()

    # QuickJS-ng interpreter — core is just these four C files.
    add_library(qjs STATIC
        "${ESTELLA_QUICKJS_DIR}/quickjs.c" "${ESTELLA_QUICKJS_DIR}/libregexp.c"
        "${ESTELLA_QUICKJS_DIR}/libunicode.c" "${ESTELLA_QUICKJS_DIR}/dtoa.c")
    target_include_directories(qjs PUBLIC "${ESTELLA_QUICKJS_DIR}")
    target_compile_definitions(qjs PRIVATE _GNU_SOURCE)
    target_compile_options(qjs PRIVATE -Wno-unused -Wno-sign-compare)

    # basis_universal transcoder (KTX2 -> ETC2/ASTC/BC), one big vendored TU behind
    # host/media/ktx2_decode.cpp, plus basis's bundled single-file zstd decoder (KTX2
    # zstd supercompression). Third-party, so silence their warnings.
    set(BASIS_TRANSCODER "${TP}/basis_universal/transcoder/basisu_transcoder.cpp")
    set(BASIS_ZSTD "${TP}/basis_universal/zstd/zstddeclib.c")
    set_source_files_properties("${BASIS_TRANSCODER}" "${BASIS_ZSTD}" PROPERTIES COMPILE_OPTIONS "-w")

    # The host, by concern: the runtime + the es_* bindings + the frame are shared,
    # and each platform adds its own glue TU (the event loop, the window, the
    # packaged assets). See native/host/Host.hpp for the layering.
    set(HOST_SOURCES
        host/Host.cpp
        host/Runtime.cpp
        host/BootLog.cpp
        host/Shot.cpp
        host/EsnShim.cpp
        host/bindings/HeapBindings.cpp
        host/bindings/EcsBindings.cpp
        host/bindings/RenderBindings.cpp
        host/bindings/AssetBindings.cpp
        host/bindings/AudioBindings.cpp
        host/bindings/NetBindings.cpp
        host/bindings/TextEditorBindings.cpp
        host/media/native_audio.cpp
        host/media/audio_spectrum.cpp
        host/media/ktx2_decode.cpp
        host/media/glyph_raster.cpp
        "${BASIS_TRANSCODER}" "${BASIS_ZSTD}" "${NATIVE_BINDINGS}" "${NATIVE_FN_BINDINGS}")

    if(ESTELLA_IOS)
        # Static: the thin Xcode app (native/ios) links this plus the libraries
        # below. -ObjC on the app keeps the Obj-C classes in platform/ios.mm alive.
        add_library(estella_js_host STATIC ${HOST_SOURCES} host/platform/ios.mm
            host/platform/apple_common.mm)
        # miniaudio's CoreAudio backend uses AVAudioSession (Obj-C), so its TU must
        # be Objective-C++ on Apple; it also forces MA_NO_RUNTIME_LINKING there, so
        # the audio frameworks are linked at build time (the app links the merged
        # archive, so these also live in native/ios/project.yml).
        set_source_files_properties(host/media/native_audio.cpp
        host/media/audio_spectrum.cpp PROPERTIES
            COMPILE_OPTIONS "-x;objective-c++")
        target_link_libraries(estella_js_host esengine estella_physics estella_video estella_spine
            estella_dragonbones qjs
            "-framework UIKit" "-framework QuartzCore" "-framework Foundation"
            "-framework AVFoundation" "-framework CoreAudio" "-framework AudioToolbox"
            "-framework CoreText" "-framework CoreGraphics")
        # Merge host + engine + deps + Dawn into ONE archive, so the Xcode app is a
        # thin shell that links a single library at a fixed path (native/ios).
        add_custom_command(TARGET estella_js_host POST_BUILD
            COMMAND libtool -static -o "${CMAKE_BINARY_DIR}/libestella_ios.a"
                    $<TARGET_FILE:estella_js_host> $<TARGET_FILE:esengine>
                    $<TARGET_FILE:estella_physics> $<TARGET_FILE:box2d>
                    $<TARGET_FILE:estella_video>
                    $<TARGET_FILE:estella_spine> $<TARGET_FILE:spine_runtime>
                    $<TARGET_FILE:estella_dragonbones> $<TARGET_FILE:dragonbones_runtime>
                    $<TARGET_FILE:qjs> $<TARGET_FILE:yogacore> "${ESTELLA_DAWN_LIB}"
            COMMENT "Merging the iOS host, engine and Dawn into libestella_ios.a")
    else()
        # Android: plain C++; miniaudio dlopens AAudio/OpenSL at runtime (no extra
        # link libs). native_audio.cpp's Obj-C paths are __APPLE__-guarded out.
        add_library(estella_js_host SHARED ${HOST_SOURCES} host/platform/android.cpp)
        target_link_libraries(estella_js_host esengine estella_physics estella_video estella_spine
            estella_dragonbones qjs native_app_glue android log)
        set_target_properties(estella_js_host PROPERTIES LINK_FLAGS "-u ANativeActivity_onCreate")
    endif()
    # host/ is the include root: every host TU spells its siblings from there
    # ("Bindings.hpp", "media/glyph_raster.hpp"), and the generated TUs include
    # esn_shim.hpp by name. The gen dir holds ptraccessors_js.h, the embedded SDK
    # bundle and the embedded bootstrap; third_party/miniaudio is the audio engine
    # header.
    target_include_directories(estella_js_host PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/host" "${ESTELLA_NATIVE_GEN_DIR}" "${TP}/miniaudio"
        "${TP}/basis_universal/transcoder")
endif()
