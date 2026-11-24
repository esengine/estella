---
section: Fixed
commits:
  - fix(templates): the 3D Starter sky light no longer turns undersides navy
---
**A character in the 3D Starter no longer has dark blue lines under the nose, lips and jaw.** The template's sky light was tinted blue on top of the blue the sky already gives, and its ground gave back a fifth of the light, so every surface facing down was lit dark navy. The sky light is white now and the ground gives back 0.4, so those surfaces take the ground's own colour.
