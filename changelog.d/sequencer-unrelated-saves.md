---
section: Changed
commits:
  - perf(editor): keep nested timeline previews warm on unrelated saves
---
**Saving an unrelated asset no longer refreshes nested timeline previews.** Sequencer and grip previews reuse loaded timelines and in-flight reads. Edits to a referenced timeline and changes to where its reference resolves still refresh the preview.
