---
section: Fixed
commits:
  - fix(net): correct quantized drift from each viewer's exact spawn
---
**Small movements after a multiplayer spawn now respect the configured position precision.** A player receives a correction when a coordinate moves more than half a step from the exact value they saw, even inside one quantization cell. This also applies after reconnecting or entering a visibility area. Corrections use the normal bandwidth budget, and removing a component frees its pending slot.
