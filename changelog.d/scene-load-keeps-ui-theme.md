---
section: Fixed
commits:
  - "fix(scene): keep the active UI theme when a load fails"
---
**A failed scene load keeps the running UI's palette.** Scene-specific themes restyle the world when the incoming scene finishes loading, and a failed load leaves existing widgets with their previous colors.
