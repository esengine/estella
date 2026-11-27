---
section: Changed
commits:
  - perf(editor): reuse shared corner samples while painting Wang terrain
---
**Wang terrain strokes do less work per painted cell.** The editor samples shared corners once while updating neighboring tiles, reducing tile reads during long strokes.
