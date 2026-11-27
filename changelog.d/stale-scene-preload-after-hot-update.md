---
section: Fixed
commits:
  - fix(runtime): discard scene preloads from superseded manifests
---
**Scene switches refresh stale preloads after a hot update.** A destination prepared against an older manifest or CDN root is loaded again from the current content before it becomes active.
