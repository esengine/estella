---
section: Changed
commits:
  - perf(editor): cancel obsolete prefab previews through the shared preview queues
  - perf(render): stop canceled prefab preview work before spawning or copying pixels
---
**Prefab inspection takes priority over queued asset thumbnails.** Canceled prefab previews stop preparing the scene or copying pixels when their results are no longer needed, while in-flight GPU transfers finish safely.
