---
section: Changed
commits:
  - perf(editor): reuse enabled choices during dropdown keyboard navigation
---
**Keyboard navigation in long editor dropdowns does less work per key press.** Lists reuse the set of enabled choices until rows change.
