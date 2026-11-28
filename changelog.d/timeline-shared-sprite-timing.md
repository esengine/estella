---
section: Changed
commits:
  - perf(animation): reuse frame timing across nested sprite instances
---
**Nested instances of the same Sprite track reuse the selected frame when their playheads match.** The editor and runtime resolve each instance’s textures separately and read timing edits on the next sample.
