---
section: Fixed
commits:
  - fix(export): read streamed world declarations from shipped scenes
---
**Export checks actual StreamedWorld components in the scenes it ships.** Scene names and text no longer trigger the streaming restriction. Playable exports that ship only the entry scene can build even when other scenes use streaming.
