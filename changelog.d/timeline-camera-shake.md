---
section: Added
commits:
  - feat(timeline): camera shake tracks fire impulses or shake the view at moments
---
**Timelines shake the camera.** A camera shake track fires a shake at each of its moments, at the force it gives, as UE's Camera Shake track does: from an entity with a CameraImpulseSource it is an impulse felt by the listening cameras by their distance, and on any other entity the view in use is shaken where it is. Before, a cut scene's blast needed a script or an event to shake the camera.
