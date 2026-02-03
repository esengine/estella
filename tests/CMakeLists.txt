# ESEngine Tests

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
