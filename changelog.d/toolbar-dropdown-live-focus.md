---
section: Fixed
commits:
  - fix(editor): retain toolbar menu focus through live option updates
---
**Toolbar dropdowns keep keyboard focus visible as their choices change.** The menu scrolls the focused choice into view when new items arrive, and moves focus to an available choice when the old one disappears.
