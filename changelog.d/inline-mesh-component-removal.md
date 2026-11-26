---
section: Fixed
commits:
  - fix(render): retire inline geometry with its mesh component
---
**Removing and re-adding a MeshRenderer starts with empty inline geometry.** Scene saves now drop the old vertices when the component is removed, so they cannot reappear when the scene is loaded.
