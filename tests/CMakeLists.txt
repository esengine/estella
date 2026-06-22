# ESEngine Tests

# doctest header-only framework
include_directories(${CMAKE_SOURCE_DIR}/third_party/doctest)

# ECS tests
add_executable(test_ecs
    ecs/test_registry.cpp
)
target_link_libraries(test_ecs PRIVATE esengine)
add_test(NAME test_ecs COMMAND test_ecs)

# Event system tests
add_executable(test_events
    events/test_events.cpp
)
target_link_libraries(test_events PRIVATE esengine)
add_test(NAME test_events COMMAND test_events)

# Particle system tests
add_executable(test_particle
    particle/test_particle.cpp
)
target_link_libraries(test_particle PRIVATE esengine)
add_test(NAME test_particle COMMAND test_particle)

# Tilemap system tests
add_executable(test_tilemap
    tilemap/test_tilemap.cpp
)
target_link_libraries(test_tilemap PRIVATE esengine)
add_test(NAME test_tilemap COMMAND test_tilemap)

# SparseSet tests
add_executable(test_sparse_set
    ecs/test_sparse_set.cpp
)
target_link_libraries(test_sparse_set PRIVATE esengine)
add_test(NAME test_sparse_set COMMAND test_sparse_set)

# ResourcePool tests
add_executable(test_resource_pool
    resource/test_resource_pool.cpp
)
target_link_libraries(test_resource_pool PRIVATE esengine)
add_test(NAME test_resource_pool COMMAND test_resource_pool)

# Shader-vs-device decoupling: compiles the converted Shader.cpp against a
# MockGfxDevice. Linking proves Shader contains no GL; asserts confirm it routes
# create/uniform/reflect/delete through GfxDevice.
add_executable(test_shader_device
    renderer/test_shader_device.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/renderer/Shader.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/core/Log.cpp
)
target_include_directories(test_shader_device PRIVATE
    ${CMAKE_SOURCE_DIR}/src
    ${CMAKE_SOURCE_DIR}/third_party/glm
)
add_test(NAME test_shader_device COMMAND test_shader_device)

# Texture + Framebuffer decoupling: compiles the converted classes against a
# MockGfxDevice. The harness stubs the (uncalled) stb file loader.
add_executable(test_texture_fb
    renderer/test_texture_fb.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/renderer/Texture.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/renderer/Framebuffer.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/core/Log.cpp
)
target_include_directories(test_texture_fb PRIVATE
    ${CMAKE_SOURCE_DIR}/src
    ${CMAKE_SOURCE_DIR}/third_party/stb
)
add_test(NAME test_texture_fb COMMAND test_texture_fb)

# Buffer + CustomGeometry decoupling: compiles the converted classes against a
# MockGfxDevice. Linking proves they contain no GL; asserts confirm create/
# upload/attribute-setup/bind/delete route through GfxDevice.
add_executable(test_buffer_device
    renderer/test_buffer_device.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/renderer/Buffer.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/renderer/CustomGeometry.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/core/Log.cpp
)
target_include_directories(test_buffer_device PRIVATE ${CMAKE_SOURCE_DIR}/src)
add_test(NAME test_buffer_device COMMAND test_buffer_device)

# GfxDevice compressed-texture entry (RC6-A). Header-only: drives MockGfxDevice to
# assert the compressed upload + capability-gated RGBA8 fallback. No GL, no emsdk.
add_executable(test_compressed_format
    renderer/test_compressed_format.cpp
)
target_include_directories(test_compressed_format PRIVATE ${CMAKE_SOURCE_DIR}/src)
add_test(NAME test_compressed_format COMMAND test_compressed_format)

# Log format-string precision parsing (Audit A1). Only needs Log.cpp.
# Should be compiled with exceptions OFF to mirror the engine's release config:
# proves malformed float specs like "{:.f}" no longer abort (the old std::stoi
# path threw -> abort under -fno-exceptions).
add_executable(test_log_format
    core/test_log_format.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/core/Log.cpp
)
target_include_directories(test_log_format PRIVATE ${CMAKE_SOURCE_DIR}/src)
target_compile_options(test_log_format PRIVATE -fno-exceptions)
add_test(NAME test_log_format COMMAND test_log_format)

# Registry/SparseSet release-safety (Audit A6 + A7). Header-only against
# Registry.hpp + Log.cpp (no esengine link). MUST stay free of -DES_DEBUG so
# ES_ASSERT is stripped, matching the release config where the OOB read
# (get on a non-member) and entity_count underflow (re-entrant destroy) appear.
add_executable(test_registry_safety
    ecs/test_registry_safety.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/core/Log.cpp
)
target_include_directories(test_registry_safety PRIVATE ${CMAKE_SOURCE_DIR}/src)
# Run under AddressSanitizer: the bugs this guards (emplace-on-invalid OOB write,
# over-range index alias) are memory-safety faults that only ASAN catches
# deterministically. Skipped on MSVC (different sanitizer flag syntax).
set(_es_safety_asan $<OR:$<CXX_COMPILER_ID:GNU>,$<CXX_COMPILER_ID:Clang>,$<CXX_COMPILER_ID:AppleClang>>)
target_compile_options(test_registry_safety PRIVATE $<${_es_safety_asan}:-fsanitize=address>)
target_link_options(test_registry_safety PRIVATE $<${_es_safety_asan}:-fsanitize=address>)
add_test(NAME test_registry_safety COMMAND test_registry_safety)
