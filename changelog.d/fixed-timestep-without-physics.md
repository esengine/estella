---
section: Fixed
commits:
  - fix(runtime): the project fixed timestep sets the FixedUpdate step without physics too
  - fix(editor): the fixed timestep setting says it is the FixedUpdate step, physics or not
---
**The fixed timestep applies without physics.** Project Settings > Physics > Fixed timestep is the step of every FixedUpdate system, but only the physics plugins handed it to the game, so a project that steps its own logic at a fixed rate without physics ran at 1/60 whatever it said. Every runtime now sets it before the first scene, physics or not, and the setting says so.
