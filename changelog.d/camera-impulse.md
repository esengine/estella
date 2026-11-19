---
section: Added
commits:
  - feat(camera): CameraImpulseSource fires a jolt from a place and CameraImpulseListener cameras feel it by their distance
  - feat(editor): an Impulse Source in the Create menu, and the follow, tracking and group camera presets listen for impulses
---
**A shake happens somewhere.** A `CameraImpulseSource` fires a jolt from where it stands, by `fireImpulse(world, entity, force)` or its `fire` flag, with its own amplitude, rotation, frequency, attack, sustain and decay; each camera with a `CameraImpulseListener` feels it by its distance (whole within a radius, fading beyond it), on the channels it shares, and with a propagation speed a far camera feels it later, as Cinemachine's Impulse Source and Listener do. It moves only the drawn view, never a camera's Transform. The Create menu offers an Impulse Source, and the Follow Camera 2D, Tracking Camera and group camera presets listen.
