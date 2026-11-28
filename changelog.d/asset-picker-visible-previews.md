---
section: Changed
commits:
  - perf(editor): load asset picker thumbnails only for visible options
---
**Large asset pickers request thumbnails as you scroll.** Both list and grid modes defer generated previews until their pictures enter view and release the subscription when they leave. Every option remains reachable by keyboard.
