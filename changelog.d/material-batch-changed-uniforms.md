---
section: Changed
commits:
  - perf(material): send changed uniforms during material snapshot updates
---
**Editing one material parameter sends fewer updates to the renderer.** The runtime skips unchanged scalar and vector parameters and restores the complete snapshot when the shader or renderer changes.
