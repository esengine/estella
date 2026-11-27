---
section: Changed
commits:
  - "feat(sdk): give a RenderTexture's render target a public name"
---
**A `RenderTexture` handle names its render target as `target`.** `Camera.renderTarget` and `captureTargetPixels` take the render target, which was reachable only as the underscored `_handle`, so the manual had to tell projects to read a private-looking field. `rt.target` is now that value; `_handle` still holds it and is deprecated. `texture` remains the colour texture components sample.
