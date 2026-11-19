---
section: Added
commits:
  - feat(camera): StateDrivenCamera picks the live camera by what an Animator is doing
  - feat(editor): a State-Driven Camera in the Create menu, its rules edited as a table
---
**The camera follows what a character is doing.** A `StateDrivenCamera` watches an `Animator` and switches on the camera its current state names (by camera name, with a default for any other state), switching the others it names off, as Cinemachine's State-Driven Camera does; the brain blends into it with its default or custom blend and a `CameraEvent` is sent. A rule can wait before switching, so a state passed through does not flick the view, and can hold a camera live a minimum time. The Details edits the rules as a table and the Create menu makes one.
