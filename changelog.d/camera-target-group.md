---
section: Added
commits:
  - feat(camera): CameraTargetGroup frames several entities as one target and GroupFraming sizes a shot to them by zoom or dolly
  - feat(editor): Target Group Camera presets, and an agent's create op makes everything a template makes
---
**One camera frames several targets.** A `CameraTargetGroup` stands at its members' centre (the middle of their box, or their weighted average), so any camera stage given it frames them all; `GroupFraming` on the camera zooms (orthoSize or field of view) or dollies then zooms so the box about the members fills its share of the screen, as Cinemachine's Target Group and Group Framing do, in 2D and 3D. The Create menu's Target Group Camera 2D and Target Group Camera make a group and a camera framing it. An agent's `create` op from a template now makes everything the Create menu makes: the Third Person Character template made through an agent had no camera before.
