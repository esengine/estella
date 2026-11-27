---
section: Fixed
commits:
  - fix(cook): follow only dependencies a material uses
---
**Material exports follow the dependencies used by the runtime.** A material instance keeps its parent and texture overrides. An unused shader on the instance or a filename in material metadata no longer pulls extra assets into the export.
