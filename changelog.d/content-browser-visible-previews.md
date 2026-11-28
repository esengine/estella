---
section: Changed
commits:
  - perf(editor): generate Content Browser thumbnails only when visible
---
**The Content Browser generates mesh, material, and prefab thumbnails as they come into view.** The list and grid share the asset picker's visibility check. Previews outside the scroll area stop using the rendering queue when they have no other viewers.
