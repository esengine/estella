---
section: Fixed
commits:
  - fix(render): ignore hidden UI bounds when framing prefab previews
---
**Hidden UI no longer shrinks prefab previews.** The preview uses the renderer's inherited visibility so a detached, hidden panel with a retained layout cannot affect the framing of visible content.
