---
section: Added
commits:
  - "feat(particle): orbital and radial velocity, arc and rim emission, ground-flat and upright quads, and a light that pulses or flickers by itself"
  - "feat(editor): vfx_write lays rings on the ground, swirls and gathers layers, and lets the engine flicker or pulse the light"
---
**Particles can swirl, gather, be born on a rim or part of a ring, and lie flat on the ground; lights can pulse or
flicker on their own.** These are the building blocks of most spell and skill effects: a shockwave ring, a turning magic
circle, motes gathering into a hand.
- On `ParticleEmitter`, `orbitalVelocity` turns particles about the emitter's centre and `radialVelocity` moves them out
  from it, or in toward it when negative.
- `shapeArc` limits births to part of the way round the shape, and `shapeThickness: 0` keeps them to the rim, which turns
  a `Circle` into a ring and a `Sphere` into a shell.
- `renderMode: Horizontal` keeps quads flat on the ground whatever the camera does, and `Vertical` keeps them upright,
  turning only about the up axis.

All of these run on both the CPU and the GPU simulation, on WebGL2 and WebGPU. At their defaults an emitter draws exactly
what it drew before.

On `Light`, `pulse` (`Sine` or `Flicker`), `pulseRate` and `pulseDepth` dim the light below its intensity as frames are
drawn, in the editor as well as in a running game. Each light gets its own phase, so a row of torches does not flicker in
step.

The MCP `vfx_write` tool writes these as `orbit`, `radial`, `arc`, `thickness` and `render: "horizontal" | "vertical"` on
a layer, and as `light.pulse`. A light's `flicker` is now the Light's own instead of a timeline clip, so the preview shows
it too.

The particles page also corrects `shapeAngle`: it is the cone's whole opening, not its half-angle.
