---
section: Fixed
commits:
  - fix(editor): match flipbook viewport playback and preserve sprite edits
---
**Flipbook viewport previews use each Sprite Animator’s speed and loop settings.** Held frames avoid duplicate Sprite writes, and turning Preview FX off restores animation fields while preserving Sprite edits made during the preview.
