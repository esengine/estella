---
section: Fixed
commits:
  - fix(render): a skin of more than 64 bones draws with a material - the shaders made from a material declared 64 bones while the renderer poses up to 256, so a rig with more joints (a Tripo rig has 78) read past the array and drew as a white smear; they now declare as many as the renderer poses
---
**A character rigged with more than 64 bones draws correctly.** A skinned model using a material shader, such as an imported model's, only had room for 64 bones, so a rig with more (common for full humanoid rigs) drew as a bright white smear. Up to 256 bones now work, as they already did for the engine's own mesh shader.
