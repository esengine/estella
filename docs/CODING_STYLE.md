# ESEngine Coding Style Guide

This document describes the coding conventions used in the ESEngine project.

## Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Namespace | lowercase | `esengine::ecs` |
| Class/Struct | PascalCase | `Registry`, `SparseSet` |
| Function/Method | camelCase | `createEntity()`, `getComponent()` |
| Member Variable | snake_case + underscore suffix | `entity_count_`, `sparse_` |
| Local Variable | camelCase | `entityId`, `deltaTime` |
| Constant | SCREAMING_SNAKE_CASE | `MAX_ENTITIES`, `INVALID_ENTITY` |
| Enum | PascalCase | `enum class LogLevel` |
| Enum Value | PascalCase | `LogLevel::Debug` |
| Template Parameter | Single uppercase or PascalCase | `T`, `Component` |
| Macro | SCREAMING_SNAKE_CASE | `ES_LOG_INFO`, `ES_ASSERT` |

## File Conventions

- Header files: `.hpp` extension
- Source files: `.cpp` extension
- One class per file (exceptions for tightly coupled helpers)
- Header guards: Use `#pragma once`
- File names match class names in PascalCase

## Code Style

### Indentation and Formatting

```cpp
// 4 spaces, no tabs
void example() {
    if (condition) {
        doSomething();
    }
}

// Braces on same line (K&R style)
class MyClass {
public:
    void method() {
        // ...
    }
};

// Single-line statements still use braces
if (x > 0) {
    return true;
}
```

### Includes

```cpp
// Order: related header, system headers, library headers, project headers
#include "MyClass.hpp"        // Related header first

#include <cstdint>            // C++ standard library
#include <vector>
#include <string>

#include <glm/glm.hpp>        // Third-party libraries

#include "core/Types.hpp"     // Project headers
#include "ecs/Registry.hpp"
```

### Class Layout

```cpp
class MyClass {
public:
    // Types and aliases
    using ValueType = int;

    // Static constants
    static constexpr int MAX_VALUE = 100;

    // Constructors and destructor
    MyClass();
    ~MyClass();

    // Copy/move operations
    MyClass(const MyClass&) = delete;
    MyClass& operator=(const MyClass&) = delete;

    // Public methods
    void doSomething();

protected:
    // Protected methods
    void helperMethod();

private:
    // Private methods
    void internalMethod();

    // Member variables (underscore suffix)
    int value_;
    std::string name_;
};
```

### Modern C++ Features

```cpp
// Use nullptr, not NULL or 0
Entity* entity = nullptr;

// Use auto when type is obvious
auto entity = registry.create();
auto& transform = registry.get<Transform>(entity);

// Use constexpr for compile-time constants
constexpr int MAX_ENTITIES = 10000;

// Use range-based for loops
for (const auto& entity : entities) {
    process(entity);
}

// Use initializer lists
std::vector<int> values = {1, 2, 3, 4, 5};

// Use smart pointers
std::unique_ptr<Shader> shader = std::make_unique<Shader>();
```

### Comments

```cpp
// Single-line comments for brief explanations
int count = 0;  // Track entity count

/*
 * Multi-line comments for longer explanations.
 * Use these sparingly - code should be self-documenting.
 */

/// Doxygen-style comments for public API documentation
/// @param entity The entity to query
/// @return True if entity has the component
template<typename T>
bool has(Entity entity) const;
```

### Error Handling

```cpp
// Use assertions for programmer errors (debug only)
ES_ASSERT(entity != INVALID_ENTITY, "Invalid entity");

// Use logging for runtime information
ES_LOG_INFO("Created entity {}", entity);
ES_LOG_ERROR("Failed to load shader: {}", path);

// Return values or optional for expected failures
std::optional<Entity> findEntity(const std::string& name);
```

## Best Practices

1. **Keep functions short**: Aim for functions that fit on one screen
2. **Single responsibility**: Each class/function should do one thing
3. **Const correctness**: Mark const wherever possible
4. **RAII**: Use constructors/destructors for resource management
5. **Avoid raw pointers**: Use smart pointers or references
6. **Prefer composition over inheritance**
7. **Write self-documenting code**: Good names > comments
8. **Handle edge cases**: Check for null, empty, invalid states

## Platform-Specific Code

```cpp
// Use preprocessor for platform-specific code
#ifdef ES_PLATFORM_WEB
    // WebGL-specific code
#else
    // Native platform code
#endif

// Minimize platform-specific code in headers
// Use PIMPL or abstract interfaces when possible
```

## Template Guidelines

```cpp
// Keep templates in headers
template<typename T>
class SparseSet {
    // Implementation in header
};

// Use concepts (C++20) or SFINAE for constraints
template<typename T>
    requires std::is_trivially_copyable_v<T>
class FastStorage { };
```
