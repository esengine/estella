---
section: Changed
commits:
  - feat(editor): paint the picked terrain with the rect, ellipse and line tools
---
**The rect, ellipse and line tools paint the terrain you picked, edges included.** After you pick a terrain in the tilemap palette, a dragged rectangle, ellipse or line resolves its borders the same way as the terrain brush, in one undo step. Picking a tile, a saved stamp or the clipboard makes the shape tools tile it again.
