---
section: Fixed
commits:
  - fix(editor): preview timeline sprite frame tracks in Sequencer
  - fix(timeline): share sprite frame sampling with Sequencer preview
---
**Sequencer previews sprite frame tracks as you scrub.** Root and nested clips use the same frame selection as game playback. Sprite frames use their own region when packed into a texture atlas, and closing the preview restores the scene's authored sprite.
