---
section: Fixed
commits:
  - fix(flipbook): resolve preview textures like the runtime
  - fix(editor): ship consistent flipbook texture resolution
---
**Flipbook previews show the textures the game uses.** The editor resolves sheet and frame images relative to the clip when appropriate, and the scene viewport shows the clip's sheet even when the Sprite has a different base texture.
