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

if(ANDROID)
    add_library(native_app_glue STATIC
        "${ANDROID_NDK}/sources/android/native_app_glue/android_native_app_glue.c")
    target_include_directories(native_app_glue PUBLIC
        "${ANDROID_NDK}/sources/android/native_app_glue")
endif()

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
# NativeActivity's ANativeWindow and renders one ECS scene. See host_cpp/main.cpp.
if(ANDROID)
    add_library(estella_host SHARED host_cpp/main.cpp)
    target_link_libraries(estella_host esengine native_app_glue android log)
    set_target_properties(estella_host PROPERTIES LINK_FLAGS "-u ANativeActivity_onCreate")
endif()

# JS host (opt-in): a QuickJS game script drives the engine through the
# EHT-generated bindings + the real SDK ptrAccessors. Built only when QuickJS is
# provided; the `node build-tools/cli.js native --quickjs <dir>` orchestration
# fetches QuickJS, generates NativeBindings.generated.cpp (single reflection
# source) and ptraccessors_js.h into ESTELLA_NATIVE_GEN_DIR, then configures this.
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

    # QuickJS-ng interpreter — core is just these four C files.
    add_library(qjs STATIC
        "${ESTELLA_QUICKJS_DIR}/quickjs.c" "${ESTELLA_QUICKJS_DIR}/libregexp.c"
        "${ESTELLA_QUICKJS_DIR}/libunicode.c" "${ESTELLA_QUICKJS_DIR}/dtoa.c")
    target_include_directories(qjs PUBLIC "${ESTELLA_QUICKJS_DIR}")
    target_compile_definitions(qjs PRIVATE _GNU_SOURCE)
    target_compile_options(qjs PRIVATE -Wno-unused -Wno-sign-compare)

    # basis_universal transcoder (KTX2 -> ETC2/ASTC/BC), one big vendored TU behind
    # host_js/ktx2_decode.cpp, plus basis's bundled single-file zstd decoder (KTX2
    # zstd supercompression). Third-party, so silence their warnings.
    set(BASIS_TRANSCODER "${TP}/basis_universal/transcoder/basisu_transcoder.cpp")
    set(BASIS_ZSTD "${TP}/basis_universal/zstd/zstddeclib.c")
    set_source_files_properties("${BASIS_TRANSCODER}" "${BASIS_ZSTD}" PROPERTIES COMPILE_OPTIONS "-w")

    # host_js/host_core.cpp is the platform-independent host; each platform adds its own
    # glue TU (the event loop, the window, the packaged assets).
    if(ESTELLA_IOS)
        # Static: the thin Xcode app (native/ios) links this plus the libraries
        # below. -ObjC on the app keeps the Obj-C classes in main_ios.mm alive.
        add_library(estella_js_host STATIC host_js/host_core.cpp host_js/main_ios.mm
            host_js/native_audio.cpp host_js/ktx2_decode.cpp "${BASIS_TRANSCODER}" "${BASIS_ZSTD}" "${NATIVE_BINDINGS}")
        # miniaudio's CoreAudio backend uses AVAudioSession (Obj-C), so its TU must
        # be Objective-C++ on Apple; it also forces MA_NO_RUNTIME_LINKING there, so
        # the audio frameworks are linked at build time (the app links the merged
        # archive, so these also live in native/ios/project.yml).
        set_source_files_properties(host_js/native_audio.cpp PROPERTIES
            COMPILE_OPTIONS "-x;objective-c++")
        target_link_libraries(estella_js_host esengine qjs
            "-framework UIKit" "-framework QuartzCore" "-framework Foundation"
            "-framework AVFoundation" "-framework CoreAudio" "-framework AudioToolbox")
        # Merge host + engine + deps + Dawn into ONE archive, so the Xcode app is a
        # thin shell that links a single library at a fixed path (native/ios).
        add_custom_command(TARGET estella_js_host POST_BUILD
            COMMAND libtool -static -o "${CMAKE_BINARY_DIR}/libestella_ios.a"
                    $<TARGET_FILE:estella_js_host> $<TARGET_FILE:esengine>
                    $<TARGET_FILE:qjs> $<TARGET_FILE:yogacore> "${ESTELLA_DAWN_LIB}"
            COMMENT "Merging the iOS host, engine and Dawn into libestella_ios.a")
    else()
        # Android: plain C++; miniaudio dlopens AAudio/OpenSL at runtime (no extra
        # link libs). native_audio.cpp's Obj-C paths are __APPLE__-guarded out.
        add_library(estella_js_host SHARED host_js/host_core.cpp host_js/main_android.cpp
            host_js/native_audio.cpp host_js/ktx2_decode.cpp "${BASIS_TRANSCODER}" "${BASIS_ZSTD}" "${NATIVE_BINDINGS}")
        target_link_libraries(estella_js_host esengine qjs native_app_glue android log)
        set_target_properties(estella_js_host PROPERTIES LINK_FLAGS "-u ANativeActivity_onCreate")
    endif()
    # host_js/ holds esn_shim.hpp + host_core.hpp (the generated TU includes the shim);
    # the gen dir holds ptraccessors_js.h and the embedded SDK bundle; third_party/miniaudio
    # is the audio engine header.
    target_include_directories(estella_js_host PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/host_js" "${ESTELLA_NATIVE_GEN_DIR}" "${TP}/miniaudio"
        "${TP}/basis_universal/transcoder")
endif()
