---
section: Added
commits:
  - feat(xr): present web builds in a VR headset through WebXR
---
**Web builds can be played in a VR headset.** Set `features.rendering.vr` in the project and the exported page shows an Enter VR
button where the browser can present. In the headset the main camera becomes the player's standpoint: both eyes are drawn with the
headset's own projections and head tracking, at the headset's frame rate, and the scene's units are scaled from metres by the
project's units per metre. Games can call `enterVR`, `exitVR` and `inVR`, and read the head pose from `xrPresentation`. This first
step covers rendering and head tracking. Controllers, a shared culling pass for both eyes, and per-eye handling of temporal
effects are not done yet. VR uses the WebGL2 renderer on the page's thread, so a project set to WebGPU or threaded rendering draws
without either while VR is on. Screen-space HUDs are not shown in the headset.
