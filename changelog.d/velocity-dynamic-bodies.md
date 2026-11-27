---
section: Fixed
commits:
  - "fix(sdk): let Velocity move kinematic bodies and leave every dynamic one to its solver"
---
**Velocity now moves 2D and 3D bodies the same way: kinematic and static bodies follow it, dynamic ones are left to physics.**
It used to skip every 2D body, including kinematic ones, so a moving platform on Velocity stood still even though 2D physics
drives a kinematic body from its Transform. It also moved dynamic 3D bodies, which the solver then put back each step, so they
flickered without going anywhere. Now a dynamic body (2D or 3D, while enabled) is the solver's alone, and any other body moves
with its Velocity, with physics following.
