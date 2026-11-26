---
section: Fixed
commits:
  - fix(editor): keep dropdown keyboard focus when choices refresh
---
**Open dropdowns remain keyboard-operable when their options change.** If the focused choice disappears or becomes disabled, focus moves to an available choice or back to the search. The search stays visible while its filter is active.
