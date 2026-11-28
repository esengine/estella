---
section: Changed
commits:
  - perf(picking): reduce sorting-group reads and allocations per hit
---
**Selection queries do less work in scenes with nested sorting groups.** Ray and area picks reuse storage for the outermost groups and read live parent links directly where the engine supports it. Masked area picks use the current group layer after the intersection callback.
