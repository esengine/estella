---
section: Fixed
commits:
  - fix(scene): preserve imported renderers under visibility gates
---
**Hidden imported nodes keep their model references and authored renderer flags.** Saving while an asset is loading preserves its reference, and a renderer replaced under a hidden parent keeps its own visible state. Steady hidden subtrees on cores with mutation tracking avoid rereading each renderer every frame.
