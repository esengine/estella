# Render Texture

Offscreen rendering with the **`RenderTexture`** API — the engine surface
behind minimaps, live portraits, picture-in-picture, and cache-as-bitmap.

Colored shapes drift along orbits across a 3200×2000 world while the camera
only ever shows the middle 1280×720 — most shapes are offscreen at any moment.
A quad pinned to the top-right corner shows the whole world live: every frame
a system paints a schematic of the world into a `RenderTexture`, and the
quad's `Sprite` samples the target's `texture`.

| Key | Action |
|---|---|
| **R** | Cycle the target's resolution: 96×60 → 192×120 → 384×240 → 768×480. The quad keeps the same on-screen size, so the fidelity change is obvious (and `resize` semantics are exercised — see below). |

## The exact flow the engine supports

`RenderTexture` is a **low-level** surface. Two things it does *not* do:

- **A camera cannot target a RenderTexture.** There is no "second camera
  rendering to an offscreen target" path.
- **It does not re-render the scene for you.** `begin`/`end` redirect whatever
  you draw with the immediate [`Draw` API](../../docs/astro/src/content/docs/guides/drawing.mdx)
  into the target, under a view-projection matrix you supply. Scene entities
  are not involved.

So a "minimap" here is *painted*, not re-rendered: the system queries the
shapes and draws one dot per shape with `Draw.rect`. (For a top-down minimap
that is also what most real games do.) The resulting `texture` is an
ordinary texture handle usable anywhere — a `Sprite.texture`, `Draw.texture`,
a material texture parameter.

The full per-frame sequence, from `src/systems/minimap.ts`:

```typescript
RenderTexture.begin(rt, viewProjection);       // binds the offscreen target
Draw.begin(viewProjection);                    // opens the immediate-draw batch
Renderer.setViewport(0, 0, rt.width, rt.height);

Draw.rect(...);                                // opaque background = the clear
Draw.rectOutline(...);                         // world border, camera view rect
Draw.rect(...);                                // one dot per shape

Draw.end();                                    // submits the batch into the target
RenderTexture.end();                           // closes the pass, back to the screen
```

Four practical rules this example encodes:

1. **Run the pass outside the scene render.** A `begin`/`end` pair is a
   self-contained render pass. Do it from a `Schedule.Update` system (the
   engine renders in `Schedule.Last`) — *not* inside a `registerDrawCallback`
   callback, which runs in the middle of the on-screen pass.
2. **Set the viewport, after `Draw.begin`.** `Draw.begin` resets the GL
   viewport to the screen size, so call
   `Renderer.setViewport(0, 0, rt.width, rt.height)` after it (and before
   `Draw.end`, which is when the batch is actually submitted). No restore is
   needed — every on-screen camera pass sets its own viewport.
3. **The pass does not clear the target.** Contents persist between frames;
   the first opaque full-target rect is your clear (or a feature — leave
   trails by painting a translucent one).
4. **The view-projection is yours to build.** It defines what world-space
   region maps onto the target. This example's ortho spans the *world's*
   extents, so all painting happens in plain world coordinates and the matrix
   does the world→minimap mapping. (`ortho()` is five lines in
   `src/systems/minimap.ts`; the SDK does not export one.)

One display-side detail: the minimap quad's Sprite sets **`flipY: true`**.
A GL framebuffer's row 0 is the target's *bottom*, while an image texture's
row 0 is its *top* — sampling a RenderTexture with regular sprite UVs shows
it upside down, and `flipY` is the one-field fix.

## API reference

### `RenderTexture.create(options)` → `RenderTextureHandle`

```typescript
const rt = RenderTexture.create({ width: 384, height: 240, depth: false, filter: 'nearest' });
```

#### `RenderTextureOptions`

| Field | Type | Default | Description |
|---|---|---|---|
| `width` | number | — | Target width in pixels (required). |
| `height` | number | — | Target height in pixels (required). |
| `depth` | boolean | `true` | Attach a depth buffer. Turn off for pure 2D compositing (this example does) to save memory. |
| `filter` | `'nearest'` \| `'linear'` | `'nearest'` | Sampling filter when the result is drawn. `nearest` keeps low resolutions honestly blocky; `linear` smooths. |

#### `RenderTextureHandle`

| Field | Description |
|---|---|
| `texture` | The color attachment as an ordinary texture handle — assign it to `Sprite.texture`, pass it to `Draw.texture`, bind it as a material param. |
| `width` / `height` | The target's size in pixels. |

### Methods

| Method | Does |
|---|---|
| `begin(rt, viewProjection)` | Redirects subsequent rendering into the target under the matrix you supply. **Does not clear** the target. |
| `end()` | Ends the offscreen pass; rendering goes back to the screen. |
| `resize(rt, width, height)` | Releases the old target and creates a fresh one, preserving `depth`/`filter`. **Returns a new handle — the old handle (and its `texture`) is dead.** Re-point every consumer at the new `texture`; this example syncs the quad's `Sprite.texture` to `rt.texture` every frame, so pressing **R** just works. |
| `getDepthTexture(rt)` | The depth attachment as a sampleable texture handle (targets created with `depth: true` only). |
| `release(rt)` | Frees the target and its textures. |

## Files

- `src/systems/minimap.ts` — the heart of the example: creates the target,
  paints it every frame with the `Draw` API, cycles its resolution on **R**,
  and keeps the quad's `Sprite.texture` pointed at the current `texture`.
- `src/systems/setup.ts` — spawns the world (ground-dot grid, border frame),
  the orbiting shapes, and the minimap quad (`flipY: true`).
- `src/systems/orbit.ts` — drifts each shape along its ellipse.
- `src/components.ts` — `Orbit` motion params, `Blip` / `Minimap` tags.
- `src/config.ts` — world extents, shape roster, minimap resolutions/placement.
- `assets/scenes/main.esscene` — the static scene camera + UI canvas; the rest
  is spawned from code.

## 中文摘要

本示例演示 **`RenderTexture`** 离屏渲染——小地图 / 画中画的引擎基础设施。

引擎支持的确切流程（诚实说明):**相机不能以 RenderTexture 为渲染目标**,
它也**不会替你重绘场景**;`begin`/`end` 之间用即时 `Draw` API 画什么,
什么就落进离屏目标,视图投影矩阵由你自己提供。得到的 `texture` 是普通
纹理句柄,可赋给 `Sprite.texture` 等任何吃纹理的地方。

- 彩色方块沿椭圆轨道漂移,大部分时间在相机视野之外;右上角小地图每帧由
  系统用 `Draw.rect` 重绘全世界(背景不透明矩形兼作清屏——pass 本身不清)。
- 按 **R** 循环切换目标分辨率;`resize` 会**返回新句柄、textureId 随之改变**,
  所有消费者必须重新指向新 id(本例每帧同步 `Sprite.texture`)。
- 四条实践规则:在 `Schedule.Update` 里做离屏 pass(不要在 draw callback 里);
  `Draw.begin` 之后调 `Renderer.setViewport(0,0,rt.width,rt.height)`;
  自己画清屏背景;正交矩阵自己搭(SDK 不导出 `ortho`)。
- 显示端细节:GL 帧缓冲第 0 行在底部,与图片纹理相反,采样会上下颠倒,
  小地图 Sprite 用 `flipY: true` 一字段修正。

`RenderTextureOptions` 各字段(`width`/`height` 必填、`depth` 默认开、
`filter` 默认 `nearest`)见上方英文表格。
