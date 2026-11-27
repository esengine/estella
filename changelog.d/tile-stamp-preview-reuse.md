---
section: Changed
commits:
  - perf(editor): reuse tile stamp preview slices
---
**Large tile stamp previews take less time to build.** Repeated tiles share their atlas and orientation calculations, and unchanged thumbnails stay in place as other palette controls update.
