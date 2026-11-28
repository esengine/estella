---
section: Changed
commits:
  - perf(editor): share flipbook frame geometry across preview sprites
---
**The viewport does less work when many sprites preview the same flipbook.** Sprites on the same frame share texture and geometry calculations within a preview tick while retaining their individual playback settings, sizes, and anchors.
