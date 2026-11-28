---
section: Changed
commits:
  - perf(lighting): reuse unchanged texture fingerprints between bake checks
---
**Lighting status checks reuse texture fingerprints for unchanged files.** Concurrent checks also share reads, while edits, replacements and deletions still invalidate the saved bake status.
