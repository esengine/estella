---
section: Fixed
commits:
  - fix(assets): rebind the scene before releasing hot-reloaded handles
  - fix(editor): ship safe scene asset hot reload
---
**Scene assets stay valid through hot reload.** The editor replaces the handles used by scene components before releasing the old resources. If projection is interrupted, both generations remain available until the scene can finish switching.
