---
section: Fixed
commits:
  - fix(render): a frame's GPU timing counts its screen UI - the screen overlay's graph ran without the pass timer, so the UI's own draw, a CanvasEffect layer's draw and compose, and a backdrop grab were in no pass time and left out of the frame's total; it is now timed like a camera's graph, and a layer's compose is named screen-ui-effect so it is told apart from the UI's draw
---
**A frame's GPU timing counts its screen UI.** With the profiler on, every pass of a frame is timed on the GPU and the frame's time is their sum, but the screen overlay's passes ran untimed: the UI's own draw, a `CanvasEffect` layer's offscreen draw and compose, and the blit a backdrop-blurred panel samples were in no pass time and missing from the frame's total, so a HUD of effect layers looked free in a profile. They are now timed like a camera's passes, as `pass/screen-ui`, `pass/screen-ui-layer`, `pass/screen-ui-effect` and `pass/screen-ui-grab`; a layer's compose, which shared the name `screen-ui` with the UI's draw, has a name of its own. The copy of the frame a grab starts from and the mip chain it builds are still outside any pass.
