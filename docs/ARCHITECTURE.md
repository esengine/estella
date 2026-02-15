# ESEngine Architecture

This document describes the architecture and design decisions of the ESEngine game engine.

## Overview

ESEngine is designed as a lightweight, modular game engine targeting WebAssembly and WeChat MiniGames. The architecture prioritizes:

1. **Performance**: Cache-friendly data structures, minimal allocations
2. **Simplicity**: Clean APIs, minimal dependencies
3. **Portability**: Abstract platform differences behind interfaces

## Core Modules

### Core (`src/esengine/core/`)

The foundation of the engine.

- **Types.hpp**: Basic type definitions (u32, f32, Entity, etc.)
- **Log.hpp/cpp**: Logging system with levels (Trace, Debug, Info, Warn, Error, Fatal)
- **Engine.hpp/cpp**: Engine singleton, version info, platform queries
- **Application.hpp/cpp**: Base application class with lifecycle hooks

### ECS (`src/esengine/ecs/`)

Entity-Component-System architecture inspired by EnTT.

```
┌─────────────────────────────────────────────────────────────┐
│                        Registry                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │   Entity Management                                   │    │
│  │   - create() / destroy()                             │    │
│  │   - valid() / entityCount()                          │    │
│  └─────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │   Component Pools (SparseSet<T>)                     │    │
│  │   ┌───────────┐ ┌───────────┐ ┌───────────┐         │    │
│  │   │ Transform │ │  Sprite   │ │ Velocity  │ ...     │    │
│  │   └───────────┘ └───────────┘ └───────────┘         │    │
│  └─────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │   Views (Query System)                               │    │
│  │   - view<Transform, Sprite>() → View<T...>          │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

#### SparseSet

The core data structure for component storage, providing O(1) operations:

```cpp
template<typename T>
class SparseSet {
    std::vector<Entity> sparse_;    // Entity → Dense index
    std::vector<Entity> dense_;     // Dense index → Entity
    std::vector<T> components_;     // Component data (cache-friendly)
};
```

Benefits:
- O(1) add, remove, lookup
- Cache-friendly iteration (dense arrays)
- Swap-and-pop deletion (no holes)

#### View System

Views provide filtered iteration over entities with specific components:

```cpp
auto view = registry.view<Transform, Velocity>();
for (auto entity : view) {
    auto& t = view.get<Transform>(entity);
    auto& v = view.get<Velocity>(entity);
    t.position += v.linear * deltaTime;
}
```

### Renderer (`src/esengine/renderer/`)

WebGL-based rendering system.

```
┌─────────────────────────────────────────────────────────────┐
│                        Renderer                              │
│  ┌─────────────────┐  ┌─────────────────┐                   │
│  │ RenderCommand   │  │     Shader      │                   │
│  │ (Low-level GL)  │  │  (GLSL Program) │                   │
│  └─────────────────┘  └─────────────────┘                   │
│  ┌─────────────────┐  ┌─────────────────┐                   │
│  │     Buffer      │  │     Texture     │                   │
│  │  (VBO/EBO/VAO)  │  │   (2D Images)   │                   │
│  └─────────────────┘  └─────────────────┘                   │
└─────────────────────────────────────────────────────────────┘
```

Key classes:
- **Renderer**: High-level static API for rendering
- **RenderCommand**: Low-level OpenGL operations
- **Shader**: GLSL shader compilation and uniforms
- **Buffer**: Vertex/Index buffers with layout specification
- **Texture**: 2D texture loading and binding

### Platform (`src/esengine/platform/`)

Platform abstraction layer.

```
┌─────────────────────────────────────────────────────────────┐
│                     Platform Interface                       │
│  - initialize() / shutdown()                                │
│  - pollEvents() / swapBuffers()                             │
│  - getTime() / getDeltaTime()                               │
│  - Touch/Key/Resize callbacks                               │
└─────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│                     WebPlatform                              │
│  - Emscripten/WebGL context                                 │
│  - HTML5 event handling                                     │
│  - Canvas management                                        │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

### Frame Loop

```
┌───────────┐    ┌───────────┐    ┌───────────┐    ┌───────────┐
│  Events   │ →  │  Update   │ →  │  Render   │ →  │   Swap    │
│ (Input)   │    │ (Systems) │    │ (Draw)    │    │ (Present) │
└───────────┘    └───────────┘    └───────────┘    └───────────┘
     │                │                │                │
     ▼                ▼                ▼                ▼
   Input          Registry          Renderer         Platform
   System         .each<>()         .submit()        .swapBuffers()
```

### Component Access Patterns

```cpp
// Pattern 1: Direct access (when you know the entity)
auto& transform = registry.get<Transform>(entity);

// Pattern 2: View iteration (for batch processing)
registry.view<Transform, Velocity>().each([](auto& t, auto& v) {
    t.position += v.linear;
});

// Pattern 3: Conditional access
if (auto* health = registry.tryGet<Health>(entity)) {
    health->value -= damage;
}
```

## Memory Layout

### Entity IDs

```
Entity = uint32_t
┌────────────────────────────────────┐
│          32-bit ID                 │
│  (0 to 4,294,967,294)             │
│  INVALID_ENTITY = 4,294,967,295   │
└────────────────────────────────────┘
```

### Component Storage

```
SparseSet<Transform>:
sparse_: [2, -, 0, -, 1, ...]  (Entity → Index)
dense_:  [E2, E4, E0]          (Index → Entity)
components_: [T2, T4, T0]      (Actual data, contiguous)
```

## Platform Integration

### Web/Emscripten

```
JavaScript                    C++ (WASM)
    │                             │
    │  es_init(w, h)             │
    ├────────────────────────────►│
    │                             │
    │  requestAnimationFrame     │
    │◄────────────────────────────┤
    │                             │
    │  es_update(dt)             │
    ├────────────────────────────►│
    │  es_render()               │
    ├────────────────────────────►│
    │                             │
```

### WeChat MiniGame

The engine uses a compatibility layer (`weapp-adapter.js`) to provide browser-like APIs in the WeChat environment.

## Extension Points

1. **Custom Components**: Any struct can be a component
2. **Custom Systems**: Inherit from `System` or use free functions
3. **Custom Shaders**: Pass GLSL source to `Shader::create()`
4. **Platform Adaptation**: Implement `Platform` interface

## Performance Considerations

1. **Component Iteration**: Views iterate only entities with all required components
2. **Memory Locality**: Components stored contiguously in SparseSet
3. **Minimal Allocations**: Entity recycling, pool-based allocation
4. **Batch Rendering**: BatchRenderer2D for efficient sprite rendering

## Scene Management

The SDK provides a first-class scene management system built on top of ECS resources.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     SceneManager (Resource)                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Scene Registry                                        │   │
│  │  configs_: Map<string, SceneConfig>                   │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Active Scenes                                         │   │
│  │  scenes_: Map<string, SceneInstance>                   │   │
│  │  activeScene_ / additiveScenes_                        │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Lifecycle: load → running → paused/sleeping → unload │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

- **Single World**: All scenes share one ECS World. Entities are tagged with `SceneOwner` component to track ownership.
- **Camera Filtering**: The render system filters cameras by `SceneOwner`, only rendering cameras belonging to active scenes.
- **Draw Callback Scoping**: Custom draw callbacks are associated with scene names and filtered during render.
- **System Scoping**: Scene systems are wrapped to only execute when their scene status is 'running'.
- **Automatic Plugin**: `sceneManagerPlugin` is included in `createWebApp()` and runs a transition update system each frame.

## Future Improvements

- [ ] Component groups for cache optimization
- [ ] Event/signal system
- [ ] Audio system
- [x] Scene serialization
- [x] Physics integration
- [x] UI system
- [x] Scene management
