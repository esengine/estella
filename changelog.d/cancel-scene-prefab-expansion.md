---
section: Fixed
commits:
  - fix(scene): release prefab reads when scene expansion is canceled
---
**Preview and runtime scenes stop waiting for prefab expansion when canceled.** They return their temporary asset references immediately, skip further prefab reads, and leave shared reads available to other callers.
