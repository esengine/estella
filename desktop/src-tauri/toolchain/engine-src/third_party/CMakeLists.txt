# =============================================================================
# nlohmann/json - JSON Library
# =============================================================================

add_library(nlohmann_json INTERFACE)
target_include_directories(nlohmann_json INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}/nlohmann)

# =============================================================================
# Spine Runtime - 2D Skeletal Animation
# =============================================================================

if(ES_ENABLE_SPINE)
    set(SPINE_SET_COMPILER_FLAGS OFF CACHE BOOL "" FORCE)
    file(GLOB_RECURSE SPINE_SOURCES
        "${CMAKE_CURRENT_SOURCE_DIR}/spine-runtimes-4.2/spine-cpp/spine-cpp/src/spine/*.cpp"
    )
    add_library(spine-cpp STATIC ${SPINE_SOURCES})
    target_include_directories(spine-cpp PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}/spine-runtimes-4.2/spine-cpp/spine-cpp/include
    )
    target_compile_definitions(spine-cpp PUBLIC SPINE_SHORT_NAMES SPINE_USE_STD_FUNCTION)
    if(NOT MSVC)
        target_compile_options(spine-cpp PRIVATE -Wno-unused-parameter -Wno-shadow)
    endif()
    if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
        target_compile_options(spine-cpp PRIVATE ${ES_EMSCRIPTEN_COMPILE_FLAGS})
    endif()
endif()

# =============================================================================
# Box2D - 2D Physics Engine
# =============================================================================

if(ES_ENABLE_BOX2D)
    add_subdirectory(box2d)
endif()

# =============================================================================
# GLM - OpenGL Mathematics Library
# =============================================================================

add_library(glm INTERFACE)
target_include_directories(glm INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}/glm)
target_compile_definitions(glm INTERFACE
    GLM_FORCE_RADIANS
    GLM_FORCE_DEPTH_ZERO_TO_ONE
    GLM_ENABLE_EXPERIMENTAL
)

# =============================================================================
# cute_tiled - Tiled JSON map parser
# =============================================================================

if(ES_ENABLE_TILEMAP)
    add_library(cute_tiled INTERFACE)
    target_include_directories(cute_tiled INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}/cute_tiled)
endif()

# =============================================================================
# Native Platform Dependencies
# =============================================================================

# =============================================================================
# Yoga - Flexbox Layout Engine (Meta)
# =============================================================================

file(GLOB_RECURSE YOGA_SOURCES
    "${CMAKE_CURRENT_SOURCE_DIR}/yoga/*.cpp"
)
add_library(yogacore STATIC ${YOGA_SOURCES})
target_include_directories(yogacore PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_compile_features(yogacore PUBLIC cxx_std_20)
if(NOT MSVC)
    target_compile_options(yogacore PRIVATE -Wno-unused-parameter)
endif()
if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
    target_compile_options(yogacore PRIVATE ${ES_EMSCRIPTEN_COMPILE_FLAGS})
endif()

# =============================================================================
# Native Platform Dependencies
# =============================================================================

if(NOT ES_BUILD_WEB AND NOT ES_BUILD_WXGAME)
    set(GLFW_BUILD_DOCS OFF CACHE BOOL "" FORCE)
    set(GLFW_BUILD_TESTS OFF CACHE BOOL "" FORCE)
    set(GLFW_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
    set(GLFW_INSTALL OFF CACHE BOOL "" FORCE)
    add_subdirectory(glfw)

    add_library(glad STATIC ${CMAKE_CURRENT_SOURCE_DIR}/glad/src/glad.c)
    target_include_directories(glad PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/glad/include)
endif()
