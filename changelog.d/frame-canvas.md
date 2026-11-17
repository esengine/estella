---
section: Fixed
commits:
  - fix(camera): a frame names one Canvas, the running scene's, for its cameras, its layout boxes and its clear colour - each looked the Canvas up for itself, seven times a frame and by two rules: the cameras took the Canvas of a running scene, while the screen layout, the UI layout box and the clear colour took the first Canvas there was, so with two scenes loaded the UI was laid out in one Canvas's box under cameras fitted to another's; the Canvas is resolved once where the cameras are and handed to each, and the early sync the UI lays out from uses the same running scenes as the render
---
**With two scenes loaded, the UI is laid out in the running scene's Canvas, the one its cameras are fitted to.** The cameras took their design-resolution fit from the Canvas of a running scene, while the screen layout, the UI layout box and the clear colour took the first Canvas there was: a paused scene's Canvas decided where the running scene's UI went and what colour cleared behind it. A frame now names one Canvas, once, and everything reads that one. A project with one Canvas sees no change.
