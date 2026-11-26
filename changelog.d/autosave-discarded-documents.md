---
section: Fixed
commits:
  - fix(editor): remove recovery copies of discarded documents promptly
  - fix(project): ship document-scoped recovery cleanup
---
**Recovery copies follow each open document's save and discard state.** Saving or discarding a scene or asset removes its recovery copy from the current session even while other documents have unsaved edits. An autosave in progress checks that each captured document is still open and dirty before writing its copy.
