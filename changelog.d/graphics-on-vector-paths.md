---
section: Added
commits:
  - feat(render): Graphics fills any path and is tessellated once, and flush() draws it moved, turned, scaled and faded through a batched Draw.triangles
  - perf(render): Graphics keeps its triangles in the engine's memory and flush() draws them by reference - Draw.createTriangles copies a mesh in once, so drawing a shape copies nothing
  - perf(render): a Graphics' triangles live on the GPU and each copy is an instance record - the batch shader's INSTANCED variant moves and tints the shape there, and copies drawn one after another are one instanced draw
---
**`Graphics` fills any outline, builds its triangles once, and draws one shape any number of times faded and moved.** It
filled only rectangles and circles (a path from `moveTo` and `lineTo` stayed an outline, a rounded rectangle filled square
and an ellipse not at all) and replayed every stroke as a separate line each frame. It now tessellates with the engine's
path tessellator: everything drawn between `beginFill` and `endFill` is filled, concave outlines and paths included,
strokes are joined at their corners and capped at their ends (`lineStyle(width, color, { join, cap, miterLimit })`), and
there are `closePath`, `drawPolygon` and a `feather` edge. The triangles are built the first time the drawing is drawn after
a change, and `flush({ x, y, rotation, scale, alpha, tint })` draws them in one batched call, so a shape built once stands
for any number of copies a frame (a hit flash fading out, a marker on every enemy) with nothing rebuilt and no texture
made. `geometry()` returns the triangles. `Draw.triangles(mesh, { tint, transform })` is the new primitive underneath: a
triangle list with a colour a vertex, moved by a 2D affine and batched with the frame's other shapes. The triangles are put on the
GPU once (`Draw.createTriangles`; `Graphics.dispose()` gives the memory back early) and each copy is a 28-byte instance
record the GPU moves and tints the shape by, so copies drawn one after another are one instanced draw. Measured in the editor, 5000 hit flashes a frame cost the script 0.9 ms
(3.4 ms when every flush copied and transformed its triangles on the CPU) and remain one draw call. The Custom Drawing
example fills its star and draws six fading hit flashes from one hexagon.
