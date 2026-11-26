---
section: Fixed
commits:
  - fix(editor): bind Play snapshots to the requested scene
  - fix(project): ship scene-bound preview preparation
---
**Play and timeline rendering keep their source scene while preparing.** If another document replaces the source before the preview is ready, the attempt stops with a message. Edits within the requested scene are included when preparation reaches the snapshot.
