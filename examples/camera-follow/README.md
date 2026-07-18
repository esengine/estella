# Camera Follow

A tour of the **camera director** — the runtime that decides what the camera
shows and how it gets there: damped target following, transient screen shake,
and smooth blends between cameras.

Move the player square with **WASD** / arrow keys across a large scrolling
world. The camera trails it with a dead zone and damping. Then:

| Key | Action |
|---|---|
| **WASD / arrows** | Move the player. |
| **Space** | `shakeCamera` — a decaying impact shake. |
| **1** | `setViewTarget` back to the **follow camera** (1.2 s EaseInOut blend). |
| **2** | `setViewTarget` to the fixed **overview camera** framing the whole world. |

## What it shows

- **`FollowTarget`** — add this component to a camera and point it at an entity;
  the built-in follow system damps the camera's Transform toward the target every
  frame (play mode only). The damping is frame-rate independent, and the dead
  zone lets the target roam a small radius without dragging the view.
- **`shakeCamera(app, opts)`** — pushes a decaying, noise-driven perturbation
  onto the **rendered** view only. The camera's Transform is never touched, so
  the view always recovers and the scene stays clean. Shakes stack.
- **`setViewTarget(app, entity, opts)`** — hands the view to another camera
  entity, optionally **blending** position, zoom, and rotation over `time`
  seconds with a `BlendCurve` easing instead of cutting. The target camera does
  not need `isActive` — the director overrides the active-camera pick.
- **Follow + blend compose**: while blended to the overview, the follow camera
  keeps tracking the player, so pressing **1** blends back to wherever the
  player is *now*.

All three run through the engine's built-in `CameraPlugin` — no camera systems
in project code. The project only spawns the world, moves the player, and issues
director requests from input.

## API reference

### `FollowTarget` component

```typescript
cmds.entity(cameraEntity).insert(FollowTarget, {
    target: playerEntity,
    deadzone: 48,
    damping: 0.25,
});
```

| Property | Type | Default | Description |
|---|---|---|---|
| `target` | Entity | `-1` | Entity to follow (`-1` = none). |
| `offsetX` | number | `0` | World-space X offset added to the target position. |
| `offsetY` | number | `0` | World-space Y offset added to the target position. |
| `deadzone` | number | `0` | Radius (world units) the target may roam before the camera moves. |
| `damping` | number | `0.25` | Smoothing time-constant in seconds (larger = smoother/slower; `0` = snap). |

### `shakeCamera(app, opts?)`

```typescript
shakeCamera(app, { amplitude: 16, rotation: 0.02, frequency: 24, duration: 0.5 });
```

| Option | Default | Description |
|---|---|---|
| `amplitude` | `12` | Peak positional offset (world units). |
| `rotation` | `0` | Peak rotational shake (radians). |
| `frequency` | `22` | Oscillations per second. |
| `duration` | `0.4` | Seconds to decay to zero. |

### `setViewTarget(app, entity, opts?)`

```typescript
setViewTarget(app, overviewCamera, { time: 1.2, curve: BlendCurve.EaseInOut });
```

| Option | Default | Description |
|---|---|---|
| `time` | `0` | Blend duration in seconds; `<= 0` (or no prior view) is an instant cut. |
| `curve` | `BlendCurve.EaseInOut` | Easing: `Linear`, `EaseIn`, `EaseOut`, `EaseInOut`. |

Position, zoom (`orthoSize`), and rotation interpolate (rotation takes the short
way around); discrete fields (projection, viewport) snap at the blend midpoint.

### Calling the director from a system

`setViewTarget`/`shakeCamera` accept either the App (host code) or the
`CameraDirector` resource state itself — inside a system, pass what
`Res(CameraDirector)` gives you, as `src/systems/director.ts` does. In a
self-hosted runtime where you created the App yourself, pass the App directly.

## Files

- `src/systems/setup.ts` — spawns the world (ground-dot grid, landmarks, border),
  the player, the inactive overview camera, and inserts `FollowTarget` on the
  scene's active camera.
- `src/systems/move.ts` — WASD/arrow movement, clamped to the world bounds.
- `src/systems/director.ts` — Space/1/2 → `shakeCamera` / `setViewTarget`.
- `src/components.ts` — the project's `Player` component and `OverviewCam` tag.
- `src/config.ts` — world size, follow/shake/blend tuning, landmark layout.
- `assets/scenes/main.esscene` — the active gameplay camera + UI canvas; the
  rest of the world is spawned from code.

## 中文摘要

本示例演示**相机导演**的三个核心 API：

- **`FollowTarget` 组件**——挂在相机上并指向玩家实体，内置系统每帧以
  帧率无关的阻尼把相机拉向目标；`deadzone` 内的小幅移动不会带动相机。
- **`shakeCamera`**——按 **空格** 触发衰减震屏，只作用于渲染视图、
  不改相机 Transform，因此画面必然复原。
- **`setViewTarget`**——按 **1 / 2** 在跟随相机与固定全景相机之间以
  1.2 秒 EaseInOut 曲线平滑混合（位置、缩放、旋转插值）。

用 **WASD / 方向键** 移动白色方块即可观察相机跟随；各选项的默认值见上方
英文表格。三个能力全部由引擎内置 `CameraPlugin` 驱动，项目代码只负责
生成世界、移动玩家、响应按键。
