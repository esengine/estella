---
section: Added
commits:
  - "feat(ui): fade what a UIMask holds in from its edges with UIMask.softness"
---
**A UI mask can fade its content at its edges instead of cutting it.** `UIMask.softness` (UI pixels: x for the left and right
edges, y for the bottom and top) makes a Scissor mask fade what it holds in from its box's edges: a compass whose letters
dissolve at its ends, a list or a ticker that fades at the top and bottom. A soft mask inside another takes over for its own
content, and the outer box still cuts. Sprites, UI visuals and text fade; a visual wearing a material of its own is cut at the
box as before.
