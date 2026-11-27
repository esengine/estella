---
section: Fixed
commits:
  - perf(editor): scan projected marquee bounds once
---
**Marquee bounds in large scenes.** The editor computes screen bounds in a single scan and skips geometry with empty or non-finite projections.
