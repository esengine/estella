<div align="center">

# Estella

**A fast 2D game engine powered by WebAssembly and ECS**

[![CI](https://github.com/esengine/estella/actions/workflows/build.yml/badge.svg)](https://github.com/esengine/estella/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/esengine/estella)](https://github.com/esengine/estella/releases)
[![C++20](https://img.shields.io/badge/C%2B%2B-20-blue.svg)](https://isocpp.org/)
[![Platform](https://img.shields.io/badge/Platform-Web%20%7C%20WeChat-green.svg)]()
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/esengine/estella)

[Website](https://estellaengine.com) • [Getting Started](#getting-started) • [Documentation](#documentation) • [Discord](https://discord.gg/sAX6PXZ9) • [QQ群: 481923584](https://qm.qq.com/q/BONa5LXQ0U)

</div>

---

## What is Estella?

Estella is a **2D game engine** with a TypeScript SDK driven by a high-performance **C++/WebAssembly** backend. It ships with a visual editor for scene editing and project management, and outputs games that run in **web browsers** and **WeChat MiniGames**.

<div align="center">
  <img src="docs/assets/editor-screenshot.png" alt="Estella Editor" width="800" />
</div>

## Why Estella?

- **Fast** — C++ rendering pipeline compiled to WebAssembly, not interpreted JS
- **Type-safe** — First-class TypeScript SDK with `defineSystem`, `defineComponent`, and `Query`
- **Data-oriented** — Entity-Component-System architecture for scalable game logic
- **Visual editor** — Scene hierarchy, inspector, asset browser — no JSON editing
- **Cross-platform** — One codebase, deploy to web browsers and WeChat MiniGames
- **Spine & Physics** — Built-in Spine animation and physics support

## Features

| Feature | Description |
|---------|-------------|
| **Visual Editor** | Scene editor with hierarchy, inspector, and asset management |
| **ECS Architecture** | Compose entities from reusable components, drive behavior with systems |
| **WebGL Rendering** | Sprites, cameras, Spine animations, custom shaders — all in WebAssembly |
| **TypeScript SDK** | Type-safe API: `defineSystem`, `defineComponent`, `Query`, `Commands` |
| **Cross-Platform** | Single codebase targeting web browsers and WeChat MiniGames |

## Getting Started

### Install

Download the editor from the [releases page](https://github.com/esengine/estella/releases) and install it.

### Create a Project

1. Open the editor and click **New Project**
2. Enter a project name, select a location, and click **Create**

The editor creates a project with a default scene containing a Camera entity.

### Write Game Logic

Add entities and components in the scene editor, then write systems in TypeScript:

```typescript
import {
    defineComponent, defineSystem, addSystem,
    Query, Mut, Res, Time, LocalTransform
} from 'esengine';

const Speed = defineComponent('Speed', { value: 200 });

addSystem(defineSystem(
    [Res(Time), Query(Mut(LocalTransform), Speed)],
    (time, query) => {
        for (const [entity, transform, speed] of query) {
            transform.position.x += speed.value * time.delta;
        }
    }
));
```

Press **F5** in the editor to preview.

## Documentation

Full documentation: [estellaengine.com/docs](https://estellaengine.com/docs)

- [Introduction](https://estellaengine.com/docs/getting-started/introduction/)
- [Installation](https://estellaengine.com/docs/getting-started/installation/)
- [Quick Start](https://estellaengine.com/docs/getting-started/quick-start/)
- [ECS Architecture](https://estellaengine.com/docs/core-concepts/ecs/)
- [Components](https://estellaengine.com/docs/core-concepts/components/)
- [Systems](https://estellaengine.com/docs/core-concepts/systems/)

## Contributing

We welcome contributions! Please read the [Contributing Guide](CONTRIBUTING.md) before submitting a Pull Request.

## License

Estella is [MIT licensed](LICENSE).
