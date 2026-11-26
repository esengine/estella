---
section: Changed
commits:
  - "perf(sequencer): reuse sampled layers for camera preview"
  - "perf(timeline): reuse sampled sequence layers for shots"
---
**Timeline avoids resolving nested layers twice on steady playback and preview frames.** Pose and camera sampling can share the same resolved layers. Playback checks again when a cue or sampling callback may have changed the shot's source.
