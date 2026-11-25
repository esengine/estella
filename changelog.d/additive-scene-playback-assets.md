---
section: Fixed
commits:
  - fix(assets): resolve named playback assets through their owners
---
**Additive scenes keep their own texture sampling during playback.** A pixel-art HUD and a 3D scene can play the same sprite clip or timeline with different filters and mipmaps. Painted and Tiled map layers also keep their own atlas. Persistent players retain their clips when their original scene unloads, and hot updates refresh each live version.
