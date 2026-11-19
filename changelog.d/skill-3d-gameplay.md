---
section: Added
commits:
  - docs(skills): estella-3d-gameplay teaches an agent how to make a playable 3D game - a character controller that walks and jumps, 3D bodies and triggers, a following camera, a finished look, terrain, plants and models - and how to prove it by playing it and looking from every side
---
**An agent working through the editor's MCP now has a 3D gameplay skill.** `skill_guide { skill: "estella-3d-gameplay" }` starts from the `3d-starter` template. It covers how `CharacterController3D` walks and jumps (write the horizontal velocity each fixed step and let the controller handle the vertical), and 3D bodies and colliders with their body types. It covers triggers read from `Physics3DEvents`, and a following camera, including turning on `FollowTarget.followZ`, which a 3D camera needs. It covers finishing the look with `audit_look` and `apply_look`, and building land, plants and models with their tools. It ends with proving the game by playing an acceptance, then looking at what was built from several sides, since a prop that floats or sinks looks right from the front.
