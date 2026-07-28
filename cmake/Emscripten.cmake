# Emscripten Toolchain Configuration for ESEngine

if(NOT DEFINED EMSCRIPTEN)
    message(STATUS "Emscripten toolchain not detected, checking environment...")

    if(DEFINED ENV{EMSDK})
        set(EMSCRIPTEN_ROOT "$ENV{EMSDK}/upstream/emscripten")
        message(STATUS "Found EMSDK at: $ENV{EMSDK}")
    else()
        message(WARNING "EMSDK environment variable not set. Make sure to use 'emcmake cmake' for web builds.")
    endif()
endif()

# Emscripten-specific compiler flags
set(ES_EMSCRIPTEN_COMPILE_FLAGS
    -ffunction-sections
    -fdata-sections
    -fno-exceptions
)

# Wasm SIMD for the main module + render + math (RC8-1). `-msse2` makes emscripten
# define __SSE2__, which GLM auto-detects to vectorize vec4/mat4 ops; emscripten
# lowers the SSE intrinsics to wasm SIMD (`-msimd128`). We deliberately do NOT force
# aligned gentypes — GLM uses unaligned load/store, so component layouts and the
# zero-copy ptr offsets are unchanged (ABI_LAYOUT_HASH stays put). The physics module
# already ships SIMD to web AND wechat, so this is on by default with a compat
# fallback (`-DES_MAIN_DISABLE_SIMD=ON`) mirroring BOX2D_DISABLE_SIMD.
option(ES_MAIN_DISABLE_SIMD "Disable wasm SIMD for the main module (compat fallback)" OFF)
if(NOT ES_MAIN_DISABLE_SIMD)
    list(APPEND ES_EMSCRIPTEN_COMPILE_FLAGS -msimd128 -msse2)
endif()

# Standard (monolithic) link flags
set(ES_EMSCRIPTEN_LINK_FLAGS
    --bind                          # Enable embind for C++ bindings
    --emit-tsd esengine.d.ts        # Auto-generate TypeScript definitions
    -sWASM=1
    -sUSE_WEBGL2=1
    -sFULL_ES3=1
    -sALLOW_MEMORY_GROWTH=1
    -sNO_EXIT_RUNTIME=1
    -sASSERTIONS=1
    -sEXPORT_ES6=1                  # Export as ES6 module
    -sMODULARIZE=1                  # Wrap in module factory function
    "-sEXPORT_NAME='ESEngineModule'" # Module name
    # Exported functions (EMSCRIPTEN_KEEPALIVE + stdlib)
    "-sEXPORTED_FUNCTIONS=['_malloc','_free','_es_app_init']"
    "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','HEAPF32','HEAPU8','HEAPU32']"
    # Embed assets (fonts, etc.)
    "--embed-file=${CMAKE_SOURCE_DIR}/assets/fonts@/assets/fonts"
)

# =============================================================================
# Modular Build (Dynamic Linking) Configuration
# =============================================================================

# Main module link flags (MAIN_MODULE=2, supports loading side modules)
set(ES_EMSCRIPTEN_MAIN_MODULE_FLAGS
    --bind
    -sMAIN_MODULE=2
    -sWASM=1
    -sUSE_WEBGL2=1
    -sFULL_ES3=1
    -sALLOW_MEMORY_GROWTH=1
    -sALLOW_TABLE_GROWTH=1
    -sNO_EXIT_RUNTIME=1
    -sASSERTIONS=0
    -sEXPORT_ES6=1
    -sMODULARIZE=1
    -sFORCE_FILESYSTEM=1
    "-sEXPORT_NAME='ESEngineModule'"
    "-sEXPORTED_FUNCTIONS=['_malloc','_free']"
    # 'GL' is required for the WebGL2 context binding (module.GL.registerContext);
    # the monolithic web build exports it too — the main-module list had dropped it.
    "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','HEAPF32','HEAPU8','HEAPU32','GL','FS','addFunction','loadDynamicLibrary']"
    -O3
    -flto
    -Wl,--gc-sections
)

# WeChat MAIN_MODULE variant
set(ES_EMSCRIPTEN_WXGAME_MAIN_MODULE_FLAGS
    --bind
    -sMAIN_MODULE=2
    -sWASM=1
    -sUSE_WEBGL2=1
    -sFULL_ES3=1
    -sALLOW_MEMORY_GROWTH=1
    -sALLOW_TABLE_GROWTH=1
    -sNO_EXIT_RUNTIME=1
    -sENVIRONMENT=web
    -sEXPORT_ES6=0
    -sMODULARIZE=1
    -sFORCE_FILESYSTEM=1
    -sDYNAMIC_EXECUTION=0
    "--extern-pre-js=${CMAKE_SOURCE_DIR}/src/esengine/platform/web/wxgame-pre.js"
    "-sEXPORT_NAME='ESEngineModule'"
    "-sEXPORTED_FUNCTIONS=['_malloc','_free']"
    "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','HEAPF32','HEAPU8','HEAPU32','GL','FS','loadDynamicLibrary']"
    -O3
    -flto
    -Wl,--gc-sections
    --closure=0
)

# Physics side module flags (SIDE_MODULE=2, pure .wasm, no JS glue).
# SIDE_MODULE=2 already implies relocatable; the standalone -sRELOCATABLE=1 was
# removed in newer emscripten ("No longer supported"), so it's not listed.
set(ES_EMSCRIPTEN_PHYSICS_SIDE_MODULE_FLAGS
    -sSIDE_MODULE=2
    -sWASM=1
    -O3
    -flto
)

# Debug-specific flags
if(CMAKE_BUILD_TYPE STREQUAL "Debug")
    list(APPEND ES_EMSCRIPTEN_COMPILE_FLAGS
        -g
    )
    list(APPEND ES_EMSCRIPTEN_LINK_FLAGS
        -sASSERTIONS=2
        -sSAFE_HEAP=1
        -sSTACK_OVERFLOW_CHECK=2
    )
endif()

# Release-specific flags
if(CMAKE_BUILD_TYPE STREQUAL "Release")
    list(APPEND ES_EMSCRIPTEN_COMPILE_FLAGS
        -O3
    )
    list(APPEND ES_EMSCRIPTEN_LINK_FLAGS
        -O3
        -sASSERTIONS=0
        --closure=1
    )
endif()

# WeChat MiniGame SDK link flags (CommonJS compatible, no ES6)
set(ES_EMSCRIPTEN_WXGAME_SDK_FLAGS
    --bind
    -sWASM=1
    -sUSE_WEBGL2=1
    -sFULL_ES3=1
    -sALLOW_MEMORY_GROWTH=1
    -sNO_EXIT_RUNTIME=1
    -sENVIRONMENT=web
    -sEXPORT_ES6=0
    -sMODULARIZE=1
    -sFORCE_FILESYSTEM=1
    -sDYNAMIC_EXECUTION=0
    "--extern-pre-js=${CMAKE_SOURCE_DIR}/src/esengine/platform/web/wxgame-pre.js"
    "-sEXPORT_NAME='ESEngineModule'"
    "-sEXPORTED_FUNCTIONS=['_malloc','_free']"
    "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','HEAPF32','HEAPU8','HEAPU32','GL','FS']"
    -O3
    -flto
    -Wl,--gc-sections
    --closure=0
)

# Extra link flags that make a standalone module (physics/spine) load inside the
# WeChat MiniGame runtime: force ENVIRONMENT=web (no node/worker branches WeChat
# can't take) and inject the same window/document shim the engine wxgame build uses
# (ENVIRONMENT=web's module-level code touches them). Appended to the module flag
# sets only when ES_BUILD_WXGAME — the web variant keeps the multi-env default.
set(ES_EMSCRIPTEN_WXGAME_MODULE_EXTRA
    -sENVIRONMENT=web
    "--extern-pre-js=${CMAKE_SOURCE_DIR}/src/esengine/platform/web/wxgame-pre.js"
    --closure=0
)

# Helper function to apply Emscripten settings to a target (monolithic build)
function(es_apply_emscripten_settings TARGET_NAME)
    if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
        target_compile_options(${TARGET_NAME} PRIVATE ${ES_EMSCRIPTEN_COMPILE_FLAGS})

        string(REPLACE ";" " " LINK_FLAGS_STR "${ES_EMSCRIPTEN_LINK_FLAGS}")
        set_target_properties(${TARGET_NAME} PROPERTIES
            SUFFIX ".js"
            LINK_FLAGS "${LINK_FLAGS_STR}"
        )
    endif()
endfunction()

# Helper function to apply MAIN_MODULE settings
function(es_apply_main_module_settings TARGET_NAME)
    target_compile_options(${TARGET_NAME} PRIVATE ${ES_EMSCRIPTEN_COMPILE_FLAGS} -flto -fno-exceptions)

    string(REPLACE ";" " " LINK_FLAGS_STR "${ES_EMSCRIPTEN_MAIN_MODULE_FLAGS}")
    set_target_properties(${TARGET_NAME} PROPERTIES
        SUFFIX ".js"
        LINK_FLAGS "${LINK_FLAGS_STR}"
    )
    message(STATUS "Configured ${TARGET_NAME} as MAIN_MODULE")
endfunction()

# Helper function to apply WeChat MAIN_MODULE settings
function(es_apply_wxgame_main_module_settings TARGET_NAME)
    target_compile_options(${TARGET_NAME} PRIVATE ${ES_EMSCRIPTEN_COMPILE_FLAGS} -flto -fno-exceptions)

    string(REPLACE ";" " " LINK_FLAGS_STR "${ES_EMSCRIPTEN_WXGAME_MAIN_MODULE_FLAGS}")
    set_target_properties(${TARGET_NAME} PROPERTIES
        SUFFIX ".js"
        LINK_FLAGS "${LINK_FLAGS_STR}"
    )
    message(STATUS "Configured ${TARGET_NAME} as WXGAME MAIN_MODULE")
endfunction()

# Helper function to apply physics SIDE_MODULE settings
function(es_apply_physics_side_module_settings TARGET_NAME)
    # -fPIC is enough for side-module objects; -sRELOCATABLE was removed in newer
    # emscripten and SIDE_MODULE=2 (link flags) already makes the module relocatable.
    target_compile_options(${TARGET_NAME} PRIVATE -fPIC -flto)

    string(REPLACE ";" " " LINK_FLAGS_STR "${ES_EMSCRIPTEN_PHYSICS_SIDE_MODULE_FLAGS}")
    set_target_properties(${TARGET_NAME} PROPERTIES
        PREFIX ""
        SUFFIX ".wasm"
        LINK_FLAGS "${LINK_FLAGS_STR}"
    )
    message(STATUS "Configured ${TARGET_NAME} as SIDE_MODULE")
endfunction()

# SDK-specific link flags (library only, no app entry)
set(ES_EMSCRIPTEN_SDK_LINK_FLAGS
    --bind
    # --emit-tsd esengine.d.ts  # Temporarily disabled due to binding mismatch
    -sWASM=1
    -sUSE_WEBGL2=1
    -sFULL_ES3=1
    -sALLOW_MEMORY_GROWTH=1
    -sALLOW_TABLE_GROWTH=1
    -sNO_EXIT_RUNTIME=1
    -sASSERTIONS=0
    -sEXPORT_ES6=1
    -sMODULARIZE=1
    -sFORCE_FILESYSTEM=1
    "-sEXPORT_NAME='ESEngineModule'"
    "-sEXPORTED_FUNCTIONS=['_malloc','_free']"
    "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','HEAPF32','HEAPU8','HEAPU32','GL','FS','addFunction']"
    -O3
    -flto
    -Wl,--gc-sections
    --closure=0
)

function(es_apply_sdk_settings TARGET_NAME)
    if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
        target_compile_options(${TARGET_NAME} PRIVATE ${ES_EMSCRIPTEN_COMPILE_FLAGS} -flto -fno-exceptions)

        string(REPLACE ";" " " LINK_FLAGS_STR "${ES_EMSCRIPTEN_SDK_LINK_FLAGS}")
        set_target_properties(${TARGET_NAME} PROPERTIES
            SUFFIX ".js"
            LINK_FLAGS "${LINK_FLAGS_STR}"
        )
    endif()
endfunction()


function(es_apply_wxgame_sdk_settings TARGET_NAME)
    if(ES_BUILD_WXGAME)
        target_compile_options(${TARGET_NAME} PRIVATE ${ES_EMSCRIPTEN_COMPILE_FLAGS} -flto -fno-exceptions)

        string(REPLACE ";" " " LINK_FLAGS_STR "${ES_EMSCRIPTEN_WXGAME_SDK_FLAGS}")
        set_target_properties(${TARGET_NAME} PROPERTIES
            SUFFIX ".js"
            LINK_FLAGS "${LINK_FLAGS_STR}"
        )
    endif()
endfunction()

# =============================================================================
# Spine Module (standalone WASM, no GL)
# =============================================================================

set(ES_EMSCRIPTEN_SPINE_MODULE_FLAGS
    -sWASM=1
    -sALLOW_MEMORY_GROWTH=1
    -sNO_EXIT_RUNTIME=1
    -sEXPORT_ES6=0
    -sMODULARIZE=1
    -sDYNAMIC_EXECUTION=0
    -sFILESYSTEM=0
    "-sEXPORT_NAME='ESSpineModule'"
    "-sEXPORTED_FUNCTIONS=['_malloc','_free']"
    "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','UTF8ToString','stringToNewUTF8','HEAPF32','HEAPU8','HEAPU32']"
    -O3
    -flto
    -Wl,--gc-sections
    -fno-exceptions
    -fno-rtti
)

function(es_apply_spine_module_settings TARGET_NAME)
    if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
        # ARGN carries an optimisation level for the runtime behind this module; see
        # es_add_spine_module for why one of them wants a different one. It lands after
        # the shared flags, so it wins.
        target_compile_options(${TARGET_NAME} PRIVATE ${ES_EMSCRIPTEN_COMPILE_FLAGS}
            -flto -fno-exceptions -fno-rtti ${ARGN})

        set(_SPINE_LINK_FLAGS ${ES_EMSCRIPTEN_SPINE_MODULE_FLAGS})
        if(ES_BUILD_WXGAME)
            list(APPEND _SPINE_LINK_FLAGS ${ES_EMSCRIPTEN_WXGAME_MODULE_EXTRA})
        endif()
        string(REPLACE ";" " " LINK_FLAGS_STR "${_SPINE_LINK_FLAGS}")
        set_target_properties(${TARGET_NAME} PROPERTIES
            SUFFIX ".js"
            LINK_FLAGS "${LINK_FLAGS_STR}"
        )
    endif()
endfunction()

# Declares the wasm module for one vendored Spine release. The entry TU and the
# exported ABI are shared across releases; what differs is the runtime's own sources
# and the backend that speaks to them — and the tree's shape says which:
#
#   2.1               spine-c/{src,include}           the pure-C runtime, before it
#                                                     was nested a level deeper
#   3.8 / 4.1 / 4.2   spine-c/spine-c/{src,include}   the same runtime, nested
#   4.3+              spine-cpp/{src,include}         4.3 regenerated spine-c as a
#                                                     wrapper over C++, so bind C++
#
# A runtime nobody checked out is skipped, not an error: a shallow clone still builds
# the modules it has. A checked-out tree in a shape we don't know is an error, because
# silently skipping it would ship a project's Spine version as "unsupported".
function(es_add_spine_module TARGET_NAME VERSION OUTPUT_NAME)
    set(_root "${CMAKE_CURRENT_SOURCE_DIR}/third_party/spine-runtimes-${VERSION}")
    set(_bindings "${CMAKE_CURRENT_SOURCE_DIR}/src/esengine/bindings/modules/spine")

    if(NOT EXISTS "${_root}")
        return()
    endif()

    if(EXISTS "${_root}/spine-c/spine-c/include")
        set(_backend "${_bindings}/SpineRuntimeC.cpp")
        set(_include "${_root}/spine-c/spine-c/include")
        file(GLOB_RECURSE _runtime "${_root}/spine-c/spine-c/src/spine/*.c")
        # -Os would take a third off this module, and ~15% off the frame it poses in.
        # The C runtime's cost is its own posing loops, which is exactly what -O3 buys.
        set(_opt -O3)
    elseif(EXISTS "${_root}/spine-cpp/include")
        set(_backend "${_bindings}/SpineRuntimeCpp.cpp")
        set(_include "${_root}/spine-cpp/include")
        file(GLOB_RECURSE _runtime "${_root}/spine-cpp/src/spine/*.cpp")
        # The C++ runtime's size is template and RTTI bulk around the same hot loops,
        # so -Os halves the module (615 KB -> 333 KB) with no measurable frame cost:
        # 50 skeletons x 400 frames came out at 0.71 ms/frame against -O3's 0.76.
        set(_opt -Os)
    elseif(EXISTS "${_root}/spine-c/include/spine")
        # 2.1: the same C runtime one directory up, and a dialect far enough from 3.8
        # that it gets its own backend rather than an `#if` through that one.
        set(_backend "${_bindings}/SpineRuntime21.cpp")
        set(_include "${_root}/spine-c/include")
        file(GLOB_RECURSE _runtime "${_root}/spine-c/src/spine/*.c")
        set(_opt -O3)
    else()
        message(FATAL_ERROR
            "Spine ${VERSION} is checked out at ${_root} but neither spine-c nor "
            "spine-cpp is where this build expects it.")
    endif()

    string(REPLACE "." "" _tag ${VERSION})

    add_executable(${TARGET_NAME}
        "${_bindings}/SpineModuleEntry.cpp"
        "${_backend}"
        ${_runtime}
    )
    target_include_directories(${TARGET_NAME} PRIVATE "${_include}")
    target_compile_definitions(${TARGET_NAME} PRIVATE ES_SPINE_VERSION=${_tag})
    es_apply_spine_module_settings(${TARGET_NAME} ${_opt})
    set_target_properties(${TARGET_NAME} PROPERTIES
        OUTPUT_NAME "${OUTPUT_NAME}"
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/sdk"
    )
endfunction()

# =============================================================================
# DragonBones Module (standalone WASM, no GL)
# =============================================================================
# The same shape as the Spine modules — no GL, no filesystem, geometry read back
# through the heap — but one module rather than one per version: its format is
# frozen, so there is nothing for a second to differ about.

set(ES_EMSCRIPTEN_DRAGONBONES_MODULE_FLAGS
    -sWASM=1
    -sALLOW_MEMORY_GROWTH=1
    -sNO_EXIT_RUNTIME=1
    -sEXPORT_ES6=0
    -sMODULARIZE=1
    -sDYNAMIC_EXECUTION=0
    -sFILESYSTEM=0
    "-sEXPORT_NAME='ESDragonBonesModule'"
    "-sEXPORTED_FUNCTIONS=['_malloc','_free']"
    "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','UTF8ToString','stringToNewUTF8','HEAPF32','HEAPU8','HEAPU32']"
    -O3
    -flto
    -Wl,--gc-sections
    # Exceptions stay ON: the vendored parser throws on malformed data, and a
    # module that cannot catch that aborts the whole wasm instance instead of
    # returning the error its caller is written to read.
    -fno-rtti
)

function(es_apply_dragonbones_module_settings TARGET_NAME)
    target_compile_options(${TARGET_NAME} PRIVATE ${ES_EMSCRIPTEN_COMPILE_FLAGS})
    target_link_options(${TARGET_NAME} PRIVATE ${ES_EMSCRIPTEN_DRAGONBONES_MODULE_FLAGS})
endfunction()

# =============================================================================
# Basis Universal KTX2 Transcoder Module (standalone WASM, no GL)
# =============================================================================

set(ES_EMSCRIPTEN_BASIS_MODULE_FLAGS
    -sWASM=1
    -sALLOW_MEMORY_GROWTH=1
    -sNO_EXIT_RUNTIME=1
    -sEXPORT_ES6=0
    -sMODULARIZE=1
    -sDYNAMIC_EXECUTION=0
    -sFILESYSTEM=0
    "-sEXPORT_NAME='ESBasisModule'"
    "-sEXPORTED_FUNCTIONS=['_es_basis_init','_es_basis_open','_es_basis_get_width','_es_basis_get_height','_es_basis_transcoded_size','_es_basis_transcode','_es_basis_close','_malloc','_free']"
    "-sEXPORTED_RUNTIME_METHODS=['cwrap','HEAPU8','HEAPU32']"
    -O3
    -flto
    -Wl,--gc-sections
    -fno-exceptions
    -fno-rtti
)

function(es_apply_basis_module_settings TARGET_NAME)
    if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
        target_compile_options(${TARGET_NAME} PRIVATE ${ES_EMSCRIPTEN_COMPILE_FLAGS} -flto -fno-exceptions -fno-rtti)

        set(_BASIS_LINK_FLAGS ${ES_EMSCRIPTEN_BASIS_MODULE_FLAGS})
        if(ES_BUILD_WXGAME)
            list(APPEND _BASIS_LINK_FLAGS ${ES_EMSCRIPTEN_WXGAME_MODULE_EXTRA})
        endif()
        string(REPLACE ";" " " LINK_FLAGS_STR "${_BASIS_LINK_FLAGS}")
        set_target_properties(${TARGET_NAME} PROPERTIES
            SUFFIX ".js"
            LINK_FLAGS "${LINK_FLAGS_STR}"
        )
    endif()
endfunction()

# =============================================================================
# Video Decoder Module (pl_mpeg, standalone WASM, no GL)
# =============================================================================

set(ES_EMSCRIPTEN_VIDEO_MODULE_FLAGS
    -sWASM=1
    -sALLOW_MEMORY_GROWTH=1
    -sNO_EXIT_RUNTIME=1
    -sEXPORT_ES6=0
    -sMODULARIZE=1
    -sDYNAMIC_EXECUTION=0
    -sFILESYSTEM=0
    "-sEXPORT_NAME='ESVideoModule'"
    "-sEXPORTED_FUNCTIONS=['_es_video_open','_es_video_close','_es_video_width','_es_video_height','_es_video_duration','_es_video_framerate','_es_video_time','_es_video_set_loop','_es_video_has_ended','_es_video_advance','_es_video_frame_rgba','_es_video_seek','_malloc','_free']"
    "-sEXPORTED_RUNTIME_METHODS=['cwrap','HEAPU8','HEAPU32']"
    -O3
    -flto
    -Wl,--gc-sections
    -fno-exceptions
    -fno-rtti
)

function(es_apply_video_module_settings TARGET_NAME)
    if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
        target_compile_options(${TARGET_NAME} PRIVATE ${ES_EMSCRIPTEN_COMPILE_FLAGS} -flto -fno-exceptions -fno-rtti)

        set(_VIDEO_LINK_FLAGS ${ES_EMSCRIPTEN_VIDEO_MODULE_FLAGS})
        if(ES_BUILD_WXGAME)
            list(APPEND _VIDEO_LINK_FLAGS ${ES_EMSCRIPTEN_WXGAME_MODULE_EXTRA})
        endif()
        string(REPLACE ";" " " LINK_FLAGS_STR "${_VIDEO_LINK_FLAGS}")
        set_target_properties(${TARGET_NAME} PROPERTIES
            SUFFIX ".js"
            LINK_FLAGS "${LINK_FLAGS_STR}"
        )
    endif()
endfunction()

# =============================================================================
# Physics Module (standalone WASM, no GL)
# =============================================================================

set(ES_EMSCRIPTEN_PHYSICS_MODULE_FLAGS
    -sWASM=1
    -sALLOW_MEMORY_GROWTH=1
    -sMAXIMUM_MEMORY=4294967296
    -sINITIAL_MEMORY=33554432
    -sNO_EXIT_RUNTIME=1
    -sEXPORT_ES6=0
    -sMODULARIZE=1
    -sDYNAMIC_EXECUTION=0
    "-sEXPORT_NAME='ESPhysicsModule'"
    "-sEXPORTED_FUNCTIONS=['_malloc','_free']"
    "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','HEAPF32','HEAPU8','HEAPU32']"
    -O3
    -flto
    -Wl,--gc-sections
    -fno-rtti
    -fno-exceptions
)

# ESM variant of the standalone physics module — EXPORT_ES6=1 so the web editor
# (estella:// ESM host) can `import()` it like esengine.js. Playable/wechat keep
# the UMD variant (global ESPhysicsModule). Same standalone wasm, no dynamic link.
set(ES_EMSCRIPTEN_PHYSICS_ESM_MODULE_FLAGS ${ES_EMSCRIPTEN_PHYSICS_MODULE_FLAGS})
list(REMOVE_ITEM ES_EMSCRIPTEN_PHYSICS_ESM_MODULE_FLAGS -sEXPORT_ES6=0)
list(APPEND ES_EMSCRIPTEN_PHYSICS_ESM_MODULE_FLAGS -sEXPORT_ES6=1 -sENVIRONMENT=web)

if(NOT BOX2D_DISABLE_SIMD)
    list(APPEND ES_EMSCRIPTEN_PHYSICS_MODULE_FLAGS -msimd128)
    list(APPEND ES_EMSCRIPTEN_PHYSICS_ESM_MODULE_FLAGS -msimd128)
    list(APPEND ES_EMSCRIPTEN_PHYSICS_SIDE_MODULE_FLAGS -msimd128)
endif()

function(es_apply_physics_module_settings TARGET_NAME)
    if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
        set(_PHYSICS_COMPILE_FLAGS ${ES_EMSCRIPTEN_COMPILE_FLAGS} -flto -fno-rtti -fno-exceptions)
        if(NOT BOX2D_DISABLE_SIMD)
            list(APPEND _PHYSICS_COMPILE_FLAGS -msimd128)
        endif()
        target_compile_options(${TARGET_NAME} PRIVATE ${_PHYSICS_COMPILE_FLAGS})

        set(_PHYSICS_LINK_FLAGS ${ES_EMSCRIPTEN_PHYSICS_MODULE_FLAGS})
        if(ES_BUILD_WXGAME)
            list(APPEND _PHYSICS_LINK_FLAGS ${ES_EMSCRIPTEN_WXGAME_MODULE_EXTRA})
        endif()
        string(REPLACE ";" " " LINK_FLAGS_STR "${_PHYSICS_LINK_FLAGS}")
        set_target_properties(${TARGET_NAME} PROPERTIES
            SUFFIX ".js"
            LINK_FLAGS "${LINK_FLAGS_STR}"
        )
    endif()
endfunction()

# ESM variant settings (EXPORT_ES6=1) — see ES_EMSCRIPTEN_PHYSICS_ESM_MODULE_FLAGS.
function(es_apply_physics_esm_module_settings TARGET_NAME)
    if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
        set(_PHYSICS_COMPILE_FLAGS ${ES_EMSCRIPTEN_COMPILE_FLAGS} -flto -fno-rtti -fno-exceptions)
        if(NOT BOX2D_DISABLE_SIMD)
            list(APPEND _PHYSICS_COMPILE_FLAGS -msimd128)
        endif()
        target_compile_options(${TARGET_NAME} PRIVATE ${_PHYSICS_COMPILE_FLAGS})

        string(REPLACE ";" " " LINK_FLAGS_STR "${ES_EMSCRIPTEN_PHYSICS_ESM_MODULE_FLAGS}")
        set_target_properties(${TARGET_NAME} PROPERTIES
            SUFFIX ".js"
            LINK_FLAGS "${LINK_FLAGS_STR}"
        )
    endif()
endfunction()

message(STATUS "Emscripten configuration loaded")
if(ES_BUILD_MAIN_MODULE)
    message(STATUS "MAIN_MODULE build enabled: supports loading SIDE_MODULE")
endif()
