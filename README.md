<div align="center">

# ESEngine

**A lightweight C++20 game engine for WebAssembly and WeChat MiniGames**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![C++20](https://img.shields.io/badge/C%2B%2B-20-blue.svg)](https://isocpp.org/)
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
| **TypeScript SDK** | Full TypeScript SDK with WASM bridge for web development |
| **Cross-Platform** | Single codebase for Web browsers and WeChat MiniGames |
| **Lightweight** | Minimal dependencies, optimized for small binary size |

## Getting Started

### Prerequisites

- CMake 3.16+
- C++20 compiler
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

### Quick Start

The TypeScript SDK provides an ECS-style API for building games with ESEngine.

```bash
cd sdk && npm install && npm run build
```

```typescript
import {
    App, createWebApp, defineSystem, Schedule,
    Commands, Query, Res, Time,
    LocalTransform, Sprite, Camera,
    type ESEngineModule
} from 'esengine';

export async function main(Module: ESEngineModule): Promise<void> {
    const app = createWebApp(Module);

    // Startup system - runs once
    app.addSystemToSchedule(Schedule.Startup, defineSystem(
        [Commands()],
        (cmds) => {
            // Create camera
            cmds.spawn()
                .insert(Camera, { projectionType: 1, orthoSize: 400, isActive: true })
                .insert(LocalTransform, { position: { x: 0, y: 0, z: 10 } });

            // Create sprite
            cmds.spawn()
                .insert(Sprite, { color: { x: 1, y: 0.5, z: 0.2, w: 1 }, size: { x: 100, y: 100 } })
                .insert(LocalTransform, { position: { x: 0, y: 0, z: 0 } });
        }
    ));

    // Update system - runs every frame
    app.addSystemToSchedule(Schedule.Update, defineSystem(
        [Res(Time), Query(LocalTransform, Sprite)],
        (time, query) => {
            for (const [entity, transform, sprite] of query) {
                transform.position.x = Math.sin(time.elapsed) * 100;
                transform.position.y = Math.cos(time.elapsed) * 100;
            }
        }
    ));

    app.run();
}
```

See [sdk/examples/playground](sdk/examples/playground/) for a complete example.

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
