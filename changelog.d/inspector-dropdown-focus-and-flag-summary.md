---
section: Fixed
commits:
  - fix(editor): restore inspector dropdown focus and reveal clipped flag summaries
---
**Inspector dropdowns return focus to the field that opened them.** Pressing Escape or choosing a single value returns keyboard focus to the triggering field when the popup still owns focus. Clipped flag summaries show the full selection on hover or keyboard focus.
