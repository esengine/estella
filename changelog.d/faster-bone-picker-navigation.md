---
section: Changed
commits:
  - perf(editor): reuse selected rows while navigating bone pickers
  - perf(project): ship faster bone picker navigation
---
**Keyboard navigation is faster in large joint lists.** The Animator's bone picker reuses the saved selection while moving the highlight and refreshes it when you pick joints or change the filter.
