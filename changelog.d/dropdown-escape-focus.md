---
section: Fixed
commits:
  - "fix(editor): return focus to a dropdown's button on Escape and on a pick"
---
**Closing a dropdown with Escape puts focus back on its button again.** Since the last dropdown focus change, Escape could leave keyboard focus on the page or on another button in the same dialog, so the next Tab or Enter went somewhere unexpected. A pick that moves focus to another control still keeps it there.
