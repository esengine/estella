---
section: Fixed
commits:
  - fix(render): exclude precipitation from its own cover capture
---
**Rain and snow stop at the surfaces that shelter them.** Their depth shader no longer samples the overhead map while it is being drawn. Glass roofs still shelter the ground with shadow casting disabled.
