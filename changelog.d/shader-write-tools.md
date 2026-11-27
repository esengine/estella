---
section: Added
commits:
  - "feat(editor): write GLSL material shaders and see them on samples at once"
  - "feat(shader): name the line where a GLSL shader stops translating for WebGPU"
---
**An AI agent can write a material shader and look at it in well under a second.** The new `shader` tool group's
`shader_write` takes a whole `.esshader` in GLSL, writes it with a material beside it, compiles it for the ways a lit mesh
is drawn and translates it for WebGPU, and answers with the surface drawn on a ground slab, a wall and a ball in the open
scene from five views: three-quarter, close, grazing, far and against the sun. A broken shader is not drawn and the answer
names the line of the file and its text; a shader that compiles for WebGL but not for WebGPU is named the same way.
`shader_views` looks at any material again without writing. Its guide teaches a lit shader to start from, the lighting
layers (sheen, light through thin things, a clear coat), world-space patterns (coursed blocks, flagstone cells, noise,
weathering, a bump from a height) and the traps that make a surface read as generated. Contact sheets from the look
tools now label their pictures with words as well as numbers.
