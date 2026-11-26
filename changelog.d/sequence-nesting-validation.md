---
section: Fixed
commits:
  - fix(sequencer): match nested sequence validation to playback
  - fix(editor): ship consistent nested sequence validation
---
**Sequencer accepts the full nesting depth supported by playback.** Its validation checks the deepest branch even when clips share dependencies, and recognizes loops that mix file paths and UUID references.
