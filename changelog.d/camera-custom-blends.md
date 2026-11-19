---
section: Added
commits:
  - feat(camera): CameraBrain takes custom blends for particular changes of camera, and a tie in priority goes to the camera switched on last
  - feat(editor): the Details edits a list of records as cards and grows and shrinks an entity list
---
**Each change of camera can have its own blend.** A `CameraBrain`'s `customBlends` name a change of camera by the cameras' names (empty for any camera) and give it its own time and curve, as Cinemachine's Custom Blends do: cut into a close-up, ease back out over two seconds. The Details edits them as a list of cards. Among live-worthy cameras of one priority, the one switched on most recently now wins, as Cinemachine's Brain decides; cameras there when the scene loads still keep the first. A change of camera whose blend is a cut now ends a blend under way instead of finishing it toward the new camera. The Details can now add and remove entries of an entity list, such as a target group's members.
