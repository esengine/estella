# Custom Drawing

The engine's **three drawing tiers** side by side — when sprites and particles
can't express a visual, this is the layer underneath them:

| Zone | API | Model | Reach for it when |
|---|---|---|---|
| Left | `Draw` | **Immediate** — commands batch and clear every frame. | Debug overlays, gizmos, anything redrawn from scratch each frame. |
| Middle | `Graphics` | **Retained** path recorder — build once, replay with `flush()`. | Vector shapes with paths/béziers/arcs you don't want to re-tessellate per frame. |
| Right | `Mesh2D` | **Component** — an entity with sorting layers and materials. | Meshes that are part of the scene (sorted, saved, inspectable). |

Rule of thumb: if the visual belongs to the *scene*, make it a component; if it
belongs to a *frame* (debug, HUD-ish overlays, procedural effects), draw it in
a callback.

| Key | Action |
|---|---|
| **G** | `clear()` and re-record the retained star with new random parameters. |

## What it shows

- **Draw — the radar overlay** (`src/systems/radar.ts`). A draw callback runs
  inside the render pass every frame with the camera's view-projection already
  active; every ring, sweep line, and bounding box is re-issued from scratch.
  Animation is just "draw with different numbers next frame" — nothing is
  stored. The bounding boxes track real sprite entities: the movement system
  snapshots drone positions each update, and the callback draws over them —
  the classic debug-overlay pattern.
- **Graphics — the retained star** (`src/systems/star.ts`). `buildStar()`
  records the path once — star polygon, filled hub, arc brackets, a bézier
  swoosh (curves are subdivided *at record time*). After that, the per-frame
  cost is only `flush()`, which replays the recorded commands through `Draw`.
  Pressing **G** is the only time the path is rebuilt.
- **Mesh2D — the procedural ribbon** (`src/systems/ribbon.ts`). The `Ribbon`
  entity is authored in the scene with a `Mesh2D` component, so it sorts with
  sprites via `layer` and is saved and inspectable. Each frame the system
  regenerates the vertex positions and per-vertex colors (indices never change)
  and re-uploads through the **`Meshes2D` resource** —
  `meshes.setGeometry(entity, geometry)` is the supported mutation path; direct
  writes to the component's `geometry` field are not change-detected.

## API reference

### Draw (immediate, global)

```typescript
import { Draw, registerDrawCallback } from 'esengine';

registerDrawCallback('my-overlay', (elapsed) => {
    Draw.line(from, to, color, thickness);
    Draw.rect(center, size, color, filled);          // rectOutline(center, size, color, thickness)
    Draw.circle(center, radius, color, filled, segments);
    Draw.circleOutline(center, radius, color, thickness, segments);
    Draw.texture(center, size, textureHandle, tint); // textureRotated adds radians
    Draw.setLayer(layer);                            // sorting of subsequent commands
    Draw.setDepth(depth);
    Draw.setBlendMode(mode);
});
```

Callbacks draw **on top of** the scene (`registerPreSceneDrawCallback` draws
under it); coordinates are world-space; rect/circle positions are **centers**.
Remove one with `unregisterDrawCallback(id)`.

### Graphics (retained recorder)

```typescript
import { Graphics } from 'esengine';

const g = new Graphics();
g.lineStyle(3, color);            // stroke for subsequent path commands
g.beginFill(color);               // fills rects and circles (paths stay strokes)
g.drawCircle(cx, cy, r);
g.endFill();
g.moveTo(x, y); g.lineTo(x, y);   // polylines
g.curveTo(cpx, cpy, x, y);        // quadratic bézier (cubicCurveTo for cubic)
g.arc(cx, cy, r, a0, a1);         // also drawRect / drawRoundRect / drawEllipse
g.clear();                        // start over (the G-key rebuild)

registerDrawCallback('shape', () => g.flush());   // replay every frame
```

### Mesh2D (component) + Meshes2D (resource)

```typescript
import { Meshes2D, Res, GetWorld } from 'esengine';

// geometry: positions as x,y pairs (component-local), optional per-vertex
// uvs (default 0,0 → vertex colors on the white texture) and colors
// (r,g,b,a floats), plus an indexed triangle list.
meshes.setGeometry(entity, { positions, colors, indices });  // re-uploads (validated)
meshes.getGeometry(entity);                                  // last uploaded geometry
meshes.clearGeometry(entity);                                // valid state: renders nothing
```

The component shares the standard renderable surface: `texture`, `color`,
`layer`, `lit`, `parallax`, `material`. Geometry authored in a scene uploads
automatically on load.

## Files

- `src/systems/radar.ts` — drone movement + position snapshot, and the
  immediate-mode radar overlay draw callback.
- `src/systems/star.ts` — the retained `Graphics` star: build once, `flush()`
  per frame, G to rebuild.
- `src/systems/ribbon.ts` — per-frame ribbon regeneration through `Meshes2D`.
- `src/systems/setup.ts` — spawns the drone sprites the overlay tracks.
- `src/config.ts` — zone layout, radar/star/ribbon tuning, HSV palette helper.
- `assets/scenes/main.esscene` — camera, zone labels, and the `Ribbon` entity
  with its `Mesh2D` component.

## 中文摘要

本示例把引擎的**三层绘制 API** 并排展示：

- **`Draw`（左）**——立即模式：雷达罩的每一圈、扫描线、无人机包围盒都在
  draw callback 里逐帧重发；命令自动合批、帧末清空,「动画」就是下一帧画
  不同的数字。包围盒追踪的是真实精灵实体——移动系统每帧快照位置，回调
  在其上叠加，这正是调试覆盖层的经典写法。
- **`Graphics`（中）**——保留模式路径记录器：星形只在 `buildStar()` 时
  记录一次（贝塞尔曲线在记录时细分），每帧只需 `flush()` 回放；按 **G**
  以新参数 `clear()` 重录，这是唯一重建路径的时刻。
- **`Mesh2D`（右）**——组件网格：`Ribbon` 实体在场景中作者化，随 `layer`
  与精灵排序；系统每帧重新生成顶点与逐顶点颜色，并通过 **`Meshes2D`**
  资源 `setGeometry` 重新上传——这是受支持的运行时改几何路径（直接改
  组件 `geometry` 字段不会被侦测）。

经验法则：属于**场景**的视觉（要排序、保存、可检查）用组件；属于**单帧**
的视觉（调试、覆盖层、程序化特效）在回调里画。
