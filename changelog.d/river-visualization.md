---
section: Added
commits:
  - feat(editor): a spline point's right-click menu, and a river's current, width and depth shown and dragged in the viewport
---
**River visualization and a spline point's right-click menu.** Right-click a point of a spline or an outline in the viewport for **Delete Spline Point**, **Duplicate Spline Point**, **Select Spline Points** (first, previous, next, last), **Spline Point Type**, **Reset to Automatic Tangent** and **Focus Selected**. On a river the same menu switches what it shows beside its points: **Visualize Water Velocity** draws three arrows at each point, as long as a second of its current and pointing the way it runs; **Visualize River Width** shows the handles its width is dragged by (on, as before); **Visualize Depth** draws a line down to each point's depth with a handle that drags it. The arrows' length is scaled by **Water visualization scale** in Settings > Viewport. Dragging a point also no longer drops what it carries (its type and tangents, its depth, velocity and audio intensity).
