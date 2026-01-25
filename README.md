<div align="center">

# ESEngine

**A lightweight C++17 game engine for WebAssembly and WeChat MiniGames**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![C++17](https://img.shields.io/badge/C%2B%2B-17-blue.svg)](https://isocpp.org/)
[![Platform](https://img.shields.io/badge/Platform-Web%20%7C%20WeChat-green.svg)]()

[Getting Started](#getting-started) • [Documentation](#documentation) • [Examples](examples/) • [Contributing](#contributing)

</div>

---

## Overview

ESEngine is a minimal, high-performance game engine designed for WebAssembly deployment. It provides an EnTT-style ECS architecture, WebGL rendering, and first-class support for WeChat MiniGames.

## Features

| Feature | Description |
|---------|-------------|
| **ECS Architecture** | Data-oriented Entity-Component-System for cache-friendly game logic |
| **WebGL Renderer** | OpenGL ES 2.0/3.0 compatible graphics pipeline |
| **Cross-Platform** | Single codebase for Web browsers and WeChat MiniGames |
| **Lightweight** | Minimal dependencies, optimized for small binary size |

## Getting Started

### Prerequisites

- CMake 3.16+
- C++17 compiler
- [Emscripten SDK](https://emscripten.org/) (for web builds)

### Build

```bash
# Native build
cmake -B build && cmake --build build

# Web build
emcmake cmake -B build_web -DES_BUILD_WEB=ON && cmake --build build_web

# WeChat MiniGame
emcmake cmake -B build_wxgame -DES_BUILD_WXGAME=ON && cmake --build build_wxgame
```

### Quick Example

```cpp
#include <esengine/ESEngine.hpp>

class MyGame : public esengine::Application {
protected:
    void onInit() override { /* Initialize */ }
    void onUpdate(float dt) override { /* Update logic */ }
    void onRender() override { /* Render frame */ }
};

int main() {
    MyGame game;
    return game.run();
}
```

## Documentation

Full documentation is available at the [ESEngine Docs](https://esengine.github.io/microes/).

**Guides:**
- [Introduction](https://esengine.github.io/microes/getting-started/introduction/)
- [Installation](https://esengine.github.io/microes/getting-started/installation/)
- [Quick Start](https://esengine.github.io/microes/getting-started/quick-start/)
- [ECS Architecture](https://esengine.github.io/microes/guides/ecs/)

**API Reference:**
- [Doxygen API Docs](https://esengine.github.io/microes/api/html/)

Build docs locally:
```bash
cd docs && ./build.sh dev   # Linux/macOS
cd docs && .\build.ps1 dev  # Windows
```

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting pull requests.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
