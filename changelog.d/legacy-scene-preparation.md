---
section: Fixed
commits:
  - fix(scene): migrate packaged documents before discovering assets and physics
---
**Packaged games now load meshes and 2D physics from older scenes the same way the editor does.** Scene preparation upgrades legacy component names before looking up geometry, textures and physics. Streamed cells finish that migration before they are brought into view.
