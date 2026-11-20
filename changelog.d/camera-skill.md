---
section: Added
commits:
  - docs(skills): estella-camera teaches an agent camera rigs, blends, shakes and cutscenes
  - fix(editor): timeline_add_items keeps a shot's length so overlapping shots blend, and warns of a switched-off camera
---
**An agent working through the editor's MCP now has a camera skill.** `skill_guide { skill: "estella-camera" }` says which camera rig to create for a 2D follow, a third-person camera, a look-at, a dolly or a group shot and which field to point at the target, how priorities and the Camera Brain pick and blend the live camera, how to fire shakes, and how to build a cutscene with the timeline tools; it ends with how to prove which camera is live. The 2D and 3D gameplay skills now use rigs instead of a camera script and say to remove the template's follow script first, which moves every camera; the animation skill builds timelines with the timeline tools. `timeline_add_items` keeps the length asked for a camera shot, so a shot that runs over the next one blends into it, and warns when a shot's camera has `isActive` off, which shows nothing.
