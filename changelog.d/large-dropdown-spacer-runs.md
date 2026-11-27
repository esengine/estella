---
section: Changed
commits:
  - perf(editor): combine offscreen option list spacers
  - perf(project): ship faster large dropdown rendering
---
**Large searchable dropdowns open and scroll faster.** Entity, joint, and suggestion pickers combine consecutive offscreen pages into a single spacer and retain measured heights for wrapped labels.
