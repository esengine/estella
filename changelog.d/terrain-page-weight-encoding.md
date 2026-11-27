---
section: Changed
commits:
  - perf(terrain): encode provided page weights directly
---
**Terrain pages can encode supplied paint weights faster.** The page builder writes the provider’s weight banks directly to the textures when no repaint callback is active.
