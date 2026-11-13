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
# The C dependencies (QuickJS-ng, Box2D) use C11 atomics. Clang and GCC default
# high enough that this never had to be said; MSVC defaults to C89 and stops at
# <stdatomic.h>.
set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

if(NOT ESTELLA_DAWN_DIR OR NOT ESTELLA_DAWN_BUILD)
    message(FATAL_ERROR "Set ESTELLA_DAWN_DIR (Dawn source) and ESTELLA_DAWN_BUILD (Dawn arm64 build). See native/README.md.")
endif()

# iOS is checked FIRST because it is also APPLE: the desktop branch below would
# otherwise swallow it and try to open an SDL window on a phone.
if(CMAKE_SYSTEM_NAME STREQUAL "iOS")
    set(ESTELLA_IOS ON)
elseif(ANDROID)
    # Its own branch by exclusion; nothing to set.
elseif(APPLE)
    set(ESTELLA_DESKTOP ON)
    set(ESTELLA_MACOS ON)
elseif(WIN32)
    set(ESTELLA_DESKTOP ON)
    set(ESTELLA_WINDOWS ON)
elseif(UNIX)
    set(ESTELLA_DESKTOP ON)
    set(ESTELLA_LINUX ON)
else()
    message(FATAL_ERROR "Unsupported platform: configure with the NDK toolchain (Android), "
        "-DCMAKE_SYSTEM_NAME=iOS, or run on macOS/Windows/Linux for the desktop host.")
endif()

# The desktop host is an EXECUTABLE that embeds everything (see docs/REARCH_STEAM.md
# §3): SDL supplies the window, the event loop and the gamepads on all three OSes.
if(ESTELLA_DESKTOP)
    if(NOT ESTELLA_SDL_DIR)
        message(FATAL_ERROR "Set ESTELLA_SDL_DIR (an SDL3 install prefix). "
            "`node build-tools/cli.js native --fetch-deps` fetches it; the build installs it.")
    endif()
    find_package(SDL3 CONFIG REQUIRED PATHS "${ESTELLA_SDL_DIR}" NO_DEFAULT_PATH)
endif()

# The engine's sources are UTF-8, and MSVC reads them in the machine's ANSI
# codepage unless told otherwise — so on a Chinese or Japanese Windows a `…` inside
# a string literal becomes "constant contains a newline" and the build stops. Not a
# warning to silence: without this the compiler is reading different bytes than
# were written.
if(MSVC)
    add_compile_options(/utf-8)
endif()

# Vendored third-party code is not ours to lint — and the flag that says so is not
# the same word in every compiler, which is how a build that only ever ran on
# clang passed `-w` to cl.exe and stopped at the first file.
function(es_silence_warnings target)
    if(MSVC)
        target_compile_options(${target} PRIVATE /w)
    else()
        target_compile_options(${target} PRIVATE -w)
    endif()
endfunction()

set(REPO "${CMAKE_CURRENT_SOURCE_DIR}/..")
set(SRC "${REPO}/src")
set(TP "${REPO}/third_party")

# Prebuilt monolithic Dawn: a shared library on Android, a static one on iOS (where
# the app embeds everything). Override ESTELLA_DAWN_LIB if your build lays it out
# elsewhere. A device build and a simulator build are different target triples, so
# each needs its own Dawn — see ESTELLA_IOS_SIMULATOR below.
if(ESTELLA_IOS OR ESTELLA_DESKTOP)
    if(NOT ESTELLA_DAWN_LIB)
        # MSVC names a static library <name>.lib; everyone else lib<name>.a.
        if(ESTELLA_WINDOWS)
            set(ESTELLA_DAWN_LIB "${ESTELLA_DAWN_BUILD}/src/dawn/native/webgpu_dawn.lib")
        else()
            set(ESTELLA_DAWN_LIB "${ESTELLA_DAWN_BUILD}/src/dawn/native/libwebgpu_dawn.a")
        endif()
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
if(APPLE AND NOT ANDROID)
    # Dawn's Metal backend pulls these in; a static Dawn does not carry them along.
    # IOKit is macOS-only — the desktop backend enumerates adapters through the IO
    # registry, which is not a thing an iOS app is allowed to do.
    set(ESTELLA_DAWN_FRAMEWORKS
        "-framework Metal;-framework QuartzCore;-framework Foundation;-framework IOSurface;-framework CoreGraphics")
    if(ESTELLA_MACOS)
        list(APPEND ESTELLA_DAWN_FRAMEWORKS "-framework IOKit" "-framework Cocoa")
    endif()
    set_target_properties(webgpu_dawn PROPERTIES
        INTERFACE_LINK_LIBRARIES "${ESTELLA_DAWN_FRAMEWORKS}")
endif()

# glm + yoga (the engine's non-emscripten third-party deps).
add_library(glm INTERFACE)
target_include_directories(glm INTERFACE "${TP}/glm")
target_compile_definitions(glm INTERFACE GLM_FORCE_RADIANS GLM_FORCE_DEPTH_ZERO_TO_ONE GLM_ENABLE_EXPERIMENTAL)

file(GLOB_RECURSE YOGA_SOURCES "${TP}/yoga/*.cpp")
add_library(yogacore STATIC ${YOGA_SOURCES})
target_include_directories(yogacore PUBLIC "${TP}")
es_silence_warnings(yogacore)

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

# Jolt, on the same reasoning as Box2D above: the 3D world is a wasm side module
# on the web and a linked-in library here. Its own sources, globbed — the vendored
# tree carries no CMake of its own (see third_party/CMakeLists.txt, which builds
# it the same way for the web).
file(GLOB_RECURSE JOLT_SOURCES "${TP}/jolt/Jolt/*.cpp")
add_library(jolt STATIC ${JOLT_SOURCES})
target_include_directories(jolt PUBLIC "${TP}/jolt")
target_compile_features(jolt PUBLIC cxx_std_17)
target_compile_definitions(jolt PUBLIC JPH_USE_CPU_COMPUTE)
es_silence_warnings(jolt)

# The Spine runtimes: every vendored release, each with the module's entry points,
# side by side in one host — as the web carries a side module per version, so a
# skeleton is read by the runtime it was exported from whatever the project
# setting says (#115).
#
# The releases define the same names, so each is compiled apart:
#   - spine-c (2.1 / 3.8 / 4.1 / 4.2) with native/spine/SpineCRename<tag>.hpp
#     force-included, prefixing every C symbol it defines or expects from the
#     backend (tools/spine-c-rename.mjs reads them off the compiled objects);
#     spine-cpp (4.3) lives in namespace spine and needs none;
#   - the backend in namespace es::spine<tag> (ES_SPINE_NS);
#   - the spine_* entry points renamed spine<tag>_* by the header EHT writes
#     beside their wrappers (build-tools/tasks/native.js), which register them as
#     es_spine<tag>_*: the names sdk/src/ecs/bridge/nativeSideModules.ts asks for.
#
# ESTELLA_SPINE_VERSIONS narrows the set (a size experiment, a missing submodule);
# the template records what was linked, and an export warns about a skeleton of a
# release it does not carry.
if(NOT ESTELLA_NATIVE_GEN_DIR)
    set(ESTELLA_NATIVE_GEN_DIR "${CMAKE_BINARY_DIR}/gen")
endif()
file(GLOB _spine_trees LIST_DIRECTORIES true "${TP}/spine-runtimes-*")
set(_spine_vendored "")
foreach(_tree IN LISTS _spine_trees)
    get_filename_component(_name "${_tree}" NAME)
    string(REPLACE "spine-runtimes-" "" _v "${_name}")
    list(APPEND _spine_vendored "${_v}")
endforeach()
set(ESTELLA_SPINE_VERSIONS "${_spine_vendored}" CACHE STRING
    "Spine releases the host carries, ;-separated (default: every vendored one)")
set(ESTELLA_SPINE_TARGETS "")
set(ESTELLA_SPINE_RUNTIMES "")
set(ESTELLA_SPINE_FN_BINDINGS "")
foreach(_v IN LISTS ESTELLA_SPINE_VERSIONS)
    set(_root "${TP}/spine-runtimes-${_v}")
    string(REPLACE "." "" _tag "${_v}")
    set(_c_rename "")
    if(EXISTS "${_root}/spine-c/spine-c/include")
        set(_backend "${SRC}/esengine/bindings/modules/spine/SpineRuntimeC.cpp")
        set(_inc "${_root}/spine-c/spine-c/include")
        file(GLOB _sources "${_root}/spine-c/spine-c/src/spine/*.c")
        set(_c_rename "${CMAKE_CURRENT_SOURCE_DIR}/spine/SpineCRename${_tag}.hpp")
    elseif(EXISTS "${_root}/spine-cpp/include")
        set(_backend "${SRC}/esengine/bindings/modules/spine/SpineRuntimeCpp.cpp")
        set(_inc "${_root}/spine-cpp/include")
        file(GLOB _sources "${_root}/spine-cpp/src/spine/*.cpp")
    elseif(EXISTS "${_root}/spine-c/include/spine")
        set(_backend "${SRC}/esengine/bindings/modules/spine/SpineRuntime21.cpp")
        set(_inc "${_root}/spine-c/include")
        file(GLOB _sources "${_root}/spine-c/src/spine/*.c")
        set(_c_rename "${CMAKE_CURRENT_SOURCE_DIR}/spine/SpineCRename${_tag}.hpp")
    else()
        message(FATAL_ERROR "Spine runtime ${_v} not vendored at ${_root} "
            "(ESTELLA_SPINE_VERSIONS=${ESTELLA_SPINE_VERSIONS}).")
    endif()
    if(_c_rename AND NOT EXISTS "${_c_rename}")
        message(FATAL_ERROR "Missing ${_c_rename} — run `node tools/spine-c-rename.mjs`.")
    endif()
    set(_fn_rename "${ESTELLA_NATIVE_GEN_DIR}/SpineRename${_tag}.generated.hpp")

    # PRIVATE includes throughout: every release has its own spine/spine.h.
    add_library(spine_runtime_${_tag} STATIC ${_sources})
    target_include_directories(spine_runtime_${_tag} PRIVATE "${_inc}")
    es_silence_warnings(spine_runtime_${_tag})

    add_library(estella_spine_${_tag} STATIC
        "${SRC}/esengine/bindings/modules/spine/SpineModuleEntry.cpp" "${_backend}")
    target_include_directories(estella_spine_${_tag} PUBLIC "${SRC}" PRIVATE "${_inc}")
    target_link_libraries(estella_spine_${_tag} PUBLIC spine_runtime_${_tag})
    target_compile_definitions(estella_spine_${_tag} PRIVATE
        ES_SPINE_VERSION=${_tag} ES_SPINE_NS=spine${_tag})
    foreach(_header IN ITEMS "${_c_rename}" "${_fn_rename}")
        if(NOT _header)
            continue()
        endif()
        if(MSVC)
            set(_fi "/FI${_header}")
        else()
            set(_fi "SHELL:-include \"${_header}\"")
        endif()
        target_compile_options(estella_spine_${_tag} PRIVATE "${_fi}")
        if(_header STREQUAL _c_rename)
            target_compile_options(spine_runtime_${_tag} PRIVATE "${_fi}")
        endif()
    endforeach()

    list(APPEND ESTELLA_SPINE_TARGETS estella_spine_${_tag})
    list(APPEND ESTELLA_SPINE_RUNTIMES spine_runtime_${_tag})
    list(APPEND ESTELLA_SPINE_FN_BINDINGS "${ESTELLA_NATIVE_GEN_DIR}/SpineFunctionBindings${_tag}.generated.cpp")
    string(APPEND _spine_tag_list " X(${_tag})")
endforeach()
# The releases this host was built with, for host/Runtime.cpp to register (or, on
# Android, to look for as libraries): ES_SPINE_TAGS(X) expands X(38) X(42) ….
file(WRITE "${ESTELLA_NATIVE_GEN_DIR}/SpineTags.generated.hpp.in"
    "// Generated by native/CMakeLists.txt — the Spine releases this host carries.
"
    "#pragma once
#define ES_SPINE_TAGS(X)${_spine_tag_list}
")
configure_file("${ESTELLA_NATIVE_GEN_DIR}/SpineTags.generated.hpp.in"
    "${ESTELLA_NATIVE_GEN_DIR}/SpineTags.generated.hpp" COPYONLY)

# DragonBones: the same two TUs the web links as the "dragonbones" side module,
# over the vendored core. One runtime, not one per version — the format is frozen,
# so there is no ESTELLA_DRAGONBONES_VERSION to pick.
file(GLOB_RECURSE DRAGONBONES_SOURCES "${TP}/dragonbones/src/dragonBones/*.cpp")
add_library(dragonbones_runtime STATIC ${DRAGONBONES_SOURCES})
target_include_directories(dragonbones_runtime PUBLIC "${TP}/dragonbones/src" "${TP}/rapidjson")
es_silence_warnings(dragonbones_runtime)

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

set(ESTELLA_PHYSICS3D_SOURCES
    "${SRC}/esengine/bindings/modules/physics3d/Physics3DModuleEntry.cpp"
    "${SRC}/esengine/bindings/modules/physics3d/Physics3DConstraints.cpp")
add_library(estella_physics3d STATIC ${ESTELLA_PHYSICS3D_SOURCES})
target_include_directories(estella_physics3d PUBLIC "${SRC}")
target_link_libraries(estella_physics3d PUBLIC jolt)

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

if(ESTELLA_DESKTOP)
    add_executable(test_native_renderer EXCLUDE_FROM_ALL
        "${REPO}/tests/renderer/test_batch_builder.cpp")
    target_include_directories(test_native_renderer PRIVATE "${TP}/doctest")
    target_link_libraries(test_native_renderer PRIVATE esengine)
endif()

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

    # PhysX, the second 3D solver a project can pick (Project Settings → Physics →
    # 3D solver), linked BESIDE Jolt rather than instead of it: which one runs is
    # the project's choice at boot, and a host binary is shared by every game.
    # Both implement the one physics3d_* surface, so PhysX's TUs are compiled with
    # a generated rename header (physics3d_init → physx3d_init, every name the
    # header declares) and the wrappers bind that copy as es_physx3d_*, from the
    # same declarations — the SDK maps the module id onto that prefix
    # (sdk/src/ecs/bridge/nativeSideModules.ts). Off on Apple platforms: PhysX 5
    # dropped macOS/iOS from its supported set and it has not been built on a Mac
    # here, so a PhysX project there runs on Jolt and is told so.
    if(APPLE)
        set(_physx_default OFF)
    else()
        set(_physx_default ON)
    endif()
    option(ESTELLA_PHYSX "Link PhysX beside Jolt as the per-project 3D solver" ${_physx_default})
    if(ESTELLA_PHYSX)
        set(PHYSX_RENAME "${ESTELLA_NATIVE_GEN_DIR}/PhysX3DRename.generated.hpp")
        if(NOT EXISTS "${PHYSX_RENAME}")
            message(FATAL_ERROR "Missing ${PHYSX_RENAME} — generate it via `cli native`, "
                "or configure with -DESTELLA_PHYSX=OFF.")
        endif()
        include("${REPO}/cmake/PhysX.cmake")
        es_add_physx_library("${TP}/physx")
        if(NOT MSVC)
            # As on the web: PhysX uses neither, and dropping them is 0.5 MB of the
            # Android library. Kept at the host's -O3 (as Jolt is): -Os saves another
            # 0.45 MB compressed and costs the solver its speed on the device.
            target_compile_options(physx PUBLIC -fno-exceptions -fno-rtti)
        endif()
        set(_PXM "${SRC}/esengine/bindings/modules/physics3d_physx")
        add_library(estella_physics3d_physx STATIC
            "${_PXM}/PhysXModuleEntry.cpp" "${_PXM}/PhysXQueries.cpp" "${_PXM}/PhysXJoints.cpp")
        target_include_directories(estella_physics3d_physx PUBLIC "${SRC}")
        target_link_libraries(estella_physics3d_physx PUBLIC physx)
        if(MSVC)
            target_compile_options(estella_physics3d_physx PRIVATE "/FI${PHYSX_RENAME}")
        else()
            target_compile_options(estella_physics3d_physx PRIVATE -include "${PHYSX_RENAME}")
        endif()
        # INTERFACE: what tells a TU that links this that PhysX is in its binary.
        target_compile_definitions(estella_physics3d_physx INTERFACE ES_ENABLE_PHYSX)
        # PhysX's es_physx3d_* wrappers, generated from the same declarations as
        # Jolt's (build-tools/tasks/native.js, PHYSX_ALIAS) and linked wherever
        # PhysX is: into the host on a desktop, into libestella_physx.so on Android.
        set(PHYSX_FN_BINDINGS "${ESTELLA_NATIVE_GEN_DIR}/PhysX3DFunctionBindings.generated.cpp")
        if(NOT EXISTS "${PHYSX_FN_BINDINGS}")
            message(FATAL_ERROR "Missing ${PHYSX_FN_BINDINGS} — generate it via `cli native`.")
        endif()
    endif()

    # QuickJS-ng interpreter — core is just these four C files.
    add_library(qjs STATIC
        "${ESTELLA_QUICKJS_DIR}/quickjs.c" "${ESTELLA_QUICKJS_DIR}/libregexp.c"
        "${ESTELLA_QUICKJS_DIR}/libunicode.c" "${ESTELLA_QUICKJS_DIR}/dtoa.c")
    target_include_directories(qjs PUBLIC "${ESTELLA_QUICKJS_DIR}")
    target_compile_definitions(qjs PRIVATE _GNU_SOURCE)
    es_silence_warnings(qjs)

    # The JS engine the host embeds, behind host/js/esjs.hpp. V8 where a JIT is
    # allowed and a prebuilt V8 was handed in (ESTELLA_V8_DIR, staged by
    # `cli native`); QuickJS otherwise — and always on iOS, which allows no JIT.
    # One build carries one engine, so the choice is a source file, not a branch.
    set(ESTELLA_JS_ENGINE "" CACHE STRING
        "JS engine for the native host: v8 | quickjs (empty: v8 when ESTELLA_V8_DIR is set and the platform allows a JIT)")
    set(ESTELLA_V8_DIR "" CACHE PATH "A prebuilt V8 (include/ + the platform's libraries)")
    set(ESJS_ENGINE "${ESTELLA_JS_ENGINE}")
    if(NOT ESJS_ENGINE)
        if(ESTELLA_V8_DIR AND NOT ESTELLA_IOS)
            set(ESJS_ENGINE v8)
        else()
            set(ESJS_ENGINE quickjs)
        endif()
    endif()
    add_library(esjs_engine INTERFACE)
    set(ESTELLA_V8_RUNTIME "")
    if(ESJS_ENGINE STREQUAL "v8")
        if(ESTELLA_IOS)
            message(FATAL_ERROR "iOS allows no JIT: the native host embeds QuickJS there.")
        endif()
        if(NOT EXISTS "${ESTELLA_V8_DIR}/include/v8.h")
            message(FATAL_ERROR "ESTELLA_JS_ENGINE=v8 needs ESTELLA_V8_DIR with include/v8.h (got '${ESTELLA_V8_DIR}').")
        endif()
        target_include_directories(esjs_engine INTERFACE "${ESTELLA_V8_DIR}/include")
        # The embedder must be compiled as V8 was, or V8::Initialize refuses it:
        # both prebuilts compress pointers on 64-bit targets.
        if(CMAKE_SIZEOF_VOID_P EQUAL 8)
            target_compile_definitions(esjs_engine INTERFACE V8_COMPRESS_POINTERS V8_31BIT_SMIS_ON_64BIT_ARCH)
        endif()
        if(ANDROID)
            set(_v8_so "${ESTELLA_V8_DIR}/jni/${ANDROID_ABI}/libv8android.so")
            if(NOT EXISTS "${_v8_so}")
                message(FATAL_ERROR "No V8 for ${ANDROID_ABI}: ${_v8_so} is missing.")
            endif()
            add_library(esjs_v8 SHARED IMPORTED)
            set_target_properties(esjs_v8 PROPERTIES IMPORTED_LOCATION "${_v8_so}")
            target_link_libraries(esjs_engine INTERFACE esjs_v8)
            # This V8 keeps its startup snapshot outside the library; the package
            # carries it as an asset and the host hands it over before Isolate::New.
            set(_v8_snapshot "${ESTELLA_V8_DIR}/snapshot/${ANDROID_ABI}/snapshot_blob.bin")
            if(NOT EXISTS "${_v8_snapshot}")
                message(FATAL_ERROR "No V8 startup snapshot for ${ANDROID_ABI}: ${_v8_snapshot} is missing (re-run --fetch-deps).")
            endif()
            target_compile_definitions(esjs_engine INTERFACE
                ESJS_V8_SNAPSHOT_ASSET="v8/${ANDROID_ABI}/snapshot_blob.bin")
        elseif(WIN32)
            set(_v8_lib "${ESTELLA_V8_DIR}/lib/Release")
            # The Windows build carries Intl, whose data file ships beside the exe.
            target_compile_definitions(esjs_engine INTERFACE ESJS_V8_ICU)
            target_link_libraries(esjs_engine INTERFACE
                "${_v8_lib}/v8.dll.lib" "${_v8_lib}/v8_libbase.dll.lib" "${_v8_lib}/v8_libplatform.dll.lib"
                winmm dbghelp shlwapi)
            file(GLOB ESTELLA_V8_RUNTIME "${_v8_lib}/*.dll" "${_v8_lib}/icudtl.dat")
        else()
            message(FATAL_ERROR "No prebuilt V8 is wired for this platform yet: configure with -DESTELLA_JS_ENGINE=quickjs.")
        endif()
        set(ESJS_BACKEND host/js/esjs_v8.cpp)
        if(MSVC)
            # V8's headers test __cplusplus, which MSVC reports as C++98 without this.
            set_source_files_properties(host/js/esjs_v8.cpp PROPERTIES COMPILE_OPTIONS "/Zc:__cplusplus")
        endif()
    elseif(ESJS_ENGINE STREQUAL "quickjs")
        target_link_libraries(esjs_engine INTERFACE qjs)
        set(ESJS_BACKEND host/js/esjs_quickjs.cpp)
    else()
        message(FATAL_ERROR "ESTELLA_JS_ENGINE must be v8 or quickjs (got '${ESJS_ENGINE}').")
    endif()
    message(STATUS "Native host JS engine: ${ESJS_ENGINE}")

    # basis_universal transcoder (KTX2 -> ETC2/ASTC/BC), one big vendored TU behind
    # host/media/ktx2_decode.cpp, plus basis's bundled single-file zstd decoder (KTX2
    # zstd supercompression). Third-party, so silence their warnings.
    set(BASIS_TRANSCODER "${TP}/basis_universal/transcoder/basisu_transcoder.cpp")
    set(BASIS_ZSTD "${TP}/basis_universal/zstd/zstddeclib.c")
    set_source_files_properties("${BASIS_TRANSCODER}" "${BASIS_ZSTD}"
        PROPERTIES COMPILE_OPTIONS "$<IF:$<BOOL:${MSVC}>,/w,-w>")

    # The host, by concern: the runtime + the es_* bindings + the frame are shared,
    # and each platform adds its own glue TU (the event loop, the window, the
    # packaged assets). See native/host/Host.hpp for the layering.
    set(HOST_SOURCES
        host/Host.cpp
        host/Runtime.cpp
        host/BootLog.cpp
        host/Shot.cpp
        host/Bench.cpp
        host/EsnShim.cpp
        ${ESJS_BACKEND}
        host/bindings/HeapBindings.cpp
        host/bindings/EcsBindings.cpp
        host/bindings/RenderBindings.cpp
        host/bindings/AssetBindings.cpp
        host/bindings/AudioBindings.cpp
        host/bindings/InputBindings.cpp
        $<$<BOOL:${ESTELLA_DESKTOP}>:host/steam/SteamApi.cpp>
        $<$<BOOL:${ESTELLA_DESKTOP}>:host/bindings/SteamBindings.cpp>
        # Desktop-only because it is the editing surface no desktop OS supplies;
        # a phone's keyboard IS one, so there is nothing here for it to be.
        $<$<BOOL:${ESTELLA_DESKTOP}>:host/media/text_edit.cpp>
        host/bindings/NetBindings.cpp
        host/bindings/DeviceBindings.cpp
        host/net/WsClient.cpp
        host/bindings/TextEditorBindings.cpp
        host/bindings/ChannelBindings.cpp
        host/bindings/AotBindings.cpp
        # The name table a compiled system is dispatched through — generated
        # from the same reflection the component bindings above come from.
        ${CMAKE_CURRENT_SOURCE_DIR}/../src/esengine/aot/AotComponents.generated.cpp
        host/media/native_audio.cpp
        host/media/audio_spectrum.cpp
        host/media/ktx2_decode.cpp
        host/media/glyph_raster.cpp
        "${BASIS_TRANSCODER}" "${BASIS_ZSTD}" "${NATIVE_BINDINGS}" "${NATIVE_FN_BINDINGS}")

    if(ESTELLA_IOS)
        # Static: the thin Xcode app (native/ios) links this plus the libraries
        # below. -ObjC on the app keeps the Obj-C classes in platform/ios.mm alive.
        add_library(estella_js_host STATIC ${HOST_SOURCES} host/platform/ios.mm host/platform/ios_device.mm
            host/platform/apple_common.mm)
        # miniaudio's CoreAudio backend uses AVAudioSession (Obj-C), so its TU must
        # be Objective-C++ on Apple; it also forces MA_NO_RUNTIME_LINKING there, so
        # the audio frameworks are linked at build time (the app links the merged
        # archive, so these also live in native/ios/project.yml).
        set_source_files_properties(host/media/native_audio.cpp
        host/media/audio_spectrum.cpp PROPERTIES
            COMPILE_OPTIONS "-x;objective-c++")
        target_link_libraries(estella_js_host esengine estella_physics estella_physics3d
            estella_video ${ESTELLA_SPINE_TARGETS}
            estella_dragonbones esjs_engine
            "-framework UIKit" "-framework QuartzCore" "-framework Foundation"
            "-framework CoreMotion" "-framework CoreHaptics"
            "-framework AVFoundation" "-framework CoreAudio" "-framework AudioToolbox"
            "-framework CoreText" "-framework CoreGraphics")
        target_sources(estella_js_host PRIVATE ${ESTELLA_SPINE_FN_BINDINGS})
        set(_spine_archives "")
        foreach(_t IN LISTS ESTELLA_SPINE_TARGETS ESTELLA_SPINE_RUNTIMES)
            list(APPEND _spine_archives "$<TARGET_FILE:${_t}>")
        endforeach()
        # Merge host + engine + deps + Dawn into ONE archive, so the Xcode app is a
        # thin shell that links a single library at a fixed path (native/ios).
        add_custom_command(TARGET estella_js_host POST_BUILD
            COMMAND libtool -static -o "${CMAKE_BINARY_DIR}/libestella_ios.a"
                    $<TARGET_FILE:estella_js_host> $<TARGET_FILE:esengine>
                    $<TARGET_FILE:estella_physics> $<TARGET_FILE:box2d>
                    $<TARGET_FILE:estella_physics3d> $<TARGET_FILE:jolt>
                    $<TARGET_FILE:estella_video>
                    ${_spine_archives}
                    $<TARGET_FILE:estella_dragonbones> $<TARGET_FILE:dragonbones_runtime>
                    $<TARGET_FILE:qjs> $<TARGET_FILE:yogacore> "${ESTELLA_DAWN_LIB}"
            COMMENT "Merging the iOS host, engine and Dawn into libestella_ios.a")
    elseif(ESTELLA_DESKTOP)
        # An executable, not a library: on desktop there is no app shell to link
        # into — the binary IS the app, and the assembler only renames it and puts
        # the game's files beside it (docs/REARCH_STEAM.md §3).
        #
        # One glue TU (desktop.cpp) plus the per-OS half SDL does not cover: the
        # font match and the HTTP request.
        if(ESTELLA_WINDOWS)
            set(DESKTOP_OS_SOURCES host/platform/windows_common.cpp)
        elseif(ESTELLA_LINUX)
            set(DESKTOP_OS_SOURCES host/platform/linux_common.cpp)
        else()
            set(DESKTOP_OS_SOURCES host/platform/apple_common.mm)
        endif()
        add_executable(estella_js_host ${HOST_SOURCES} host/platform/desktop.cpp
            ${DESKTOP_OS_SOURCES})
        set_target_properties(estella_js_host PROPERTIES OUTPUT_NAME estella_desktop)
        target_compile_definitions(estella_js_host PRIVATE ESTELLA_DESKTOP)
        target_link_libraries(estella_js_host esengine estella_physics estella_physics3d
            estella_video ${ESTELLA_SPINE_TARGETS} estella_dragonbones esjs_engine SDL3::SDL3)
        target_sources(estella_js_host PRIVATE ${ESTELLA_SPINE_FN_BINDINGS})
        if(TARGET estella_physics3d_physx)
            # Linked in: a desktop app's size is not a download a player waits on
            # the way a phone's is, and an executable cannot be linked against
            # by a library the way the Android host is below.
            target_sources(estella_js_host PRIVATE "${PHYSX_FN_BINDINGS}")
            target_link_libraries(estella_js_host estella_physics3d_physx)
        endif()
        if(ESTELLA_V8_RUNTIME)
            # V8 is a set of DLLs plus its Intl data; the exe finds them beside it.
            add_custom_command(TARGET estella_js_host POST_BUILD
                COMMAND ${CMAKE_COMMAND} -E copy_if_different ${ESTELLA_V8_RUNTIME} $<TARGET_FILE_DIR:estella_js_host>
                COMMENT "Placing the V8 runtime beside the desktop host")
        elseif(ESTELLA_WINDOWS)
            # A QuickJS host in a tree that once built V8: what that build placed
            # here would otherwise ride into this host's template as dead weight.
            add_custom_command(TARGET estella_js_host POST_BUILD
                COMMAND ${CMAKE_COMMAND} -E rm -f
                    $<TARGET_FILE_DIR:estella_js_host>/v8.dll $<TARGET_FILE_DIR:estella_js_host>/v8_libbase.dll
                    $<TARGET_FILE_DIR:estella_js_host>/v8_libplatform.dll $<TARGET_FILE_DIR:estella_js_host>/icuuc.dll
                    $<TARGET_FILE_DIR:estella_js_host>/icui18n.dll $<TARGET_FILE_DIR:estella_js_host>/zlib.dll
                    $<TARGET_FILE_DIR:estella_js_host>/icudtl.dat
                COMMENT "Clearing a V8 runtime a previous build left beside the host")
        endif()
        if(ESTELLA_WINDOWS)
            # Dawn's D3D12 backend, DirectWrite for the font match, WinHTTP for the
            # fetch. miniaudio reaches WASAPI through the COM headers it includes.
            # onecore for CompareObjectHandles, which Dawn's D3D shared fences call:
            # it lives in kernelbase, kernel32 does not re-export it, and the SDK
            # ships no kernelbase.lib — onecore is the umbrella that has it.
            target_link_libraries(estella_js_host d3d12 dxgi dxguid dwrite winhttp onecore ws2_32)
        elseif(ESTELLA_LINUX)
            # fontconfig for the font match; libcurl for the fetch, because Linux
            # is the one desktop with no OS-provided HTTP stack and no trust store
            # of its own to reach (see host/platform/linux_common.hpp). Both are
            # found through pkg-config, which is how every distribution describes
            # where it put them.
            find_package(PkgConfig REQUIRED)
            pkg_check_modules(FONTCONFIG REQUIRED IMPORTED_TARGET fontconfig)
            pkg_check_modules(LIBCURL REQUIRED IMPORTED_TARGET libcurl)
            target_link_libraries(estella_js_host PkgConfig::FONTCONFIG PkgConfig::LIBCURL
                ${CMAKE_DL_LIBS} pthread)
        else()
            # As on iOS: miniaudio's CoreAudio backend reaches for the Obj-C runtime,
            # so its TU is Objective-C++ on every Apple platform.
            set_source_files_properties(host/media/native_audio.cpp host/media/audio_spectrum.cpp
                PROPERTIES COMPILE_OPTIONS "-x;objective-c++")
            target_link_libraries(estella_js_host
                "-framework AVFoundation" "-framework CoreAudio" "-framework AudioToolbox"
                "-framework CoreText" "-framework CoreGraphics" "-framework Foundation")
        endif()
    else()
        # Android: plain C++; miniaudio dlopens AAudio/OpenSL at runtime (no extra
        # link libs). native_audio.cpp's Obj-C paths are __APPLE__-guarded out.
        add_library(estella_js_host SHARED ${HOST_SOURCES} host/platform/android.cpp host/platform/android_device.cpp)
        target_link_libraries(estella_js_host esengine estella_physics estella_physics3d
            estella_video estella_dragonbones esjs_engine native_app_glue android log)
        # Each Spine release a library of its own, as PhysX is below: a package
        # carries only the releases its skeletons were exported from (the export
        # reads them), the template keeps them under plugins/, and the host dlopens
        # whichever of libestella_spine<tag>.so the package has (host/Runtime.cpp).
        foreach(_spine IN LISTS ESTELLA_SPINE_TARGETS)
            string(REPLACE "estella_spine_" "" _tag "${_spine}")
            add_library(estella_spine${_tag} SHARED
                "${ESTELLA_NATIVE_GEN_DIR}/SpineFunctionBindings${_tag}.generated.cpp"
                host/plugins/spine_plugin.cpp)
            target_link_libraries(estella_spine${_tag} PRIVATE ${_spine} estella_js_host)
            target_include_directories(estella_spine${_tag} PRIVATE
                "${CMAKE_CURRENT_SOURCE_DIR}/host" "${ESTELLA_NATIVE_GEN_DIR}"
                $<TARGET_PROPERTY:esengine,INTERFACE_INCLUDE_DIRECTORIES>)
            target_compile_definitions(estella_spine${_tag} PRIVATE ES_SPINE_TAG=${_tag}
                $<TARGET_PROPERTY:esengine,INTERFACE_COMPILE_DEFINITIONS>)
        endforeach()
        if(TARGET estella_physics3d_physx)
            # A library of its own, so a package carries it only when its project
            # picked PhysX (4.9 MB per ABI): the template keeps it under plugins/,
            # the export copies it into lib/<abi>/, and the host dlopens it by name
            # (host/Runtime.cpp). It links against the host for the engine surface
            # and the heap its wrappers marshal through.
            add_library(estella_physx SHARED "${PHYSX_FN_BINDINGS}" host/plugins/physx_plugin.cpp)
            target_link_libraries(estella_physx PRIVATE estella_physics3d_physx estella_js_host)
            target_include_directories(estella_physx PRIVATE
                "${CMAKE_CURRENT_SOURCE_DIR}/host" "${ESTELLA_NATIVE_GEN_DIR}"
                $<TARGET_PROPERTY:esengine,INTERFACE_INCLUDE_DIRECTORIES>)
            target_compile_definitions(estella_physx PRIVATE
                $<TARGET_PROPERTY:esengine,INTERFACE_COMPILE_DEFINITIONS>)
        endif()
        set_target_properties(estella_js_host PROPERTIES LINK_FLAGS "-u ANativeActivity_onCreate")
        if(ESJS_ENGINE STREQUAL "v8")
            # The host links libv8android.so by name; the template takes it from
            # beside the host library (build-tools/utils/nativeTemplate.js).
            add_custom_command(TARGET estella_js_host POST_BUILD
                COMMAND ${CMAKE_COMMAND} -E copy_if_different "${_v8_so}" $<TARGET_FILE_DIR:estella_js_host>
                COMMAND ${CMAKE_COMMAND} -E copy_if_different "${_v8_snapshot}"
                        $<TARGET_FILE_DIR:estella_js_host>/v8_snapshot_blob.bin
                COMMENT "Placing libv8android.so and its startup snapshot beside the Android host")
        else()
            add_custom_command(TARGET estella_js_host POST_BUILD
                COMMAND ${CMAKE_COMMAND} -E rm -f $<TARGET_FILE_DIR:estella_js_host>/libv8android.so
                        $<TARGET_FILE_DIR:estella_js_host>/v8_snapshot_blob.bin
                COMMENT "Clearing a V8 a previous build left beside the host")
        endif()
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
