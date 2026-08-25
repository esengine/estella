# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#
# Standalone on purpose. The bench needs QuickJS and two component headers —
# nothing else — so it configures in seconds and never waits on Dawn, the SDK
# bundle, or the generated native bindings the host build requires. Point it at
# the QuickJS the native build already fetched:
#
#   cmake -S bench/aot-stage0 -B build/cmake/aot-stage0 -DCMAKE_BUILD_TYPE=Release
#   cmake --build build/cmake/aot-stage0 --config Release
#
cmake_minimum_required(VERSION 3.20)
project(estella_aot_stage0 C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
# quickjs-ng uses C11 atomics; MSVC rejects them below /std:c11. Same pair
# native/CMakeLists.txt sets, for the same reason.
set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

# Variant C is the AOT ceiling, so an unoptimised build would not just be slow —
# it would answer the Stage 0 question wrongly, in the direction that says "go".
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)
endif()

get_filename_component(ESTELLA_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../.." ABSOLUTE)

if(NOT ESTELLA_QUICKJS_DIR)
    set(ESTELLA_QUICKJS_DIR "${ESTELLA_ROOT}/build/native-deps/quickjs")
endif()
if(NOT EXISTS "${ESTELLA_QUICKJS_DIR}/quickjs.c")
    message(FATAL_ERROR
        "No QuickJS at ${ESTELLA_QUICKJS_DIR}. The native build fetches it — run\n"
        "  node build-tools/cli.js native --quickjs <dir>\n"
        "or pass -DESTELLA_QUICKJS_DIR=<dir> pointing at a quickjs-ng checkout.")
endif()

# quickjs-ng core: four C files, same set the native host links.
add_library(qjs STATIC
    "${ESTELLA_QUICKJS_DIR}/quickjs.c"
    "${ESTELLA_QUICKJS_DIR}/libregexp.c"
    "${ESTELLA_QUICKJS_DIR}/libunicode.c"
    "${ESTELLA_QUICKJS_DIR}/dtoa.c")
target_include_directories(qjs PUBLIC "${ESTELLA_QUICKJS_DIR}")
target_compile_definitions(qjs PRIVATE _GNU_SOURCE)
if(MSVC)
    target_compile_options(qjs PRIVATE /w)
else()
    target_compile_options(qjs PRIVATE -w)
endif()

add_executable(bench_aot_stage0 bench.cpp)
target_link_libraries(bench_aot_stage0 PRIVATE qjs)
target_include_directories(bench_aot_stage0 PRIVATE
    "${ESTELLA_ROOT}/src"
    "${ESTELLA_ROOT}/third_party/glm")
target_compile_definitions(bench_aot_stage0 PRIVATE _CRT_SECURE_NO_WARNINGS)

# variants.js is read at run time, so the binary can sit anywhere as long as it
# is told where the file is. Bake the source path in as the default.
target_compile_definitions(bench_aot_stage0 PRIVATE
    BENCH_VARIANTS_DEFAULT="${CMAKE_CURRENT_SOURCE_DIR}/variants.js")
