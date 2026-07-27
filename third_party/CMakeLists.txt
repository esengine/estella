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
# DragonBones - 2D Skeletal Animation (MIT)
# =============================================================================
# Vendored as plain sources rather than a submodule: upstream's .gitmodules pulls
# cocos2d-x 2.x AND 3.x, which every `submodules: recursive` checkout would then
# clone for a core that includes nothing from either. The format is frozen (the
# authoring tool is no longer developed), so there is no upstream to track.
#
# rapidjson is its parser's dependency, NOT the engine's — the main module uses
# nlohmann. They never meet: this links only into the DragonBones side module.

if(ES_ENABLE_DRAGONBONES)
    add_library(rapidjson INTERFACE)
    target_include_directories(rapidjson INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}/rapidjson)

    file(GLOB_RECURSE DRAGONBONES_SOURCES
        "${CMAKE_CURRENT_SOURCE_DIR}/dragonbones/src/dragonBones/*.cpp"
    )
    add_library(dragonbones STATIC ${DRAGONBONES_SOURCES})
    target_include_directories(dragonbones PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/dragonbones/src)
    target_link_libraries(dragonbones PUBLIC rapidjson)
    if(NOT MSVC)
        # Upstream's own warnings, in code we do not edit so they can never be fixed.
        target_compile_options(dragonbones PRIVATE -Wno-unused-parameter -Wno-shadow -Wno-switch -Wno-nonnull)
    endif()
    if(ES_BUILD_WEB OR ES_BUILD_WXGAME)
        target_compile_options(dragonbones PRIVATE ${ES_EMSCRIPTEN_COMPILE_FLAGS})
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
