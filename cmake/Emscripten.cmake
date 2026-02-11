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
    "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','HEAPF32','HEAPU8','HEAPU32','FS','addFunction','loadDynamicLibrary']"
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
    -sENVIRONMENT=web,node
    -sEXPORT_ES6=0
    -sMODULARIZE=1
    -sFORCE_FILESYSTEM=1
    -sDYNAMIC_EXECUTION=0
    "-sEXPORT_NAME='ESEngineModule'"
    "-sEXPORTED_FUNCTIONS=['_malloc','_free']"
    "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','HEAPF32','HEAPU8','HEAPU32','GL','FS','loadDynamicLibrary']"
    -O3
    -Wl,--gc-sections
    --closure=0
)

# Physics side module flags (SIDE_MODULE=2, pure .wasm, no JS glue)
set(ES_EMSCRIPTEN_PHYSICS_SIDE_MODULE_FLAGS
    -sSIDE_MODULE=2
    -sWASM=1
    -sRELOCATABLE=1
    -O3
    -flto
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
    -Wl,--gc-sections
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
    target_compile_options(${TARGET_NAME} PRIVATE -fPIC -sRELOCATABLE=1 -flto)

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
    "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','HEAPF32','HEAPU8','HEAPU32','FS','addFunction']"
    -O3
    -flto
    -Wl,--gc-sections
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
    -Wl,--gc-sections
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

function(es_apply_single_file_settings TARGET_NAME)
    if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
        target_compile_options(${TARGET_NAME} PRIVATE ${ES_EMSCRIPTEN_COMPILE_FLAGS} -flto -fno-exceptions)

        string(REPLACE ";" " " LINK_FLAGS_STR "${ES_EMSCRIPTEN_SINGLE_FILE_FLAGS}")
        set_target_properties(${TARGET_NAME} PROPERTIES
            SUFFIX ".js"
            LINK_FLAGS "${LINK_FLAGS_STR}"
        )
    endif()
endfunction()

function(es_apply_wxgame_sdk_settings TARGET_NAME)
    if(ES_BUILD_WXGAME)
        target_compile_options(${TARGET_NAME} PRIVATE ${ES_EMSCRIPTEN_COMPILE_FLAGS} -fno-exceptions)

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
    -fno-exceptions
    -fno-rtti
)

function(es_apply_spine_module_settings TARGET_NAME)
    if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
        target_compile_options(${TARGET_NAME} PRIVATE ${ES_EMSCRIPTEN_COMPILE_FLAGS} -flto -fno-exceptions -fno-rtti)

        string(REPLACE ";" " " LINK_FLAGS_STR "${ES_EMSCRIPTEN_SPINE_MODULE_FLAGS}")
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

function(es_apply_physics_module_settings TARGET_NAME)
    if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
        target_compile_options(${TARGET_NAME} PRIVATE ${ES_EMSCRIPTEN_COMPILE_FLAGS} -flto -fno-rtti -fno-exceptions)

        string(REPLACE ";" " " LINK_FLAGS_STR "${ES_EMSCRIPTEN_PHYSICS_MODULE_FLAGS}")
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
