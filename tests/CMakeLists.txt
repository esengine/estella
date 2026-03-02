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
