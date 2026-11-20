---
section: Fixed
commits:
  - fix(webgpu): a colour texture unit is never handed the scene's depth
---
**WebGPU no longer drops frames after a depth-reading effect.** With an effect that reads the scene's depth (height fog, ambient occlusion, depth of field and others), the depth stayed bound on its texture unit, and the next sprite, mesh or sky drawn was handed it where it expected a colour texture: WebGPU refused the frame with "None of the supported sample types (UnfilterableFloat|Depth) ... match the expected sample types (Float)" and an invalid command buffer, in the editor's viewport and camera preview and in play. Such a unit now gets the blank texture an unbound one gets. WebGL was not affected.
