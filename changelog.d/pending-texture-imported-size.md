---
section: Fixed
commits:
  - fix(assets): preserve imported texture dimensions during compression
---

**Sprites, tilemaps, bitmap fonts and animation frames use their imported texture dimensions while editor compression is pending.** A mesh can display a smaller preview first. When a reader needs the original pixels, both readers see the full image on the same handle. Device recovery restores the requested size.
