# Trails

A tour of the engine's **built-in trail renderer** — the `TrailRenderer`
component records an entity's world-space path and draws it as a tapering,
fading ribbon, entirely engine-side. Three emitters run distinct configs side
by side:

- **Comet** — rides a Lissajous figure with a long additive streak
  (1.4 s lifetime, 26 px head tapering to 0, warm → transparent gradient).
- **Follower** — eases toward the mouse cursor with a slim cool ribbon — the
  classic cursor trail, using mostly default settings.
- **Dasher** — click anywhere and it dashes there in 0.14 s, leaving a wide,
  short-lived additive burst (44 px head, 0.25 s lifetime).

| Input | Action |
|---|---|
| **Mouse move** | The cyan follower chases the cursor. |
| **Click** | The dasher dashes to the cursor (wide burst trail). |
| **E** | Toggle the comet's `emitting` — the streak stops growing and fades out in place; pressing again resumes recording. |
| **C** | `trail.clear(entity)` on every trail — all streaks vanish instantly. |
| **T** | Teleport the dasher home **with** a `clear`, so no streak spans the jump. |

## What it shows

- **Zero per-frame trail code.** Systems only move the emitters; the built-in
  `TrailSystem` (part of the default plugin set) records a point whenever an
  entity with a `TrailRenderer` has moved farther than `minVertexDistance`,
  ages points out after `time` seconds, and the renderer extrudes the ribbon —
  width and color interpolate from head to tail by each point's age. A live
  head vertex glues the ribbon to the entity between recorded points, so the
  trail never lags visually.
- **Component-level control** — `emitting: false` stops recording new points;
  the existing streak keeps aging and fades out where it was left.
  (`enabled: false` is stronger: it hides the ribbon *and* pauses aging, so
  the history is kept and re-enabling resumes the same streak.)
- **Resource-level control** — the `Trail` resource (`Res(Trail)`) exposes
  `clear(entity)`, which drops the recorded history instantly. Pair it with
  any teleport so the ribbon doesn't draw a streak across the jump.
- Trails record in **play mode** (and the editor's FX preview), like particles
  and physics — press Play to see them.

## `TrailRenderer` component

```typescript
cmds.spawn()
    .insert(Transform, { position: { x: 0, y: 0, z: 0 } })
    .insert(Sprite, { size: { x: 22, y: 22 } })
    .insert(TrailRenderer, {
        time: 1.4,
        startWidth: 26,
        endWidth: 0,
        startColor: { r: 1, g: 0.72, b: 0.3, a: 0.9 },
        endColor: { r: 1, g: 0.2, b: 0.1, a: 0 },
        blendMode: BlendMode.Additive,
    });
```

| Field | Type | Default | Meaning |
|---|---|---|---|
| `time` | number | `0.5` | Seconds each recorded point lives before it fades out of the tail. |
| `minVertexDistance` | number | `5` | Minimum world distance the entity must move before a new point is recorded. Smaller = smoother, denser ribbon. |
| `emitting` | boolean | `true` | Record new points. `false` = stop recording: the streak stops growing and its points age out (fade in place). |
| `startWidth` | number | `20` | Full ribbon width (world units) at the head — the newest point. |
| `endWidth` | number | `0` | Full ribbon width at the tail — the oldest point. Width lerps head→tail by point age. |
| `startColor` | Color | `{1, 1, 1, 1}` | Color at the head (newest point). |
| `endColor` | Color | `{1, 1, 1, 0}` | Color at the tail (oldest point) — usually alpha 0 so the trail fades out. Color lerps by age. |
| `texture` | texture handle | `0` | Optional texture (0 = solid white). U runs head (0) → tail (1) along the ribbon, V spans its width. |
| `blendMode` | number | `0` | `BlendMode`: 0 Normal, 1 Additive (glow), 2 Multiply, 3 Screen, 4 PremultipliedAlpha. |
| `layer` | number | `0` | Sorting layer — draw order against other renderables. |
| `material` | material handle | `0` | Optional material override (custom shader/blend); advanced. |
| `enabled` | boolean | `true` | Master toggle: hides the ribbon and pauses simulation (recording *and* aging). History is kept, so re-enabling resumes the same streak. |

## `Trail` resource (`TrailAPI`)

Declare `Res(Trail)` as a system param (or `app.getResource(Trail)` outside
ECS code):

| Method | Meaning |
|---|---|
| `clear(entity)` | Drop the entity's recorded history — the streak vanishes instantly. Use before/after teleports. |
| `update(dt)` | Advance every trail (record + age out). Driven automatically each frame by the built-in `TrailSystem`; call it yourself only in a hand-rolled headless setup. |

## Files

- `src/systems/setup.ts` — spawns the three emitters with their trail configs
  and a floating label per emitter.
- `src/systems/motion.ts` — Lissajous comet, cursor-chasing follower, and the
  ease-out dash flight. No trail code — moving the Transform is enough.
- `src/systems/control.ts` — click → dash; E toggles `emitting`; C/T use the
  `Trail` resource's `clear`.
- `src/systems/labels.ts` — keeps each label floating above its emitter.
- `src/components.ts` — `Comet`/`Follower` tags, `Dasher` dash state, `LabelOf`.
- `src/config.ts` — path shapes, dash timing, sizes.
- `assets/scenes/main.esscene` — camera, dark background, title + hint UI; the
  emitters are spawned from code.

## 中文摘要

本示例演示引擎**内置拖尾渲染器**：给实体挂 `TrailRenderer` 组件，引擎每帧
自动记录其世界坐标轨迹并渲染成由头到尾渐细、渐隐的条带——项目代码只负责移动
实体。三个发射器并排展示不同配置：

- **Comet**——沿利萨茹曲线飞行，长加法混合拖尾（1.4 秒寿命，26px 头部渐细到 0）。
- **Follower**——追随鼠标的细蓝拖尾（基本使用默认参数）。
- **Dasher**——点击任意位置冲刺过去，留下 0.25 秒即逝的宽爆发拖尾。

按 **E** 切换彗星的 `emitting`（停止记录：轨迹不再增长、原地淡出，再按恢复
记录）；按 **C** 调用 `Trail` 资源的 `clear(entity)` 立即清空所有拖尾；按
**T** 把 Dasher 传送回家并同时 `clear`——传送配合 clear 是标准用法，避免瞬移
画出一条横跨屏幕的拖尾。各字段的类型与默认值见上方英文表格。
