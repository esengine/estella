---
section: Fixed
commits:
  - fix(editor): withhold incomplete tilemap palettes and collision previews
---
**A tilemap layer keeps its tile IDs when a referenced tileset goes missing.** The palette identifies the unavailable file and offers a retry. Both the palette and collision preview wait for the full list before calculating IDs.
