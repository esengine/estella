# Texture Canvas

Compose a picture at run time: make a blank canvas, paste textures into it at pixel positions,
and show the result on a `Sprite`. The same three steps as Unity's `Graphics.CopyTexture` or
drawing onto an Unreal render target, in `src/main.ts`:

```typescript
const canvas = TextureCanvas.create(256, 256);          // 1. a blank canvas
canvas.draw(body.texture, 96, 100);                     // 2. paste a texture: (x, y) = its top-left corner
canvas.draw(head.texture, 104, 46);
canvas.draw(head.texture, 190, 20, 24, 24);             //    optional width and height scale it
sprite.texture = canvas.texture;                        // 3. the finished texture goes on a Sprite
```

A small figure is put together from a body, a head, two arms and two legs, plus a smaller head
pasted off to the side. The parts are painted flat-coloured textures so the example needs no asset
files; in a game they would be loaded images.

- **Coordinates** are pixels from the canvas's top-left, y pointing down, like an image editor.
- **Order matters**: pictures blend over what is already there, in the order they are pasted. The
  legs go first so the body covers their tops.
- **Call it from a `Schedule.Update` system**, not a draw callback: each `draw` is a render pass of
  its own.
- **Keep the pasted textures alive.** After a lost graphics device the canvas is drawn again from
  them, in the same order, automatically.
- `canvas.clear()` turns it transparent again; `canvas.release()` frees it.
- To pack many pictures with no positions of your own, use `TextureAtlas.pack` instead
  (see the [Render Texture example](../render-texture)).

## 中文摘要

在运行时拼一张图:先建一块空白画布,再把纹理按像素坐标贴进去,最后把成品纹理赋给 `Sprite`。
对应 Unity 的 `Graphics.CopyTexture`、UE 往 RenderTarget 上绘制,代码见 `src/main.ts`。

- 坐标以画布左上角为原点、y 向下(像素)。
- 后贴的盖在先贴的上面。
- 在 `Schedule.Update` 的系统里调用,不要放进 draw callback。
- 被贴的纹理要保持存活:设备丢失后会按原顺序自动重画。
- 想要引擎自动排布、不指定位置,用 `TextureAtlas.pack`。
