---
section: Fixed
commits:
  - perf(render): on Direct3D a shader's counted loops are compiled as loops - the D3D compiler unrolls every for loop with a literal start, so a noise shader of nested octave loops took two minutes to link on a cold cache; each such loop now starts at its literal plus a uniform that is always 0, which it cannot fold
  - perf(render): a material variant that differs only by a feature its shader never reads is the same program - an unlit surface drawn with and without the environment map compiled the same source twice, the second only after the scene opened
---
**A game's first start on Windows no longer waits minutes for its shaders.** Browsers on Windows hand WebGL shaders to the Direct3D compiler, which unrolled every counted loop: a procedural shader with nested noise loops took about two minutes to link the first time it was used (the space frigate's planet, three times over, held its loading screen for more than three minutes). Those loops now stay loops on Direct3D, and a material drawn with and without an environment map compiles once when its shader does not read that map.
