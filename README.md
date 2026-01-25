# ESEngine

A lightweight game engine for WebAssembly and WeChat MiniGames, built with C++17 and Emscripten.

## Features

- **ECS Architecture**: EnTT-style Entity-Component-System for efficient game object management
- **WebGL Rendering**: OpenGL ES 2.0/3.0 compatible renderer
- **Cross-Platform**: Targets Web browsers and WeChat MiniGames
- **Lightweight**: Minimal dependencies, small binary size

## Requirements

- CMake 3.16+
- C++17 compatible compiler
- Emscripten SDK (for web builds)
- GLM (included in third_party)

## Project Structure

```
esengine/
├── src/esengine/     # Engine source code
│   ├── core/         # Core systems (Application, Engine, Log)
│   ├── ecs/          # Entity-Component-System
│   ├── math/         # Math utilities (GLM wrapper)
│   ├── renderer/     # WebGL rendering
│   └── platform/     # Platform abstraction
├── include/          # Public headers
├── third_party/      # Dependencies (GLM)
├── examples/         # Example projects
├── tests/            # Unit tests
└── bindings/         # JS bindings and platform adapters
```

## Building

### Native (Debug)

```bash
cmake -B build -DCMAKE_BUILD_TYPE=Debug
cmake --build build
```

### Web (Emscripten)

```bash
source /path/to/emsdk/emsdk_env.sh
emcmake cmake -B build_web -DES_BUILD_WEB=ON
cmake --build build_web
```

### WeChat MiniGame

```bash
source /path/to/emsdk/emsdk_env.sh
emcmake cmake -B build_wxgame -DES_BUILD_WXGAME=ON
cmake --build build_wxgame
```

## Usage

### Basic Application

```cpp
#include <esengine/ESEngine.hpp>

class MyGame : public esengine::Application {
protected:
    void onInit() override {
        // Initialize game
    }

    void onUpdate(float deltaTime) override {
        // Update game logic
    }

    void onRender() override {
        // Render game
    }
};

int main() {
    MyGame game;
    game.run();
    return 0;
}
```

### ECS Usage

```cpp
using namespace esengine;
using namespace esengine::ecs;

// Create entities
Registry registry;
Entity player = registry.create();

// Add components
registry.emplace<Transform>(player, glm::vec3(0, 0, 0));
registry.emplace<Velocity>(player, glm::vec3(1, 0, 0));
registry.emplace<Sprite>(player);

// Query and update
auto view = registry.view<Transform, Velocity>();
for (auto entity : view) {
    auto& transform = view.get<Transform>(entity);
    auto& velocity = view.get<Velocity>(entity);
    transform.position += velocity.linear * deltaTime;
}
```

## Running Tests

```bash
cmake -B build -DES_BUILD_TESTS=ON
cmake --build build
ctest --test-dir build
```

## License

MIT License - See LICENSE file for details.

## Contributing

Contributions are welcome! Please read CONTRIBUTING.md for guidelines.
