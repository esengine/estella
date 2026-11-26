---
section: Changed
commits:
  - perf(editor): skip Game inspector renders on camera-only updates
---
**The Game inspector does less work while the camera moves.** The selection outline still follows the camera, and property controls refresh when the selected entity changes.
