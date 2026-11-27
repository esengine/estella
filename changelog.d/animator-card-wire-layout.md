---
section: Changed
commits:
  - perf(editor): reuse Animator graph and card wire layout data
---
**Large Animator graphs update faster during playback.** The editor reuses the graph structure between runtime reports and groups parallel and reverse transitions before laying out their wires.
