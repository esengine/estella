---
section: Fixed
commits:
  - fix(assets): preserve per-frame texture settings across atlas pages
---
**Automatically packed sprites and UI images keep their texture import settings.** Pixel art can use nearest filtering alongside smoothly filtered artwork in the same atlas folder. The build groups compatible images onto each page. Existing packages with mixed settings can share the page bytes while drawing each frame with its own settings.
