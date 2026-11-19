---
section: Added
commits:
  - docs(skills): estella-animation teaches an agent how to make things move - which tool for which motion, clips and timelines, the Animator driven by gameplay parameters, 2D rigs, Spine, imported 3D clips and spring bones - and how to prove motion over time with motion_sheet
---
**An agent working through the editor's MCP now has an animation skill.** `skill_guide { skill: "estella-animation" }` starts with a table of which tool fits which motion: a tween, a sprite clip, a timeline, an `Animator` state machine, a 2D rig, Spine, an imported 3D model's clips, or spring bones for hair. It covers making and editing clips and timelines through the asset tools, how the `TimelinePlayer` flags control playback, and that an imported model's clips do not play until the scene says so. For characters it shows driving the `Animator` by parameters from the body's real velocity instead of naming clips. It ends with proving motion: `motion_sheet` lays several moments on one sheet, and the skill lists what to read there (nothing moving, sliding feet, a pop between clips, hair that never settles).
