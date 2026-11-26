---
section: Fixed
commits:
  - fix(runtime): omit transient fields from authoring snapshots
---
**Play and device inspection follow the same transient-field rules as scene saves.** Live-only fields such as a text input's current focus stay out of the component data offered for authoring.
