# ESEngine Tests

# Simple test framework (minimal, no external dependencies)
add_executable(test_ecs
    ecs/test_registry.cpp
)
target_link_libraries(test_ecs PRIVATE esengine)

# Add test
add_test(NAME test_ecs COMMAND test_ecs)
