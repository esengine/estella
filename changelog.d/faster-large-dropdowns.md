---
section: Changed
commits:
  - perf(editor): reduce keyboard navigation work in large dropdowns
  - perf(project): ship faster large editor dropdowns
---
**Large searchable dropdowns respond faster to keyboard navigation.** The editor skips scanning off-screen options when updating the visible rows and reuses the selected entity's position while you move the highlight.
