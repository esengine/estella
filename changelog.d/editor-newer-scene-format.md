---
section: Fixed
commits:
  - fix(editor): protect scene files written in newer formats
  - fix(scene): share the scene version gate with the editor
---
**Older editors protect scenes written in newer formats.** Trying to open one leaves the current scene in place. If it is the project’s remembered scene, the editor opens an untitled scene and keeps the Content Browser available. Save and Save As check the destination’s format before replacing an existing scene.
