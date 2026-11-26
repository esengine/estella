---
section: Changed
commits:
  - perf(editor): skip camera-only renders in Play diagnostics
---
**Play diagnostics stay responsive while the camera moves.** The UI Elements, Focus and navigation views refresh for the data they display, avoiding extra panel renders on selection-outline updates.
