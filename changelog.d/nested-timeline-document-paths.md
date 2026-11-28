---
section: Fixed
commits:
  - fix(timeline): resolve nested clips from their authored documents
  - fix(editor): preview nested timelines from their own directories
---
**Nested timelines resolve relative clips from the document that names them.** Sequencer previews and playback can follow relative references across folders, including cases where different branches each contain a child with the same filename. Saving a timeline keeps the authored references.
