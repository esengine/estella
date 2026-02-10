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
    # Compile flags only
)

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

# Main module link flags (for dynamic linking)
set(ES_EMSCRIPTEN_MAIN_MODULE_FLAGS
    -sMAIN_MODULE=2                 # Main module with minimal stdlib exports
    -sWASM=1
    -sUSE_WEBGL2=1
    -sFULL_ES3=1
    -sALLOW_MEMORY_GROWTH=1
    -sNO_EXIT_RUNTIME=1
    -sASSERTIONS=1
    -sEXPORT_ES6=1
    -sMODULARIZE=1
    "-sEXPORT_NAME='ESEngineCore'"
    "-sEXPORTED_FUNCTIONS=['_malloc','_free','_es_app_init','_dlopen','_dlsym','_dlclose']"
    "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','HEAPF32','HEAPU8','HEAPU32','loadDynamicLibrary']"
    # Embed minimal assets for core
    "--embed-file=${CMAKE_SOURCE_DIR}/assets/shaders@/assets/shaders"
)

# Side module compile flags (position independent code)
set(ES_EMSCRIPTEN_SIDE_MODULE_COMPILE_FLAGS
    -fPIC
    -sRELOCATABLE=1
)

# Side module link flags
set(ES_EMSCRIPTEN_SIDE_MODULE_FLAGS
    -sSIDE_MODULE=2                 # Side module (dynamic library)
    -sWASM=1
    -sRELOCATABLE=1
)

# Debug-specific flags
if(CMAKE_BUILD_TYPE STREQUAL "Debug")
    list(APPEND ES_EMSCRIPTEN_COMPILE_FLAGS
        -g
        -sASSERTIONS=2
        -sSAFE_HEAP=1
        -sSTACK_OVERFLOW_CHECK=2
    )
endif()

# Release-specific flags
if(CMAKE_BUILD_TYPE STREQUAL "Release")
    list(APPEND ES_EMSCRIPTEN_COMPILE_FLAGS
        -O3
        -sASSERTIONS=0
    )
    list(APPEND ES_EMSCRIPTEN_LINK_FLAGS
        -O3
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
    -sENVIRONMENT=web,node
    -sEXPORT_ES6=0
    -sMODULARIZE=1
    -sFORCE_FILESYSTEM=1
    -sDYNAMIC_EXECUTION=0
    "-sEXPORT_NAME='ESEngineModule'"
    "-sEXPORTED_FUNCTIONS=['_malloc','_free']"
    "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','HEAPF32','HEAPU8','HEAPU32','GL','FS']"
    -O3
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

# Helper function to apply MAIN_MODULE settings (modular build)
function(es_apply_main_module_settings TARGET_NAME)
    if(ES_BUILD_WEB AND ES_BUILD_MODULAR)
        target_compile_options(${TARGET_NAME} PRIVATE ${ES_EMSCRIPTEN_COMPILE_FLAGS})

        string(REPLACE ";" " " LINK_FLAGS_STR "${ES_EMSCRIPTEN_MAIN_MODULE_FLAGS}")
        set_target_properties(${TARGET_NAME} PROPERTIES
            SUFFIX ".js"
            LINK_FLAGS "${LINK_FLAGS_STR}"
        )
        message(STATUS "Configured ${TARGET_NAME} as MAIN_MODULE")
    endif()
endfunction()

# Helper function to apply SIDE_MODULE settings (modular build)
function(es_apply_side_module_settings TARGET_NAME)
    if(ES_BUILD_WEB AND ES_BUILD_MODULAR)
        target_compile_options(${TARGET_NAME} PRIVATE
            ${ES_EMSCRIPTEN_COMPILE_FLAGS}
            ${ES_EMSCRIPTEN_SIDE_MODULE_COMPILE_FLAGS}
        )

        string(REPLACE ";" " " LINK_FLAGS_STR "${ES_EMSCRIPTEN_SIDE_MODULE_FLAGS}")
        set_target_properties(${TARGET_NAME} PROPERTIES
            PREFIX ""
            SUFFIX ".wasm"
            LINK_FLAGS "${LINK_FLAGS_STR}"
        )
        message(STATUS "Configured ${TARGET_NAME} as SIDE_MODULE")
    endif()
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
    "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','HEAPF32','HEAPU8','HEAPU32','FS','addFunction']"
    -O3
    -flto
    --closure=1
)

# Single-file SDK link flags (WASM inlined as Base64, for playable ads)
# Uses IIFE pattern instead of ES6 modules for maximum compatibility
set(ES_EMSCRIPTEN_SINGLE_FILE_FLAGS
    --bind
    -sWASM=1
    -sSINGLE_FILE=1
    -sUSE_WEBGL2=1
    -sFULL_ES3=1
    -sALLOW_MEMORY_GROWTH=1
    -sNO_EXIT_RUNTIME=1
    -sENVIRONMENT=web
    -sMODULARIZE=1
    "-sEXPORT_NAME='ESEngineModule'"
    -sFORCE_FILESYSTEM=1
    "-sEXPORTED_FUNCTIONS=['_malloc','_free']"
    "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','HEAPF32','HEAPU8','HEAPU32','FS']"
    -Oz
    -flto
)

function(es_apply_sdk_settings TARGET_NAME)
    if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
        target_compile_options(${TARGET_NAME} PRIVATE ${ES_EMSCRIPTEN_COMPILE_FLAGS} -flto)

        string(REPLACE ";" " " LINK_FLAGS_STR "${ES_EMSCRIPTEN_SDK_LINK_FLAGS}")
        set_target_properties(${TARGET_NAME} PROPERTIES
            SUFFIX ".js"
            LINK_FLAGS "${LINK_FLAGS_STR}"
        )
    endif()
endfunction()

function(es_apply_single_file_settings TARGET_NAME)
    if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
        target_compile_options(${TARGET_NAME} PRIVATE ${ES_EMSCRIPTEN_COMPILE_FLAGS} -flto)

        string(REPLACE ";" " " LINK_FLAGS_STR "${ES_EMSCRIPTEN_SINGLE_FILE_FLAGS}")
        set_target_properties(${TARGET_NAME} PROPERTIES
            SUFFIX ".js"
            LINK_FLAGS "${LINK_FLAGS_STR}"
        )
    endif()
endfunction()

function(es_apply_wxgame_sdk_settings TARGET_NAME)
    if(ES_BUILD_WXGAME)
        target_compile_options(${TARGET_NAME} PRIVATE ${ES_EMSCRIPTEN_COMPILE_FLAGS})

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
    --bind
    -sWASM=1
    -sALLOW_MEMORY_GROWTH=1
    -sNO_EXIT_RUNTIME=1
    -sEXPORT_ES6=1
    -sMODULARIZE=1
    -sFORCE_FILESYSTEM=1
    "-sEXPORT_NAME='ESSpineModule'"
    "-sEXPORTED_FUNCTIONS=['_malloc','_free']"
    "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','HEAPF32','HEAPU8','HEAPU32','FS']"
    -O3
    -flto
)

function(es_apply_spine_module_settings TARGET_NAME)
    if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
        target_compile_options(${TARGET_NAME} PRIVATE ${ES_EMSCRIPTEN_COMPILE_FLAGS} -flto)

        string(REPLACE ";" " " LINK_FLAGS_STR "${ES_EMSCRIPTEN_SPINE_MODULE_FLAGS}")
        set_target_properties(${TARGET_NAME} PROPERTIES
            SUFFIX ".js"
            LINK_FLAGS "${LINK_FLAGS_STR}"
        )
    endif()
endfunction()

message(STATUS "Emscripten configuration loaded")
if(ES_BUILD_MODULAR)
    message(STATUS "Modular build enabled: MAIN_MODULE + SIDE_MODULE architecture")
endif()
