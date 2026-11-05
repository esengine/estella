# SPDX-License-Identifier: Apache-2.0
# The vendored PhysX 5 CPU SDK as one static library, `physx`.
#
# One definition for every build that links it: the web side module
# (third_party/CMakeLists.txt) and the native hosts (native/CMakeLists.txt). The
# vendored tree carries no CMake of its own we could reuse — NVIDIA's generator
# is a Python front-end over per-platform presets — so the sources are globbed,
# minus the parts no Estella build consumes.
#
# The caller adds what is platform-specific on top (the web's SIMD flags).

function(es_add_physx_library PX_ROOT)
    if(TARGET physx)
        return()
    endif()
    file(GLOB_RECURSE PHYSX_SOURCES "${PX_ROOT}/source/*.cpp")
    # Remote debugging (PVD) is off in a release build, and the vehicle SDK has
    # no consumer here yet.
    list(FILTER PHYSX_SOURCES EXCLUDE REGEX "/source/(pvd|physxvehicle|immediatemode)/")
    if(WIN32)
        list(FILTER PHYSX_SOURCES EXCLUDE REGEX "/unix/")
    else()
        list(FILTER PHYSX_SOURCES EXCLUDE REGEX "/windows/")
    endif()
    add_library(physx STATIC ${PHYSX_SOURCES})
    file(GLOB_RECURSE _PX_HEADERS LIST_DIRECTORIES false "${PX_ROOT}/source/*.h")
    set(_PX_PRIVATE_DIRS "")
    # Every directory holding a header, and the ones above it: files include
    # both "Foo.h" and "omnipvd/Foo.h".
    foreach(_h ${_PX_HEADERS})
        get_filename_component(_d "${_h}" DIRECTORY)
        while(NOT _d STREQUAL "${PX_ROOT}/source" AND NOT _d STREQUAL "${PX_ROOT}")
            list(APPEND _PX_PRIVATE_DIRS "${_d}")
            get_filename_component(_d "${_d}" DIRECTORY)
        endwhile()
    endforeach()
    list(REMOVE_DUPLICATES _PX_PRIVATE_DIRS)
    target_include_directories(physx PUBLIC ${PX_ROOT}/include PRIVATE ${_PX_PRIVATE_DIRS})
    target_compile_features(physx PUBLIC cxx_std_17)
    target_compile_definitions(physx PUBLIC
        PX_PHYSX_STATIC_LIB NDEBUG PX_SUPPORT_PVD=0 PX_SUPPORT_OMNI_PVD=0
        DISABLE_CUDA_PHYSX PX_PUBLIC_RELEASE=1)
    if(MSVC)
        # The SDK is warning-clean on NVIDIA's own flags, not ours; it is vendored
        # and not ours to fix.
        target_compile_options(physx PRIVATE /w)
    else()
        target_compile_options(physx PRIVATE -w -fno-strict-aliasing)
    endif()
endfunction()
