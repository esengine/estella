---
section: Fixed
commits:
  - fix(render): keep camera LOD decisions with their world
  - fix(editor): inspect and preview LODs in the owning world
---
**Scenes that share a renderer now choose their own mesh detail levels.** Groups with matching entity and camera IDs keep their own screen measurements, transitions, and preview settings. The editor reads the edit world's decision even when another scene draws afterward.
