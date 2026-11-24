---
section: Fixed
commits:
  - fix(build): compile WebGL initialization only for web targets
  - test(ui): compare packed entity IDs in world pick assertions
---
**Headless C++ renderer tests build with the Windows system compiler.** With both Web and WeChat targets disabled, the core uses the graphics device supplied by the test. This removes the build's dependency on the Emscripten WebGL headers.
