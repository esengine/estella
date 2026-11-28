---
section: Changed
commits:
  - perf(picking): resolve selection bounds and draw offset together
  - perf(editor): share one selection geometry read per Play overlay
---
**Play selection overlays reuse geometry for the outline and transform handle.** Each refresh reads mesh bounds or the parented sprite matrix once, and Edit and Play use the same SDK selection geometry.
