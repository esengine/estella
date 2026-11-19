---
section: Added
commits:
  - feat(examples): a Camera Shots example films a runner with a tracking rail, a crane orbit and a wide shot, with no camera code
  - feat(editor): the example gallery describes Camera Shots in Chinese
---
**A Camera Shots example puts the camera pipeline together with no camera code.** A runner laps a track while three virtual cameras film it: a tracking camera keeping level with it on a rail with a handheld drift, a crane circling on an orbit, and a wide shot on a long lens that only pans when the runner nears the frame's edge. Keys 1–3 pick a shot, or the next one comes every seven seconds; the only game code raises the chosen camera's priority, and a Camera Brain blends the view to it.
