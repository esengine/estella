---
section: Fixed
commits:
  - fix(cook): preserve the source images of reachable tiled terrain
---
**Published tiled terrain keeps its original height and weight samples.** The asset cook uses the terrain document’s dependencies
to keep its images standalone, with their original dimensions and bytes.
