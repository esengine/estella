---
section: Fixed
commits:
  - fix(editor): reveal the highlight when paging reaches a searchable dropdown boundary
---
**Page Up and Page Down bring the highlighted suggestion back into view.** This works at the first and last choices after wheel scrolling, including in long searchable lists. The text input keeps keyboard focus.
