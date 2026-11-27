---
section: Changed
commits:
  - perf(picking): keep only the nearest opaque hit for first-hit ray queries
  - perf(editor): use first-hit rays for viewport hover and Play selection
---
**Faster first-hit picking in deep scenes.** Hover and Play selection use a shared SDK query that keeps only the nearest opaque ray hit before ranking it against blended draws. Selection cycling still returns every hit.
