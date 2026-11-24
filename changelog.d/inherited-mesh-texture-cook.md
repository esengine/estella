---
section: Fixed
commits:
  - fix(pipeline): cook inherited mesh textures from their declared surface fields
---
**Mesh material instances now get build-time texture previews for the samplers they inherit.** Web export reads the built-in renderer's texture-density declarations and resolves each sampler relative to the material that supplied it. An override selects the instance's texture for its preview. Automatic compression in the editor and in exports uses the same result.
