---
section: Fixed
commits:
  - fix(render): preserve mesh appearance when composite transforms shear
---
**Composite batching preserves mesh appearance under nonuniform scale.** A placement that would draw differently after batching stays on its original mesh renderer. When a moving root changes its scale ratios, its placements are checked again before batching resumes.
