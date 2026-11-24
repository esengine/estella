---
section: Fixed
commits:
  - fix(tools): decode CDN images in the headless minigame host
---
**The headless minigame launcher can render textures from a separate CDN origin.** The browser host requests images with anonymous CORS so the engine can read their pixels when the CDN allows the game origin.
