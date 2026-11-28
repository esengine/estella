---
section: Fixed
commits:
  - fix(animation): restore sprite fields when a reloaded flipbook is empty
  - refactor(editor): share sprite frame restoration with the runtime
---
**An empty flipbook reload restores the sprite's scene appearance.** The game releases the old animation's frame textures, preserves Sprite edits made during playback, and can show frames again when the clip is repopulated even while the player is paused.
