---
internal: The built-in shaders produce the same source text as before apart from comments and whitespace; no shipped game or editor behaviour changed.
commits:
  - refactor(render): the built-in shaders splice one copy of each helper they share - packNormal was written out eleven times in each language, ign thirteen, the sky's scattering, clouds and ray start three to eight; a new sdk/src/render/shaderLib.ts holds the helpers more than one module uses (normal encoding, dither, hashes, value noise, Henyey-Greenstein), shared.ts the post-process ones (ray start, rain streaks), and the sky, water, planet and terrain-layer files a constant for each function more than one of their own shaders writes. Every shader source these modules produce (270) is the same text as before apart from comments and whitespace; the shader text in the SDK is 59 KB smaller
---
