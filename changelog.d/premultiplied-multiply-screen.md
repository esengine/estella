---
section: Fixed
commits:
  - "fix(render): draw Multiply and Screen from a premultiplied colour, so a half-clear texel no longer lights what is behind it"
  - "test(editor): hold Multiply and Screen particles to their blend formulas over a grey board"
---
**The Multiply and Screen blends no longer brighten what is behind a soft-edged sprite, particle or trail.** These two
modes expect a colour that is already premultiplied by its alpha, but the engine's own shaders output straight alpha. As a
result, a half-transparent white texel made what was behind it brighter, and a multiply particle with a glow texture drew
a milky disc instead of darkening. The built-in sprite batch, particle and trail shaders now premultiply their output under
these two modes, on WebGL2 and WebGPU alike. A material that uses its own shader with these modes must output a
premultiplied colour itself; the materials page now says so.
