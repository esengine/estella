---
section: Changed
commits:
  - perf(editor): reuse row positions in large suggestion lists
  - perf(project): ship faster grouped editor suggestions
---
**Large editor suggestion lists respond faster to keyboard navigation.** The input reuses the row positions it built while filtering and grouping suggestions. Keyboard jumps keep wrapped options in view as the list finishes laying out.
