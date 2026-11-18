---
section: Changed
commits:
  - feat(render): the step and sample counts of the sky, fog, lens effects, bloom, refraction and particle collisions are quality settings - Sky & Volumetrics, Post-Processing and Effects & Particles each gain the counts their shaders had written in, High keeping them and Medium and Low taking fewer; a shader loop is compiled for High's count and stops at the level's, bloom's pyramid loses its smallest levels, a material reads the level from the engine's frame constants, and a particle collision budget the game sets wins over the level's
---
**What the sky, fog, lens effects, bloom, refraction and particle collisions spend is set by the quality level.** Sky &
Volumetrics gains Fog light steps, Fog cloud samples, Cloud steps, Upper cloud steps, Cloud shadow samples, Sky scattering
steps and Sky sunlight steps; Post-Processing gains Depth of field, Light shaft, Motion blur and Subsurface scattering samples
and Bloom levels; Effects & Particles gains Refraction blur samples, Particle collision queries and events and the GPU particle
depth grid. High is what each was before, so a High picture is unchanged; Medium and Low take fewer steps over the same
distance, and Low's bloom stops at an eighth of the picture instead of a sixty-fourth. A particle collision budget set with
`Particle.setCollisionBudget` still holds whatever the level.
