---
section: Fixed
commits:
  - fix(editor): isolate glTF imports with colliding dependencies
  - fix(import): preserve existing model dependency files
---
**Imported glTF models keep separate copies of conflicting geometry and texture files.** If a companion filename is already taken, the editor imports the new model into its own folder so both models can be reimported from the project.
