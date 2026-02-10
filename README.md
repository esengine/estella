<div align="center">

# ESEngine

**A lightweight 2D game engine for web and WeChat MiniGames**

[![C++20](https://img.shields.io/badge/C%2B%2B-20-blue.svg)](https://isocpp.org/)
[![Platform](https://img.shields.io/badge/Platform-Web%20%7C%20WeChat-green.svg)]()

[Getting Started](#getting-started) • [Documentation](#documentation)

</div>

---

## Overview

ESEngine is a lightweight 2D game engine with a **TypeScript SDK** powered by a **C++/WebAssembly** backend. It comes with a visual editor for scene editing and project management, and outputs games that run in web browsers and WeChat MiniGames.

## Features

| Feature | Description |
|---------|-------------|
| **Visual Editor** | Scene editor with hierarchy, inspector, and asset management |
| **ECS Architecture** | Data-oriented Entity-Component-System — compose entities from reusable components, drive behavior with systems |
| **WebGL Rendering** | C++ rendering pipeline compiled to WebAssembly — sprites, cameras, Spine animations, custom shaders |
| **TypeScript SDK** | Type-safe API with `defineSystem`, `defineComponent`, and `Query` |
| **Cross-Platform** | Single codebase targeting web browsers and WeChat MiniGames |

## Getting Started

### Install

Download the editor from the [releases page](https://github.com/esengine/microes/releases) and install it.

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

Full documentation: [esengine.github.io/microes](https://esengine.github.io/microes/)

- [Introduction](https://esengine.github.io/microes/getting-started/introduction/)
- [Installation](https://esengine.github.io/microes/getting-started/installation/)
- [Quick Start](https://esengine.github.io/microes/getting-started/quick-start/)
- [ECS Architecture](https://esengine.github.io/microes/core-concepts/ecs/)
- [Components](https://esengine.github.io/microes/core-concepts/components/)
- [Systems](https://esengine.github.io/microes/core-concepts/systems/)
