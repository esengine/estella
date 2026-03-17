# Compiler Cache Support (ccache/sccache)
# Speeds up incremental C++ builds by caching compilation results

option(ES_ENABLE_CCACHE "Enable compiler cache (ccache/sccache) for faster rebuilds" ON)

if(ES_ENABLE_CCACHE)
    # Try ccache first (more common, lighter weight)
    find_program(CCACHE_PROGRAM ccache)

    # Fall back to sccache if ccache not found
    if(NOT CCACHE_PROGRAM)
        find_program(SCCACHE_PROGRAM sccache)
    endif()

    if(CCACHE_PROGRAM)
        message(STATUS "ccache found: ${CCACHE_PROGRAM}")
        set(CMAKE_C_COMPILER_LAUNCHER ${CCACHE_PROGRAM})
        set(CMAKE_CXX_COMPILER_LAUNCHER ${CCACHE_PROGRAM})

        # Emscripten-specific configuration
        if(EMSCRIPTEN)
            # Use content-based hash instead of mtime for Emscripten
            set(ENV{CCACHE_COMPILERCHECK} "content")
            # Don't hash the current directory path (avoids cache misses on different build dirs)
            set(ENV{CCACHE_NOHASHDIR} "true")
            # Emscripten outputs can be large, increase cache size
            set(ENV{CCACHE_MAXSIZE} "2G")
            message(STATUS "ccache: Emscripten mode enabled (content-based hashing)")
        endif()

    elseif(SCCACHE_PROGRAM)
        message(STATUS "sccache found: ${SCCACHE_PROGRAM}")
        set(CMAKE_C_COMPILER_LAUNCHER ${SCCACHE_PROGRAM})
        set(CMAKE_CXX_COMPILER_LAUNCHER ${SCCACHE_PROGRAM})

    else()
        message(STATUS "Compiler cache not found (install ccache or sccache for faster builds)")
    endif()
else()
    message(STATUS "Compiler cache disabled (ES_ENABLE_CCACHE=OFF)")
endif()
