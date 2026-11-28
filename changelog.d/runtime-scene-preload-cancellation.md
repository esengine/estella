---
section: Fixed
commits:
  - fix(scene): cancel runtime waits for eager asset preparation
---
**Canceled runtime scenes stop waiting for their asset preloads.** The runtime and editor preview share the scene preload cancellation path. Queued loads stop, and other callers can still acquire assets from a shared request already in progress.
