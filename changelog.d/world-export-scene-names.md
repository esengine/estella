---
section: Fixed
commits:
  - fix(export): reject streamed scene name conflicts
---
**Export catches streaming scene name conflicts before writing world files.** If a generated cell or far proxy would replace another scene, the export reports the conflicting name.
