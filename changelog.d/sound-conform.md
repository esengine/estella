---
section: Added
commits:
  - "feat(sound): add sound_conform, which makes a recording ready for the game and keeps its credit"
  - "feat(pipeline): measure integrated loudness and conform recordings, and keep CREDITS.md rows"
---
**A recording can be made ready for the game, with its credit kept.** The `sound_conform` tool takes a recording in the
project (WAV, OGG, MP3, FLAC, M4A) and writes a `.wav` beside it: cut to an excerpt, its leading and trailing silence
removed, music and ambience brought to one integrated loudness (-16 LUFS by default, ITU-R BS.1770, with peak limiting)
or an effect to a -3 dBFS peak, faded, and looped without a click by cross-fading its end into its start. Where the
recording came from, its licence and what was done to it are written into the project's `CREDITS.md`, and the reply
warns when a licence forbids changes or commercial use or needs the author shown on a credits screen.
