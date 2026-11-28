---
section: Fixed
commits:
  - fix(scene): release late prefab receipts from discarded preparation
---
**Discarded scene preparation releases prefab references even when reads finish late.** Prefab acquisitions made through the document preparation callback end with that scene's preparation, keeping canceled streaming work from retaining asset references.
