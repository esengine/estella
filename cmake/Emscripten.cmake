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
    "-s USE_WEBGL2=1"
    "-s FULL_ES3=1"
)

set(ES_EMSCRIPTEN_LINK_FLAGS
    "-s WASM=1"
    "-s ALLOW_MEMORY_GROWTH=1"
    "-s NO_EXIT_RUNTIME=1"
    "-s ASSERTIONS=1"
)

# Debug-specific flags
if(CMAKE_BUILD_TYPE STREQUAL "Debug")
    list(APPEND ES_EMSCRIPTEN_COMPILE_FLAGS
        "-g"
        "-s ASSERTIONS=2"
        "-s SAFE_HEAP=1"
        "-s STACK_OVERFLOW_CHECK=2"
    )
endif()

# Release-specific flags
if(CMAKE_BUILD_TYPE STREQUAL "Release")
    list(APPEND ES_EMSCRIPTEN_COMPILE_FLAGS
        "-O3"
        "-s ASSERTIONS=0"
    )
    list(APPEND ES_EMSCRIPTEN_LINK_FLAGS
        "-O3"
        "--closure 1"
    )
endif()

# WeChat MiniGame specific settings
if(ES_BUILD_WXGAME)
    list(APPEND ES_EMSCRIPTEN_LINK_FLAGS
        "-s ENVIRONMENT=web"
        "-s MODULARIZE=1"
        "-s EXPORT_NAME='ESEngineModule'"
    )
endif()

# Helper function to apply Emscripten settings to a target
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

message(STATUS "Emscripten configuration loaded")
