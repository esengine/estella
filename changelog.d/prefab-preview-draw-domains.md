---
section: Fixed
commits:
  - fix(render): frame prefab previews in the renderer's draw domains
---
**Mixed prefab previews show world-space UI and screen-space sprites.** Preview framing follows the renderer's screen domain, so a world-space badge fits the world camera and a sprite under a screen Canvas fits the overlay even without a layout component.
