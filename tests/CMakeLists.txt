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

# Renderer GPU state-cache tests.
# Compiles StateTracker.cpp directly against a MockGfxDevice — no GL/engine link,
# so it runs on any C++20 toolchain (CI doesn't need emsdk for this).
add_executable(test_state_tracker
    renderer/test_state_tracker.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/renderer/StateTracker.cpp
)
target_include_directories(test_state_tracker PRIVATE ${CMAKE_SOURCE_DIR}/src)
add_test(NAME test_state_tracker COMMAND test_state_tracker)

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
