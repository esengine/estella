---
section: Changed
commits:
  - perf(editor): reuse dropdown labels for keyboard prefix search
---
**Typing to navigate long editor dropdowns uses fewer DOM reads.** Prefix matching reuses labels until the options or their text change.
