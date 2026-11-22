---
section: Fixed
commits:
  - fix(water): redistribute direct sunlight on submerged surfaces
---
**Water caustics redistribute the sun's direct light.** Light gathers in wave crests' focused patterns and drops as they move away. Submerged meshes and terrain evaluate the same field before reflections, ambient light and emission are added. Both sides of the waterline see the same illuminated receiver.
